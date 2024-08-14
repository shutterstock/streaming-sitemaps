/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import path from 'path';
// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';
import { Args, Command, Flags } from '@oclif/core';
import {
  SitemapIndexWrapper,
  IndexItem,
  SitemapFileWrapper,
} from '@shutterstock/sitemaps-wrapper-lib';
import {
  DBManager,
  ItemRecord,
  IItemRecord,
  FileRecord,
  IFileRecord,
} from '@shutterstock/sitemaps-db-lib';
import { escapeProhibitedPathChars, invisibleCharsRegex } from '@shutterstock/sitemaps-utils-lib';
import { Listr, ListrTask } from 'listr2';
import traverse from 'traverse';
import batch from 'it-batch';

const { promises: fs } = fsExtra;

interface IContext {
  dbFileRecords: IFileRecord[];
  dbItemRecords: IItemRecord[];
  itemRecordsMap: { [key: string]: IItemRecord };
  indexFile: SitemapIndexWrapper;
  dynamoClient: DynamoDBClient;
  dbManager: DBManager;
}

export default class CreateFromDynamoDB extends Command {
  static description = 'Create a sitemap index and sitemap files from DynamoDB';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> myTable https://www.example.com/sitemaps/`,
    `$ <%= config.bin %> <%= command.id %> --table-item-type=widget --table-file-name=widget-00001.xml myTable https://www.example.com/sitemaps/`,
    `$ <%= config.bin %> <%= command.id %> --table-item-type=widget --table-file-name=widget-00001.xml myTable https://www.example.com/sitemaps/ data/ widgets-index.xml`,
  ];

  static args = {
    'table-name': Args.string({
      description: 'Name of the DynamoDB table to use for the data',
      required: true,
    }),
    'sitemap-dir-url': Args.url({
      description:
        'Sitemap directory URL for the sitemap files, used to write links in the sitemap-index file (e.g. `https://www.example.com/sitemaps/`)',
      required: true,
    }),
    'output-directory': Args.directory({
      description:
        'Directory to contain all output, the entire sitemap-dir-url structure will be created here, with the index file one directory up from the sitemap files',
      default: './',
      required: false,
    }),
    'index-file-name': Args.file({
      description: 'Filename for the sitemap index file - will gzip if .gz extension is present',
      default: 'index.xml',
      required: false,
    }),
  };

  static flags = {
    compress: Flags.boolean({
      char: 'c',
      description: 'Create .xml.gz files if true',
      required: false,
      default: false,
    }),
    'consistency-check': Flags.boolean({
      description: 'Check DynamoDB ItemRecord consistency between itemId and file keys',
      required: false,
      default: false,
    }),
    'table-item-type': Flags.string({
      description: '`type` value of the DynamoDB table items',
      required: false,
      multiple: false,
    }),
    'table-file-name': Flags.string({
      description:
        '`fileName` value of the DynamoDB table items - if not provided then all files will be created',
      required: false,
      multiple: false,
    }),
    'create-sitemaps': Flags.boolean({
      description: 'Create sitemap files (only creates index file if false)',
      required: false,
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags: parsedFlags } = await this.parse(CreateFromDynamoDB);

    /**
     * Example: ./
     */
    const outputDirectory = args['output-directory'];

    /**
     * Example: /some/sitemaps (absolute)
     */
    const sitemapFilesPathOnly = args['sitemap-dir-url'].pathname;
    /**
     * Example: ./some/sitemaps (relative)
     * Example: ../../some/other/directory/sitemaps (relative)
     */
    const sitemapFilesLocalDirectory = path.join(outputDirectory, sitemapFilesPathOnly);

    /**
     * Example: index.xml or index.xml.gz
     */
    const indexFileNameWithExt = args['index-file-name'];

    const shouldCompress = parsedFlags.compress || indexFileNameWithExt.endsWith('.gz');

    const tasks = new Listr<IContext>(
      [
        {
          title: 'Creating local directory for sitemap files',
          task: async (ctx: IContext, task) => {
            task.output = `${sitemapFilesLocalDirectory}`;
            await fs.mkdir(sitemapFilesLocalDirectory, { recursive: true });
          },
          options: {
            persistentOutput: true,
          },
        },
        {
          title: `Setting up DynamoDB client for table: ${args['table-name']}`,
          task: (ctx: IContext, task) => {
            // Initially setup the dbclient and s3client
            ctx.dynamoClient = new DynamoDBClient({
              maxAttempts: 16, // maxAttempts defaults to 3
              // Throttling base delay is 500 ms
              // Other error base delay is 100 ms
              // Default strategy is exponential backoff with a max delay of 20 seconds per try
              // regardless of which attempt count it is (exponential backoff up to 20 seocnds, then constant 20 seconds)
            });
            ctx.dbManager = new DBManager({
              client: ctx.dynamoClient,
              tableName: args['table-name']!,
            });
          },
        },
        {
          enabled: () => !parsedFlags['table-file-name'],
          title: 'Getting list of files to read from DynamoDB',
          task: async (ctx: IContext, task) => {
            const content = await FileRecord.loadType(ctx.dbManager, {
              Type: parsedFlags['table-item-type'] || '',
            });

            task.output = `Loaded records: ${content.length}`;
            ctx.dbFileRecords = content;
          },
        },
        {
          enabled: () => !!parsedFlags['table-file-name'],
          title: 'Getting single file to read from DynamoDB',
          task: async (ctx: IContext, task) => {
            const content = await FileRecord.loadOne(ctx.dbManager, {
              Type: parsedFlags['table-item-type'] || '',
              FileName: parsedFlags['table-file-name']!,
            });

            task.output = `Loaded records: ${content ? 1 : 0}`;
            ctx.dbFileRecords = [content];
          },
        },
        {
          enabled: () => !!parsedFlags['table-file-name'] && parsedFlags['consistency-check'],
          title: `Reading all items in file from DynamoDB: ${parsedFlags['table-file-name']}`,
          task: async (ctx: IContext, task) => {
            task.output = `Using table ${args['table-name']}`;
            const content = await ItemRecord.loadFile(
              ctx.dbManager,
              {
                Type: parsedFlags['table-item-type'] || '',
                FileName: parsedFlags['table-file-name']!,
              },
              true,
            );

            task.output = `Loaded records: ${content.length}`;
            ctx.dbItemRecords = content;
          },
        },
        {
          enabled: () => !!parsedFlags['table-file-name'] && parsedFlags['consistency-check'],
          title: 'Checking DynamoDB Item and File record consistency',
          task: async (ctx: IContext, task) => {
            task.output = `Using table ${args['table-name']}`;
            // Fetch the ItemID-keyed record to determine which file
            // currently owns this item
            const itemRecordsMap: { [key: string]: ItemRecord } = {};
            for await (const aBatch of batch(ctx.dbItemRecords, 50)) {
              const items = await ItemRecord.loadMany(
                ctx.dbManager,
                aBatch.map((a) => ({ Type: a.Type, ItemID: a.ItemID })),
              );
              for (const item of items) {
                itemRecordsMap[item.ItemID] = item;
              }
            }

            task.output = `Loaded records: ${Object.keys(itemRecordsMap).length}`;
            ctx.itemRecordsMap = itemRecordsMap;
          },
        },
        {
          enabled: () => parsedFlags['create-sitemaps'],
          title: 'Confirming sitemaps to be created',
          task: async (ctx: IContext, task) => {
            // Total up the count written across all the sitemap files
            let totalCount = 0;
            for (const record of ctx.dbFileRecords) {
              totalCount += record.CountWritten;
            }

            const message = `About to write ${totalCount} sitemap items to ${ctx.dbFileRecords.length} sitemap files`;
            const shortMessage = `Writing ${totalCount} sitemap items to ${ctx.dbFileRecords.length} sitemap files`;

            // Confirm with user if we should proceed
            const confirm = await task.prompt({
              choices: ['y', 'n'],
              correctChoice: 'y',
              message,
              type: 'confirm',
            });
            if (!confirm) {
              task.output = shortMessage;
              this.error('user cancelled');
            }
            // Persist in log
            task.output = message;
          },
        },
        {
          enabled: () => parsedFlags['create-sitemaps'],
          title: 'Creating sitemaps from DB records',
          options: { bottomBar: 16, persistentOutput: true, showTimer: true },
          task: (ctx: IContext, task) => {
            const sitemapTasks: ListrTask<IContext>[] = ctx.dbFileRecords.map((fileRecord) => ({
              task: async (ctx: IContext, task) => {
                const sitemap = new SitemapFileWrapper({
                  compress: shouldCompress,
                  filenameRoot: fileRecord.FileName.replace('.xml', '').replace('.gz', ''),
                  localDirectory: sitemapFilesLocalDirectory,
                  siteBaseURL: args['sitemap-dir-url'].toString(),
                });
                let invisibleCharsEncountered = false;
                let countWritten = 0;
                let countSkipped = 0;

                // FIXME: Since we are reproducing what is in the DB, we should
                // error if there are more than 50,000 items in a single file
                // or if the file is larger than 50MB uncompressed
                // This will be an indication to the user that they need to reduce
                // the size of the file or split it into multiple files

                // Get the items for this file from the DB
                const dbItemRecords = await ItemRecord.loadFile(
                  ctx.dbManager,
                  {
                    Type: fileRecord.Type,
                    FileName: fileRecord.FileName,
                  },
                  true,
                );

                for (const record of dbItemRecords) {
                  // The item is a SitemapItemLoose already
                  const item = record.SitemapItem;

                  // We only do this if there is a single file
                  if (!!parsedFlags['table-file-name'] && parsedFlags['consistency-check']) {
                    const itemByItemID = ctx.itemRecordsMap[record.ItemID];
                    if (itemByItemID !== undefined && itemByItemID.FileName !== record.FileName) {
                      countSkipped++;
                      task.output = `Item ${record.ItemID} is in file ${record.FileName} but should be in ${itemByItemID.FileName} - Skipping`;
                      continue;
                    }
                  }

                  // Cleanup any prohibited path chars
                  const url = escapeProhibitedPathChars(new URL(item.url));
                  item.url = url.toString();

                  // Scrub all invisible chars
                  traverse(item).forEach(function (x) {
                    if (x !== null && x !== undefined && typeof x === 'string') {
                      if (!invisibleCharsEncountered && x.match(invisibleCharsRegex) !== null) {
                        invisibleCharsEncountered = true;
                        task.output =
                          'Encountered invisible unicode chars in sitemap item - scrubbing all invisible chars';
                      }
                      this.update(x.replace(invisibleCharsRegex, ''));
                    }
                  });

                  if (item.video !== undefined && Array.isArray(item.video)) {
                    item.video.forEach((video) => {
                      if (video.duration !== undefined) {
                        // Truncate the durations to the nearest second
                        video.duration = Math.floor(video.duration);
                      }
                    });
                  }

                  await sitemap.write({
                    item,
                    disregardByteLimit: true,
                  });

                  countWritten++;
                }

                await sitemap.end();

                task.output = `Wrote ${countWritten} sitemap items, skipped ${countSkipped}`;
              },
            }));

            return task.newListr(sitemapTasks, {
              concurrent: 8,
              rendererOptions: {
                clearOutput: true,
                showErrorMessage: true,
                showTimer: true,
                showSubtasks: false,
              },
            });
          },
        },
        {
          title: 'Creating sitemap index file',
          task: async (ctx: IContext, task) => {
            const indexPath = path.resolve(path.join(sitemapFilesLocalDirectory, '..'));
            task.output = `${indexPath}`;
            ctx.indexFile = new SitemapIndexWrapper({
              compress: shouldCompress,
              filenameRoot: args['index-file-name'].replace('.xml', '').replace('.gz', ''),
              localDirectory: path.join(sitemapFilesLocalDirectory, '..'),
            });
            await ctx.indexFile.writeArray({
              items: ctx.dbFileRecords.map((file) => ({
                url: `${args['sitemap-dir-url']}${file.FileName}${shouldCompress ? '.gz' : ''}`,
                lastmod: file.TimeLastWrittenISO,
              })),
            });
          },
          options: {
            persistentOutput: true,
          },
        },
        {
          title: 'Saving sitemap index file',
          task: async (ctx: IContext, task) => {
            await ctx.indexFile.end();
          },
        },
      ],
      {
        // @ts-expect-error this is present
        renderer: process.env.LISTR_RENDERER ?? 'default',
        rendererOptions: {
          // showSubtasks: false,
        },
      },
    );

    await tasks.run();
  }
}
