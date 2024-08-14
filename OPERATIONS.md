# Overview

This guide is for consumers of the Streaming-Sitemaps project and contains the instructions needed to operate a deployment of the project, along with related tools and tasks.

# Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [DynamoDB Keys](#dynamodb-keys)
- [Sitemap Writer Kinesis Stream Compaction](#sitemap-writer-kinesis-stream-compaction)
  - [Improving Processing Time without Compaction](#improving-processing-time-without-compaction)
  - [Impacts to Sitemap-Writer Per-Shard Processing Time](#impacts-to-sitemap-writer-per-shard-processing-time)
  - [Procedure for Sitemap Writer Kinesis Stream Compaction](#procedure-for-sitemap-writer-kinesis-stream-compaction)
- [Pretty Printing / Formatting XML Files for Readability](#pretty-printing--formatting-xml-files-for-readability)
- [Recreating Sitemap Index XML Files from DB](#recreating-sitemap-index-xml-files-from-db)
- [Freshening Sitemap XML Files on S3 from DB](#freshening-sitemap-xml-files-on-s3-from-db)
    - [Widget](#widget)
      - [From DB Only](#from-db-only)
      - [With DB Repair](#with-db-repair)
    - [Search](#search)
      - [From DB Only](#from-db-only-1)
      - [With DB Repair](#with-db-repair-1)
- [Extracting HTML Sitemap Links](#extracting-html-sitemap-links)
- [Writing Sitemap and Index Files in Alternate Languages](#writing-sitemap-and-index-files-in-alternate-languages)
- [Downloading Sitemaps via HTTP with Sitemaps Tool](#downloading-sitemaps-via-http-with-sitemaps-tool)
- [Mirroring Sitemaps from HTTP Source to S3 Bucket with Sitemaps Tool](#mirroring-sitemaps-from-http-source-to-s3-bucket-with-sitemaps-tool)
- [Checking for Invalid UTF-8 or Non-Printable Characters in Files](#checking-for-invalid-utf-8-or-non-printable-characters-in-files)
  - [Example Gremlin / Invisible Char](#example-gremlin--invisible-char)
    - [Between the Single Quotes](#between-the-single-quotes)
  - [Invisible Characters](#invisible-characters)
  - [Check for Control Characters (e.g. Null, Tab, etc)](#check-for-control-characters-eg-null-tab-etc)
  - [Check if the File Can Be Parsed as UTF-8](#check-if-the-file-can-be-parsed-as-utf-8)
  - [Non-ASCII](#non-ascii)
- [Using the CLI to Create and Upload Sitemaps](#using-the-cli-to-create-and-upload-sitemaps)
  - [Creating Sitemaps from CSV Source to Local Directory](#creating-sitemaps-from-csv-source-to-local-directory)
  - [Uploading Local Sitemaps to S3](#uploading-local-sitemaps-to-s3)
- [Recreate Sitemap file from DynamoDB Table](#recreate-sitemap-file-from-dynamodb-table)
  - [Create all Sitemaps for Type from DynamoDB Table](#create-all-sitemaps-for-type-from-dynamodb-table)
- [Comparing Recreated Sitemap with S3 Version of Sitemap](#comparing-recreated-sitemap-with-s3-version-of-sitemap)
- [Formatting All .XML Files in Folder with xmllint](#formatting-all-xml-files-in-folder-with-xmllint)

# DynamoDB Keys

- PK: filelist:[type], SK: [filename]
  - List of all files in the sitemap index for a particular type
  - Enables enumerating all of the records for all of the files in a sitemap index
  - Metadata about last update time for any item in a particular file (for identifying which files need to be refreshed)
- PK: type:[type]:id\:[id], SK: 'assetdata'
  - Data for a particular item id in a sitemap of a particular type
  - Metadata about item state
  - Used to find which file a given item is in when reading the data stream
- PK: type:[type]:file:[filename], SK: id:[id]
  - List of items in a sitemap
  - Metadata about item state
  - Used to refresh the data in a given sitemap file
- PK: type:[type]:shard:[shardid], SK: shardstate'
  - Metadata about the state of a particular shard sitemap file writer
  - Primarily used to track which sitemap file is being appended to by a particular shard when using multi-shard sitemap writing

# Sitemap Writer Kinesis Stream Compaction

The sitemap-writer may get behind on the input stream for some reason (e.g. a reprocessing of all records was run and dumped 100's of millions of records into the Kinesis input stream for the sitemap-writer when only a single stream shard was configured).

Sitemap-writer's with Kinesis input streams that were not pre-scaled to have enough shards to process those records may take weeks or months to process all the records in the stream. This procedure shows how to scale the stream up to more shards without impacting record ordering, to enable the backlog to be processed in hours or days.

Before compacting a stream, review the below impacts to sitemap-writer processing time to see if there is an easier way to improve throughput, such as those listed in the section below.

## Improving Processing Time without Compaction

- Disable Compression of Sitemap XML Files
  - Set `compressSitemapFiles: false`
  - Disabling of Sitemap XML file compression can be done while the Lambda is running without any negative impacts
- Lambda `memorySize`
  - See more notes below
  - Set `memorySize` to 1769 MB to ensure allocation of 1 CPU core
    - The processing is CPU bound, even when `storeItemStateInDynamoDB: true`
- Disable Sitemap-Writer Input Stream Record Compression
  - This will not help process records already in the stream, but it can help prevent the problem recurring
  - For streams that regularly fall behind / get blocked: incoming record compression should be disabled as it will continue to slow down the sitemap-writer in the future
- Increase the Sitemap-Writer Input Stream Shard Count
  - This will not help process records already in the stream, but it can help prevent the problem recurring
  - More shards lead to more parallel Lambda invocations and thus more parallel CPUs handling the work
  - This works well when, for example, the stream is going to finished the already written records in a few hours and a multiple of that number of records is yet to be written to the stream
- Improve XML Write Density
  - This will not help process records already in the stream, but it can help prevent the problem recurring
  - `storeItemStateInDynamoDB: true` will eliminate duplicates in the input stream
  - However, if there is a large percent of duplicates, then the `sitemaps-db-lib` can be used in the producer to eliminate duplicate records before they are sent to the sitemap-writer Kinesis input stream, resulting in a near 100% write density
  - When the sitemap-writer is invoked and has even 1 record to write to a sitemap, it must spend ~5-10 seconds pulling that XML file from S3, parsing that XML file, writing back to the XML file, then pushing it back to S3
    - When performing thousands of writes to that file this is a reasonable cost in time
    - When performing a single write to that file it is not a reasonable cost
    - This problem happens when, say, 99% of the records in the stream are updates to items written to older files, which cannot be directly written by the sitemap-writer and instead must be written to the DB and then freshened into the XML files

## Impacts to Sitemap-Writer Per-Shard Processing Time

- Lambda `memorySize`
  - `memorySize` determines what percent of run time can be CPU usage
  - `memorySize` of 1769 MB allocates 1 CPU core, allowing 100 ms of CPU usage per 100 ms of run time
  - `memorySize` needs to be at least 1769 MB (and performace improves up to about 2000 MB) to avoid all delays from over-using CPU
  - When incoming records are compressed using zlib's `deflate` or `deflateSync`, CPU allocation of at least 1 CPU core (e.g. 1769 MB for `memorySize`) - see more details below
  - Setting `memorySize` to 1769 MB will not have a substantial negative impact on cost because the Lambda will run 5x faster when given 5x more CPU
    - While the cost per time unit is 5x higher, you pay it for 1/5th of the amount of time
    - This holds up to 1769 MB but is not true higher than 1769 MB as the processing is single-threaded and does not benefit from a second CPU core
- Compression of Sitemap XML Files
  - Controlled by `compressSitemapFiles: true`
  - Compression of Sitemap XML files takes an enormous amount of single-threaded CPU time
  - Turning off compression of Sitemap XML can cause throughput to increase up to 3x, assuming `memorySize` is 1769 MB - If `memorySize` is less than 1769 MB then the impact can be even greater
- Incoming Record Decompression
  - Assuming `memorySize` of 1769 MB
  - If the incoming records are compressed, then a full batch of 10,000 records, depending on the size of the `SitemapItemLoose`, can take 5-30 seconds of 100% CPU usage to decompress
  - If this is the case then `ParallelizationFactor` / `Concurrent batches per shard` will be needed to provide more CPUs to decompress the incoming records using the current shard count
    - 🔺 CAUTION 🔺 `ParallelizationFactor` must be `1` when writing Sitemap XML files, else the files will be overfilled, records will be messing from them, and you'll have to start over processing of your input stream to correct distribute items into files again. Parallelization causes problems when writing XML files because the `shardId` is used in the output filenames and the Lambda handling that `shardId` must re-hydrate the XML file, measuring the size of all items in it already, and the size of new items being added (which it writes to DynamoDB as belonging to that file), then it writes back the final file to S3. If any of these activities overlap with another Lambda handling the same `shardId` (which happens with `ParallelizationFactor > 1`) then the DynamoDB records for that file will have more items than will fit in that file, there will be a race as to which file gets written to S3, and the records from all but 1 of the Lambdas will be lost when the last lambda writes the file to S3.
- Density of Writes to XML Files when `storeItemStateInDynamoDB: true`
  - Assuming `memorySize` of 1769 MB
  - Up to 10 seconds will be spent reconstructing the state of the current XML file so that new records can be appended
  - This 10 seconds is not a problem if a batch of 10,000 incoming records will write 10,000 new items to the XML file (which will take another 3-6 seconds)
    - At this rate, filling an entire XML file of 50,000 items or less would take no more than about 30-40 total seconds of XML read/write time across up to 5 invocations
  - Low-density batches, such as 10 unique records (determined by `storeItemStateInDynamoDB: true`) in a batch of 10,000 records, will cause the XML file to be read and written up to 5,000 times before it is full
    - At this rate, filling an entire XML file of 50,000 items or less could take 👎 42 hours 👎
- Sitemap-Writer Input Stream Record Compression
  - Incoming records are optionally compressed with `zlib.deflate` or `zlib.deflateSync` by the producer
  - Record compression has these benefits:
    - Enables better utilization of the MB/second write rate of each Kinesis Shard
    - Allows fewer Kinesis Shards (possibly even `1`) which limits the number of new Sitemap XML files being appended with new records at all times
  - Unfortunately, record decompression can increase the runtime of the sitemap-writer Lambda by 2x to 5x (depending on whether `storeItemStateInDynamoDB` is on and if the `memorySize` is 1769 MB or less)
  - If the records blocking the Kinesis stream are already compressed then they must be decompressed to proceed
  - If the Kinesis stream regularly gets blocked then incoming record compression should probalby not be used

## Procedure for Sitemap Writer Kinesis Stream Compaction

Compaction reads all the records in the stream with a `compactVersion` either not set or less than the expected `incomingCompactVersion`, decompresses them, eliminates duplicates if `storeItemStateInDynamoDB: true`, then writes the decompressed records back to the sitemap-writer Kinesis input stream.

⚠️ CAUTION: It is critically important that all other producers for the sitemap-writer Kinesis input stream be suspended until the compaction is completed. Other producers can be resumed when the sitemap-writer stops writing compacted records to the stream. Failure to observe this guidance will result in out of order record processing (possibly resulting in deleted records being in the sitemaps or out of date data being written to the sitemaps and DB).

1. Suspend all other producers that put records into the sitemap-writer Kinesis input stream
   1. Confirm that the other producers have stopped
   2. Confirm in AWS Console that put records to the Kinesis stream have stopped
1. 🤔 Optional: Increase the sitemap-writer Kinesis input stream shards
   1. This will allow parallel dispatch of the compacted records when compaction finishes
   2. This will allow parallel dispatch of newly written records from the producers, reducing the chances of problem recurring
1. Edit all producers to set `compactVersion` field in the sitemap-writer Kinesis records
   1. Set `compactVersion` to a non-zero number, such as 1
   2. If compactions have been run before, increment the number by 1
   3. Failure to set this will result in double and out of order processing of new records
1. Set `incomingCompactVersion` on `sitemapWriter`
   1. Set to the same `compactVersion` that was just applied to the producers
   2. This allows the sitemap-writer to identify records that do not need to be compacted
1. 🤔 Optional: Set `ParallelizationFactor`
   1. Example: `aws lambda update-event-source-mapping --function-name sitemaps-sitemap-writer --uuid [event-source-mapping-uuid] --parallelization-factor 10`
   2. If a stream is _way_ behind and highly CPU bound (e.g. decompressing incoming records)
   3. Set `throwOnCompactVersion` on the sitemap-writer to be the same as the `compactVersion`
      1. This will cause sitemap-writer to stop processing (Lambda function failures) when it finishes compacting existing records and starts processing compacted records
   4. Set `ParallelizationFactor` up to 10
      1. This will preserve ordering by `PartitionKey` but would cause problems if XML files were being written
1. Monitor the compaction
   1. The `[Type]Compacted` metric will track the number of compacted records
   2. The `[Type]UniqueCompacted` metric will track the number of non-duplicates that were written back to the stream with `compactVersion` set to `incomingCompactVersion`
   3. `ExceptionCompactVersion` will be thrown if `throwOnCompactVersion` was set and the Lambda exited because it saw a record with `compactVersion` set to `throwOnCompactVersion`
   4. If `throwOnCompactVersion` was not set then the Lambda will start processing compacted records
1. 🤔 Set `ParallelizationFactor` back to 1
   1. Example: `aws lambda update-event-source-mapping --function-name sitemaps-sitemap-writer --uuid [event-source-mapping-uuid] --parallelization-factor 1`
   2. Remove the `throwOnCompactVersion` setting
   3. At this point the Lambda will start processing compacted records
1. Resume all other producers that put records into the sitemap-writer Kinesis input stream
   1. Confirm that the other producers have started
   2. Confirm in AWS Console that put records to the Kinesis stream have resumed
   3. Check that the metric `MsgReceived` has increased when compared to prior to the compaction

# Pretty Printing / Formatting XML Files for Readability

`xmllint --format widget-sitemap-16.xml > widget-sitemap-16-pretty.xml`

# Recreating Sitemap Index XML Files from DB

```
npx sitemaps-cli create-index --table-name=sitemaps-prod --table-item-type=widgets --sitemap-dir-url="https://www.example.com/sitemaps/widgets/" -i widgets-index

npx sitemaps-cli create-index --table-name=sitemaps-prod --table-item-type=search --sitemap-dir-url="https://www.example.com/sitemaps/search/" -i search-index
```

# Freshening Sitemap XML Files on S3 from DB

- `--repair-db` will add missing records to the DB for items that are found in the file only
- `--dry-run` will record metrics but not write to the DB or to S3
  - `--no-dry-run` is required to write to the DB and to S3

### Widget

#### From DB Only

```sh
npx sitemaps-cli freshen --no-dry-run --no-dry-run-db --table-item-type widget --function-name sitemaps-sitemap-freshener
```

#### With DB Repair

```sh
npx sitemaps-cli freshen --repair-db --no-dry-run --dry-run-db --table-item-type widget --function-name sitemaps-sitemap-freshener --s3-directory-override dry-run-db/ --itemid-regex "^https:\/\/www\.example\.com\/widget\/(.*-)?-widget-(?<ItemID>[0-9]+)$" --itemid-regex-test-url "https://www.example.com/widget/a-really-nice-widget-905143174" --itemid-regex-test-url "https://www.example.com/widget/widget-905143174"
```

### Search

#### From DB Only

```sh
npx sitemaps-cli freshen --no-dry-run --no-dry-run-db --table-item-type search --function-name sitemaps-sitemap-freshener
```

#### With DB Repair

```sh
npx sitemaps-cli freshen --repair-db --no-dry-run --dry-run-db --table-item-type search --function-name sitemaps-sitemap-freshener --s3-directory-override dry-run-db/ --itemid-regex "^https:\/\/www\.example\.com\/search\/(?<ItemID>.+)" --itemid-regex-test-url "https://www.example.com/search/some-search-term" --itemid-regex-test-url "https://www.example.com/search/some%22other%22search%22term"
```

# Extracting HTML Sitemap Links

```sh
curl -A streaming-sitemaps https://www.example.com/ko/explore/sitemap | xmllint --html --xpath "//a/@href" - | grep search
```

# Writing Sitemap and Index Files in Alternate Languages

- Includes only `loc` and `lastmod` fields
  - This is required to ensure that the alternate language sitemaps are generally smaller than the primary language sitemaps
  - If an alternate language sitemap is too large then items will be dropped from it
- No additional state is saved in DynamoDB
  - The alternate languages are a 1-1 mapping between index file names and sitemap file names
  - They will all have the same list of items, with the same status
- Controlled via:
  - Env var: `INFIX_DIRS=["de","es"]`
  - Config file variable `infixDirs`
  - Note:
    - Needs to be set on sitemap writer
    - Needs to be set to the same value on index writer
      - Index writer will immediately write the entire set of links to sitemaps that may not exist yet
      - It is wise to let sitemap writer finish back populating via a `freshen` before adding the setting to index writer

# Downloading Sitemaps via HTTP with Sitemaps Tool

```sh
nvm use
npm run build
mkdir downloads
cd downloads
npx sitemaps-cli download --type index https://www.example.com/sitemaps/some-index.xml
```

# Mirroring Sitemaps from HTTP Source to S3 Bucket with Sitemaps Tool

```sh
nvm use
npm run build
mkdir downloads
cd downloads
npx sitemaps-cli mirror-to-s3 --type index https://www.example.com/sitemaps/some-index.xml.gz s3://doc-example-bucket
```

# Checking for Invalid UTF-8 or Non-Printable Characters in Files

## Example Gremlin / Invisible Char

```
Buffer.from([0xe2, 0x80, 0x8b]).toString('utf-8')
```

### Between the Single Quotes

`'​'`

## Invisible Characters

The VS Code message `This document contains many invisible unicode characters` is generated by this code:

- https://github.com/microsoft/vscode/blob/63f82f60b00319ca76632aa4e4c5770669959227/src/vs/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.ts#L363
- https://github.com/microsoft/vscode/blob/63f82f60b00319ca76632aa4e4c5770669959227/src/vs/editor/common/services/unicodeTextModelHighlighter.ts#L183
- https://github.com/microsoft/vscode/blob/63f82f60b00319ca76632aa4e4c5770669959227/src/vs/base/common/strings.ts#L1164
- List of chars: https://github.com/microsoft/vscode/blob/63f82f60b00319ca76632aa4e4c5770669959227/src/vs/base/common/strings.ts#L1152
- Allowed Invisible Chars: [' ', '\r', '\t']
- Invisible Char List Generator: https://github.com/hediet/vscode-unicode-data

Install `ugrep` for grepping UTF-8 sitemap files

```
ugrep -aX '[\x{0000}-\x{0008}\x{000B}-\x{000C}\x{000E}-\x{001F}\x{007F}\x{0081}-\x{00A0}\x{00AD}\x{034F}\x{061C}\x{0E00}\x{17B4}-\x{17B5}\x{180B}-\x{180F}\x{181A}-\x{181F}\x{1878}-\x{187F}\x{18AA}-\x{18AF}\x{2000}-\x{200F}\x{202A}-\x{202F}\x{205F}-\x{206F}\x{3000}\x{A48D}-\x{A48F}\x{A4A2}-\x{A4A3}\x{A4B4}\x{A4C1}\x{A4C5}\x{AAF6}\x{FB0F}\x{FE00}-\x{FE0F}\x{FEFF}\x{FFA0}\x{FFF0}-\x{FFFC}\x{11D45}\x{11D97}\x{1D173}-\x{1D17A}\x{E0000}-\x{E007F}]'  sitemaps/widget/widget-00263.jsonl
```

## Check for Control Characters (e.g. Null, Tab, etc)

```
ggrep --color=auto -a -P -n "[\x00-\x08\x0B-\x0C\x0F-\x1F]" sitemaps/widiget/widget-00263.format.jsonl
```

## Check if the File Can Be Parsed as UTF-8

From: https://stackoverflow.com/a/115262/878903

- `0` - parsed correctly
- `1` - failed to parse

```
iconv -f UTF-8 sitemaps/widget/widget-00263.format.jsonl > /dev/null; echo $?
```

## Non-ASCII

This isn't quite "non-UTF-8", but it's sometimes helpful.

```
ggrep --color=auto -a -P -n "[\x80-\xFF]" sitemaps/widget/widget-00263.format.jsonl
```

# Using the CLI to Create and Upload Sitemaps

## Creating Sitemaps from CSV Source to Local Directory

```sh
npx sitemaps-cli create from-csv ./data/widgets.csv https://www.example.com/sitemaps/widgets/sitemaps/ https://www.example.com/widget/ ./ sitemap-widgets-index --base-sitemap-file-name sitemap-widgets --column widget_id

npx sitemaps-cli create from-csv ./data/keywords.csv https://www.example.com/sitemaps/search/sitemaps/ https://www.example.com/search/ ./ sitemap-search-index --base-sitemap-file-name sitemap-search --column search_term
```

## Uploading Local Sitemaps to S3

```sh
npx sitemaps-cli upload-to-s3 --root-path ./ sitemaps/some-sitemap-index.xml s3://doc-example-bucket
```

# Recreate Sitemap file from DynamoDB Table

## Create all Sitemaps for Type from DynamoDB Table

```sh
npx sitemaps-cli create from-dynamodb --table-item-type widgets --sitemap-dir-url https://www.example.com/sitemaps/widgets/sitemaps/ sitemaps-prod ./
```

# Comparing Recreated Sitemap with S3 Version of Sitemap

```sh
npx sitemaps-cli create from-dynamodb --sitemaps-dir-url https://www.example.com/sitemaps/widgets/sitemaps/ --table-item-type widgets --table-file-name widgets-00002.xml sitemaps-prod 

wget https://www.example.com/sitemaps/widgets/sitemaps/widgets-00002.xml
xmllint --format widgets-00002.xml > widgets-00002.format.xml
xidel widgets-00002.format.xml --xquery 'for $node in //url order by $node/loc return $node' --output-format xml > widgets-00002.sorted.xml
npx sitemaps-cli convert widgets-00002.sorted.xml

diff -u widgets-00002.sorted.xml widgets-00002.sorted.xml
```

# Formatting All .XML Files in Folder with xmllint

```sh
mkdir -p formatted/widgets/
find widgets -maxdepth 1 -type f -iname "*.xml" -exec xmllint --format '{}' --output formatted/'{}' \;
```
