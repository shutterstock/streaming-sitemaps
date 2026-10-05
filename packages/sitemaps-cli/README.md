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
@shutterstock/sitemaps-cli/0.0.0 darwin-arm64 node-v24.21.0
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
* [`sitemaps-cli plugins`](#sitemaps-cli-plugins)
* [`sitemaps-cli plugins add PLUGIN`](#sitemaps-cli-plugins-add-plugin)
* [`sitemaps-cli plugins:inspect PLUGIN...`](#sitemaps-cli-pluginsinspect-plugin)
* [`sitemaps-cli plugins install PLUGIN`](#sitemaps-cli-plugins-install-plugin)
* [`sitemaps-cli plugins link PATH`](#sitemaps-cli-plugins-link-path)
* [`sitemaps-cli plugins remove [PLUGIN]`](#sitemaps-cli-plugins-remove-plugin)
* [`sitemaps-cli plugins reset`](#sitemaps-cli-plugins-reset)
* [`sitemaps-cli plugins uninstall [PLUGIN]`](#sitemaps-cli-plugins-uninstall-plugin)
* [`sitemaps-cli plugins unlink [PLUGIN]`](#sitemaps-cli-plugins-unlink-plugin)
* [`sitemaps-cli plugins update`](#sitemaps-cli-plugins-update)
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
  DATA-FILE           Path to the local data file used to generate the URLs
  SITEMAP-DIR-URL     Sitemap directory URL for the sitemap files, used to write links in the sitemap-index file (e.g.
                      `https://www.example.com/sitemaps/`)
  BASE-URL            Base URL to prefix in front of each keyword (e.g. https://www.example.com/search/)
  [OUTPUT-DIRECTORY]  [default: ./] Directory to contain all output, the entire sitemap-dir-url structure will be
                      created here, with the index file one directory up from the sitemap files
  [INDEX-FILE-NAME]   [default: index.xml] Filename for the sitemap index file - will gzip if .gz extension is present

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
  TABLE-NAME          Name of the DynamoDB table to use for the data
  SITEMAP-DIR-URL     Sitemap directory URL for the sitemap files, used to write links in the sitemap-index file (e.g.
                      `https://www.example.com/sitemaps/`)
  [OUTPUT-DIRECTORY]  [default: ./] Directory to contain all output, the entire sitemap-dir-url structure will be
                      created here, with the index file one directory up from the sitemap files
  [INDEX-FILE-NAME]   [default: index.xml] Filename for the sitemap index file - will gzip if .gz extension is present

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
    [--function-name <value>] [--table-item-type <value>] [--itemid-regex-test-url <value>... [--itemid-regex <value>
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
      Only needed when `repair-db` is enabled
      Regular expression to parse the `ItemID` out of the URL in the S3 sitemaps
      Returned as named match `(?<ItemID>...)`
      MUST match the `ItemID` field in DynamoDB
      EXAMPLE: "^https:\/\/www\.example\.com\/widget-(?<ItemID>[0-9]+)"

  --itemid-regex-test-url=<value>...
      Only needed when `repair-db` is enabled
      URL to test the `itemid-regex`

      User will be prompted to confirm that the extracted ID is correct
      EXAMPLE: "https://www.example.com/widget-123456789-super-sale-50%25-off"

  --repair-db
      Repair the DynamoDB table data, taking the following actions:
      - Parses the `ItemID` from the S3 sitemap file `url` field using the `itemid-regex`
      - Adding ItemRecord's for items in the S3 sitemap file that are not present in the DB
      - For items in the S3 sitemap file owned by another file, removing them from the S3 file

  --s3-directory-override=<value>
      S3 directory to override the default upload directory of sitemaps
      This allows you to write to a different directory than the default,
      enabling evaluation of the results before overwriting the existing
      sitemaps by moving the files with, for example, the AWS CLI or Console

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
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for sitemaps-cli.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.3.0/src/commands/help.ts)_

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

## `sitemaps-cli plugins`

List installed plugins.

```
USAGE
  $ sitemaps-cli plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ sitemaps-cli plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/index.ts)_

## `sitemaps-cli plugins add PLUGIN`

Installs a plugin into sitemaps-cli.

```
USAGE
  $ sitemaps-cli plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into sitemaps-cli.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SITEMAPS_CLI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SITEMAPS_CLI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ sitemaps-cli plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ sitemaps-cli plugins add myplugin

  Install a plugin from a github url.

    $ sitemaps-cli plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ sitemaps-cli plugins add someuser/someplugin
```

## `sitemaps-cli plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ sitemaps-cli plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ sitemaps-cli plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/inspect.ts)_

## `sitemaps-cli plugins install PLUGIN`

Installs a plugin into sitemaps-cli.

```
USAGE
  $ sitemaps-cli plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into sitemaps-cli.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SITEMAPS_CLI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SITEMAPS_CLI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ sitemaps-cli plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ sitemaps-cli plugins install myplugin

  Install a plugin from a github url.

    $ sitemaps-cli plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ sitemaps-cli plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/install.ts)_

## `sitemaps-cli plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ sitemaps-cli plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ sitemaps-cli plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/link.ts)_

## `sitemaps-cli plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sitemaps-cli plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sitemaps-cli plugins unlink
  $ sitemaps-cli plugins remove

EXAMPLES
  $ sitemaps-cli plugins remove myplugin
```

## `sitemaps-cli plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ sitemaps-cli plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/reset.ts)_

## `sitemaps-cli plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sitemaps-cli plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sitemaps-cli plugins unlink
  $ sitemaps-cli plugins remove

EXAMPLES
  $ sitemaps-cli plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/uninstall.ts)_

## `sitemaps-cli plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sitemaps-cli plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sitemaps-cli plugins unlink
  $ sitemaps-cli plugins remove

EXAMPLES
  $ sitemaps-cli plugins unlink myplugin
```

## `sitemaps-cli plugins update`

Update installed plugins.

```
USAGE
  $ sitemaps-cli plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.5.2/src/commands/plugins/update.ts)_

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
