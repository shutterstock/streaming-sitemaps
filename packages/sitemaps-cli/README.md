# Table of contents
<!-- toc -->
* [Table of contents](#table-of-contents)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
 
# Usage
<!-- usage -->
```sh-session
$ npm install -g @shutterstock/sitemaps-cli
$ sitemaps-cli COMMAND
running command...
$ sitemaps-cli (--version)
@shutterstock/sitemaps-cli/0.0.0 darwin-arm64 node-v20.13.1
$ sitemaps-cli --help [COMMAND]
USAGE
  $ sitemaps-cli COMMAND
...
```
<!-- usagestop -->

# Commands
<!-- commands -->
* [`sitemaps-cli convert URL-OR-FILE`](#sitemaps-cli-convert-url-or-file)
* [`sitemaps-cli create`](#sitemaps-cli-create)
* [`sitemaps-cli create from-csv DATA-FILE SITEMAP-DIR-URL BASE-URL [OUTPUT-DIRECTORY] [INDEX-FILE-NAME]`](#sitemaps-cli-create-from-csv-data-file-sitemap-dir-url-base-url-output-directory-index-file-name)
* [`sitemaps-cli create from-dynamodb TABLE-NAME SITEMAP-DIR-URL [OUTPUT-DIRECTORY] [INDEX-FILE-NAME]`](#sitemaps-cli-create-from-dynamodb-table-name-sitemap-dir-url-output-directory-index-file-name)
* [`sitemaps-cli download S3-OR-HTTP-URL`](#sitemaps-cli-download-s3-or-http-url)
* [`sitemaps-cli freshen`](#sitemaps-cli-freshen)
* [`sitemaps-cli help [COMMAND]`](#sitemaps-cli-help-command)
* [`sitemaps-cli mirror-to-s3 INDEX-URL S3-BUCKET-URL`](#sitemaps-cli-mirror-to-s3-index-url-s3-bucket-url)
* [`sitemaps-cli test`](#sitemaps-cli-test)
* [`sitemaps-cli test sitemap-writer-stream STREAM-NAME`](#sitemaps-cli-test-sitemap-writer-stream-stream-name)
* [`sitemaps-cli upload-to-s3 FILE S3-BUCKET`](#sitemaps-cli-upload-to-s3-file-s3-bucket)

## `sitemaps-cli convert URL-OR-FILE`

Convert a sitemap or sitemap index to JSON lines to make it easier to process with tools and editors

```
USAGE
  $ sitemaps-cli convert URL-OR-FILE [--type sitemap|index]

ARGUMENTS
  URL-OR-FILE  URL or file path of sitemap or sitemap index, gzipped or not (.xml or .xml.gz)

FLAGS
  --type=<option>  [default: sitemap] Is the file a sitemap or a sitemap index
                   <options: sitemap|index>

DESCRIPTION
  Convert a sitemap or sitemap index to JSON lines to make it easier to process with tools and editors

EXAMPLES
  $ sitemaps-cli convert --type index https://www.example.com/sitemaps/sitemap-index.xml

  $ sitemaps-cli convert --type index https://www.example.com/sitemaps/sitemap-index.xml.gz

  $ sitemaps-cli convert --type index sitemaps/sitemap-index.xml

  $ sitemaps-cli convert --type sitemap https://www.example.com/sitemaps/sitemap.xml

  $ sitemaps-cli convert --type sitemap sitemaps/sitemap.xml

  $ sitemaps-cli convert --type sitemap sitemaps/sitemap.xml.gz
```

## `sitemaps-cli create`

Create sitemaps and sitemap index files from CSV file or DynamoDB

```
USAGE
  $ sitemaps-cli create

DESCRIPTION
  Create sitemaps and sitemap index files from CSV file or DynamoDB
```

## `sitemaps-cli create from-csv DATA-FILE SITEMAP-DIR-URL BASE-URL [OUTPUT-DIRECTORY] [INDEX-FILE-NAME]`

Create a sitemap index and sitemap files from CSV file

```
USAGE
  $ sitemaps-cli create from-csv DATA-FILE SITEMAP-DIR-URL BASE-URL [OUTPUT-DIRECTORY] [INDEX-FILE-NAME] [-c]
    [--column <value>] [--escape-percent] [-f <value>]

ARGUMENTS
  DATA-FILE         Path to the local data file used to generate the URLs
  SITEMAP-DIR-URL   Sitemap directory URL for the sitemap files, used to write links in the sitemap-index file (e.g.
                    `https://www.example.com/sitemaps/`)
  BASE-URL          Base URL to prefix in front of each keyword (e.g. https://www.example.com/search/)
  OUTPUT-DIRECTORY  [default: ./] Directory to contain all output, the entire sitemap-dir-url structure will be created
                    here, with the index file one directory up from the sitemap files
  INDEX-FILE-NAME   [default: index.xml] Filename for the sitemap index file - will gzip if .gz extension is present

FLAGS
  -c, --compress                        Create .xml.gz files if true
  -f, --base-sitemap-file-name=<value>  [default: sitemap] Base filename of each sitemap file, such as `item-sitemap`
      --column=<value>                  [default: Keywords] Name of the column to use in the CSV file
      --escape-percent                  Escape % in the path input

DESCRIPTION
  Create a sitemap index and sitemap files from CSV file

EXAMPLES
  $ sitemaps-cli create from-csv --base-sitemap-file-name=widget data.csv https://www.example.com/sitemaps/ https://www.example.com/search/ data/ widgets-index.xml

  $ sitemaps-cli create from-csv --column MY_KEYWORD_COLUMN --base-sitemap-file-name=widget data.csv https://www.example.com/sitemaps/ https://www.example.com/search/ ./ widgets-index.xml
```

## `sitemaps-cli create from-dynamodb TABLE-NAME SITEMAP-DIR-URL [OUTPUT-DIRECTORY] [INDEX-FILE-NAME]`

Create a sitemap index and sitemap files from DynamoDB

```
USAGE
  $ sitemaps-cli create from-dynamodb TABLE-NAME SITEMAP-DIR-URL [OUTPUT-DIRECTORY] [INDEX-FILE-NAME] [-c]
    [--consistency-check] [--table-item-type <value>] [--table-file-name <value>] [--create-sitemaps]

ARGUMENTS
  TABLE-NAME        Name of the DynamoDB table to use for the data
  SITEMAP-DIR-URL   Sitemap directory URL for the sitemap files, used to write links in the sitemap-index file (e.g.
                    `https://www.example.com/sitemaps/`)
  OUTPUT-DIRECTORY  [default: ./] Directory to contain all output, the entire sitemap-dir-url structure will be created
                    here, with the index file one directory up from the sitemap files
  INDEX-FILE-NAME   [default: index.xml] Filename for the sitemap index file - will gzip if .gz extension is present

FLAGS
  -c, --compress                 Create .xml.gz files if true
      --consistency-check        Check DynamoDB ItemRecord consistency between itemId and file keys
      --[no-]create-sitemaps     Create sitemap files (only creates index file if false)
      --table-file-name=<value>  `fileName` value of the DynamoDB table items - if not provided then all files will be
                                 created
      --table-item-type=<value>  `type` value of the DynamoDB table items

DESCRIPTION
  Create a sitemap index and sitemap files from DynamoDB

EXAMPLES
  $ sitemaps-cli create from-dynamodb myTable https://www.example.com/sitemaps/

  $ sitemaps-cli create from-dynamodb --table-item-type=widget --table-file-name=widget-00001.xml myTable https://www.example.com/sitemaps/

  $ sitemaps-cli create from-dynamodb --table-item-type=widget --table-file-name=widget-00001.xml myTable https://www.example.com/sitemaps/ data/ widgets-index.xml
```

## `sitemaps-cli download S3-OR-HTTP-URL`

Download sitemap index and all sitemaps linked by a sitemap index

```
USAGE
  $ sitemaps-cli download S3-OR-HTTP-URL [--type sitemap|index] [--extra-format jsonl|sort.jsonl]

ARGUMENTS
  S3-OR-HTTP-URL  s3 or HTTP URL of sitemap or sitemap index file, gzipped or not (.xml or .xml.gz)

FLAGS
  --extra-format=<option>  Extra format to output - original file is saved unmodified
                           <options: jsonl|sort.jsonl>
  --type=<option>          [default: sitemap] Is the file a sitemap or a sitemap index
                           <options: sitemap|index>

DESCRIPTION
  Download sitemap index and all sitemaps linked by a sitemap index
  - Emphasis on not changing the source files at all (if they are gzipped, they will be saved gzipped)
  - `s3://` URLs are supported if AWS credentials are available
  - For indices downloaded from S3, the `http[s]://hostname` of the individual sitemaps will be replaced with the
  `s3://[bucket_name]/` of the sitemap index when computing the s3 source to download

EXAMPLES
  $ sitemaps-cli download --type=index https://www.example.com/sitemaps/widgets-sitemap-index.xml

  $ sitemaps-cli download --type=index https://www.example.com/sitemaps/widgets-sitemap-index.xml.gz

  $ sitemaps-cli download --type=index s3://doc-example-bucket/sitemaps/widgets-sitemap-index.xml

  $ sitemaps-cli download --type=index s3://doc-example-bucket/sitemaps/widgets-sitemap-index.xml.gz

  $ sitemaps-cli download --extra-output=jsonl https://www.example.com/sitemaps/widgets/sitemap.xml

  $ sitemaps-cli download --extra-output=sort.jsonl s3://doc-example-bucket/sitemaps/widgets/sitemap.xml
```

## `sitemaps-cli freshen`

Initiate rewriting a sitemap or all sitemaps in a sitemap index from DynamoDB, optionally repairing missing items in the DB from the XML files

```
USAGE
  $ sitemaps-cli freshen [--dry-run] [--dry-run-db] [--s3-directory-override <value>] [--stream-name <value>]
    [--function-name <value>] [--table-item-type <value>] [--itemid-regex-test-url <value> [--itemid-regex <value>
    --repair-db]] [--filename <value>] [-y]

FLAGS
  -y, --yes
      Skip confirmation prompts

  --[no-]dry-run
      Dry run - Do not write anything to S3 or DynamoDB

  --[no-]dry-run-db
      Dry run DB - Do not write anything to DyanmoDB even if writing to S3

  --filename=<value>
      Single file to process

  --function-name=<value>
      Synchronously invokes the named Lambda function to start a sitemap freshen

  --itemid-regex=<value>
      Regular expression to parse the `ItemID` out of the URL in the S3 sitemaps
      Returned as named match `(?<ItemID>...)`
      MUST match the `ItemID` field in DynamoDB
      EXAMPLE: "^https:\/\/www\.example\.com\/widget-(?<ItemID>[0-9]+)"

  --itemid-regex-test-url=<value>...
      URL to test the `itemIDRegex`
      User will be prompted to confirm that the extracted ID is correct
      EXAMPLE: "https://www.example.com/widget-123456789-super-sale-50%25-off"

  --repair-db
      Repair the DynamoDB table data, taking the following actions:
      - Parses the `ItemID` from the S3 sitemap file `url` field using the `itemid-regex`
      - Adding ItemRecord's for items in the S3 sitemap file that are not present in the DB
      - For items in the S3 sitemap file owned by another file, removing them from the S3 file

  --s3-directory-override=<value>
      s3 directory to override the default upload directory of sitemaps

  --stream-name=<value>
      Asynchronously starts a freshen by writing a message to the Kinesis stream of the sitemap freshener

  --table-item-type=<value>
      `type` value of the DynamoDB table items

DESCRIPTION
  Initiate rewriting a sitemap or all sitemaps in a sitemap index from DynamoDB, optionally repairing missing items in
  the DB from the XML files

EXAMPLES
  $ sitemaps-cli freshen --repair-db --no-dry-run --no-dry-run-db --table-item-type image --function-name some-deploy-sitemap-freshener-lambda-dev --s3-directory-override some-sitemap-dir/ --itemid-regex "^https:\/\/www\.example\.com\/widgets\/(.*-)?(?<ItemID>[0-9]+)$" --itemid-regex-test-url "https://www.example.com/widgets/widget-123451" --itemid-regex-test-url "https://www.example.com/widgets/widget-123452" --itemid-regex-test-url "https://www.example.com/widgets/widget-123453"

  $ sitemaps-cli freshen --repair-db --no-dry-run --no-dry-run-db --table-item-type image --stream-name some-deploy-sitemap-freshener-stream-dev --s3-directory-override some-sitemap-dir/ --itemid-regex "^https:\/\/www\.example\.com\/widgets\/(.*-)?(?<ItemID>[0-9]+)$" --itemid-regex-test-url "https://www.example.com/widgets/widget-123451" --itemid-regex-test-url "https://www.example.com/widgets/widget-123452" --itemid-regex-test-url "https://www.example.com/widgets/widget-123453"
```

## `sitemaps-cli help [COMMAND]`

Display help for sitemaps-cli.

```
USAGE
  $ sitemaps-cli help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for sitemaps-cli.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.0.22/src/commands/help.ts)_

## `sitemaps-cli mirror-to-s3 INDEX-URL S3-BUCKET-URL`

Download remote sitemap index, rewrite the URLs in the index, then upload the sitemaps and sitemap index to the s3 Bucket

```
USAGE
  $ sitemaps-cli mirror-to-s3 INDEX-URL S3-BUCKET-URL

ARGUMENTS
  INDEX-URL      URL of sitemap index file
  S3-BUCKET-URL  S3 Bucket to mirror index file to (e.g. s3://doc-example-bucket)

DESCRIPTION
  Download remote sitemap index, rewrite the URLs in the index, then upload the sitemaps and sitemap index to the s3
  Bucket

EXAMPLES
  $ sitemaps-cli mirror-to-s3 https://www.example.com/sitemaps/sitemap-index.xml s3://doc-example-bucket
```

## `sitemaps-cli test`

Commands to assist in testing, such as publishing kinesis messages for the sitemap writer

```
USAGE
  $ sitemaps-cli test

DESCRIPTION
  Commands to assist in testing, such as publishing kinesis messages for the sitemap writer
```

## `sitemaps-cli test sitemap-writer-stream STREAM-NAME`

Writes test messages to the Kinesis stream for the sitemap writer Lambda function

```
USAGE
  $ sitemaps-cli test sitemap-writer-stream STREAM-NAME --item-type <value> [--number <value>] [--table-name <value>]

ARGUMENTS
  STREAM-NAME  Name of the Kinesis stream to write messages to

FLAGS
  --item-type=<value>   (required) [default: widget] `type` value of the items
  --number=<value>      [default: 1000000] Number of messages to write to the Kinesis stream
  --table-name=<value>  Name of the DynamoDB table to read items from

DESCRIPTION
  Writes test messages to the Kinesis stream for the sitemap writer Lambda function

EXAMPLES
  $ sitemaps-cli test sitemap-writer-stream --number 1000 kinesis-stream-name"

  $ sitemaps-cli test sitemap-writer-stream --table-name my-table --item-type blue-widgets --number 1000 kinesis-stream-name"
```

## `sitemaps-cli upload-to-s3 FILE S3-BUCKET`

Upload local sitemap index and its sitemaps, or a single sitemap, to S3, without modifying the files at all

```
USAGE
  $ sitemaps-cli upload-to-s3 FILE S3-BUCKET [-o] [-r <value>]

ARGUMENTS
  FILE       file path of sitemap or sitemap index
  S3-BUCKET  S3 Bucket to upload to

FLAGS
  -o, --overwrite          Overwrite existing files
  -r, --root-path=<value>  [default: ./] Local path at which the sitemaps can be found using their path in the index
                           file (e.g. `https://www.example.com/sitemaps/widget/sitemap-00001.xml` in the index file
                           would need `rootPath` to point to a local directory containing `sitemaps/widget/` folders

DESCRIPTION
  Upload local sitemap index and its sitemaps, or a single sitemap, to S3, without modifying the files at all

EXAMPLES
  $ sitemaps-cli upload-to-s3 --root-path=./ ./sitemaps/sitemap-index.xml s3://doc-example-bucket

  $ sitemaps-cli upload-to-s3 ./sitemaps/sitemap1.xml s3://doc-example-bucket
```
<!-- commandsstop -->
