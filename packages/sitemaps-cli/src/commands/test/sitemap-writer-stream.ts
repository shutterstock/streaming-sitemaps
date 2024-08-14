/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import * as kinesis from '@aws-sdk/client-kinesis';
import { Args, Command, Flags } from '@oclif/core';
import { Chunker } from '@shutterstock/chunker';
import { DBManager, FileRecord, IFileRecord, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { KinesisRetrier, KinesisBackgroundWriter } from '@shutterstock/kinesis-helpers';
import { ISitemapWriterItem } from '@shutterstock/sitemaps-models-lib';
import { Listr } from 'listr2';
import cliProgress from 'cli-progress';
import { EnumChangefreq } from 'sitemap';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

type Writable<T> = {
  -readonly [P in keyof T]: T[P];
};

const kinesisClient = new kinesis.KinesisClient({
  maxAttempts: 4, // maxAttempts defaults to 3
  // Throttling base delay is 500 ms
  // Other error base delay is 100 ms
  // Default strategy is exponential backoff with a max delay of 20 seconds per try
  // regardless of which attempt count it is (exponential backoff up to 20 seocnds, then constant 20 seconds)
});

interface IContext {
  /**
   * This retries the portion of records in a batch that failed to write to a stream
   */
  readonly kinesisRetrier: KinesisRetrier;

  /**
   * Returns immediately if a concurrent slot is available, otherwise waits
   * for a slot to become available and then returns.
   */
  readonly kinesisBackgroundWriter: KinesisBackgroundWriter;

  /**
   * Batches up the items when they meet or exceed the size or count limits
   * and sends them to the Kinesis stream.
   */
  readonly chunker: Chunker<kinesis.PutRecordsRequestEntry>;

  /**
   * DynamoDB client for reading items from the table
   */
  readonly dynamoClient: DynamoDBClient;

  /**
   * DynamoDB manager for reading items from the table
   */
  readonly dbManager: DBManager;

  /**
   * DynamoDB files for the specified type
   */
  readonly dbFileRecords: IFileRecord[];
}

type IWritableContext = Writable<IContext>;

export default class TestSitemapWriterStream extends Command {
  static description =
    'Writes test messages to the Kinesis stream for the sitemap writer Lambda function';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> --number 1000 kinesis-stream-name"`,
    `$ <%= config.bin %> <%= command.id %> --table-name my-table --item-type blue-widgets --number 1000 kinesis-stream-name"`,
  ];

  static args = {
    'stream-name': Args.string({
      description: 'Name of the Kinesis stream to write messages to',
      required: true,
    }),
  };

  static flags = {
    number: Flags.integer({
      description: 'Number of messages to write to the Kinesis stream',
      default: 1_000_000,
      multiple: false,
    }),
    'item-type': Flags.string({
      description: '`type` value of the items',
      required: true,
      multiple: false,
      default: 'widget',
    }),
    'table-name': Flags.string({
      description: 'Name of the DynamoDB table to read items from',
      required: false,
      multiple: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags: parsedFlags } = await this.parse(TestSitemapWriterStream);

    const tasks = new Listr<IContext>(
      [
        {
          title: 'Setup Kinesis helpers',
          task: (ctx: IWritableContext) => {
            // Pipeline:
            // Chunker -> KinesisBackgroundWriter -> KinesisRetrier -> KinesisClient
            ctx.kinesisRetrier = new KinesisRetrier({
              kinesisClient,
            });
            ctx.kinesisBackgroundWriter = new KinesisBackgroundWriter({
              concurrency: 1,
              kinesisClient: ctx.kinesisRetrier,
            });

            // Create a chunker for this topic to size the Kinesis payloads
            ctx.chunker = new Chunker({
              countLimit: 500,
              sizeLimit: 5 * 1024 * 1024 * 0.95, // Stay under the 5 MB size limit
              sizer: (item: kinesis.PutRecordsRequestEntry): number => {
                const itemJSON = JSON.stringify(item);
                return itemJSON.length;
              },
              writer: async (records: kinesis.PutRecordsRequestEntry[]): Promise<void> => {
                // We don't get a result because this await only waits till the write is queued
                await ctx.kinesisBackgroundWriter.send(
                  new kinesis.PutRecordsCommand({
                    StreamName: args['stream-name'],
                    Records: records,
                  }),
                );
              },
            });
          },
        },
        {
          enabled: () => !!parsedFlags['table-name'],
          title: `Setting up DynamoDB client for table: ${parsedFlags['table-name']}`,
          task: (ctx: IWritableContext, task) => {
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
              tableName: parsedFlags['table-name']!,
            });
          },
        },
        {
          enabled: () => !!parsedFlags['table-name'],
          title: `Getting list of files from: ${parsedFlags['table-name']}, for type: ${parsedFlags['item-type']}`,
          task: async (ctx: IContext, task) => {
            const content = await FileRecord.loadType(ctx.dbManager, {
              Type: parsedFlags['item-type'] || '',
            });

            if (content.length === 0) {
              this.error(
                `No records found in table: ${parsedFlags['table-name']}, for type: ${parsedFlags['item-type']}`,
              );
            }

            task.output = `Loaded records: ${content.length}`;
            (ctx as IWritableContext).dbFileRecords = content;
          },
        },
        {
          title: 'Confirm parameters',
          task: async (ctx: IContext, task) => {
            const params = {
              'stream-name': args['stream-name'],
              number: parsedFlags['number'],
              ...(parsedFlags['table-name']
                ? {
                    'table-name': parsedFlags['table-name'],
                    'item-type': parsedFlags['item-type'],
                  }
                : {}),
            };
            const confirm = await task.prompt({
              choices: ['y', 'n'],
              correctChoice: 'y',
              message: `Are you sure you want to start pushing sitemap-writer test data to the Kinesis Stream with parameters?
${JSON.stringify(params, undefined, 2)}?`,
              type: 'confirm',
            });
            if (!confirm) {
              this.error('user cancelled');
            }
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

    // Wait for the setup tasks to finish
    await tasks.run();

    //
    // Primary task with progress bar - cannot be run inside of listr2
    //

    const progressBar = new cliProgress.SingleBar(cliProgress.Presets.shades_classic);

    const urlEncodedItemType = encodeURIComponent(parsedFlags['item-type']);

    if (parsedFlags['table-name']) {
      // Using the DynamoDB table as data source
      const totalDbItems = tasks.ctx.dbFileRecords.reduce((acc, cur) => acc + cur.CountWritten, 0);
      const totalItems = Math.min(parsedFlags.number, totalDbItems);
      progressBar.start(totalItems, 0);
      let i = 0;
      for (const fileRecord of tasks.ctx.dbFileRecords) {
        if (i >= totalItems) {
          break;
        }
        // Get the items for the file
        const items = await ItemRecord.loadFile(tasks.ctx.dbManager, fileRecord, true);
        for (const item of items) {
          if (i >= totalItems) {
            break;
          }
          if (tasks.ctx.chunker.errors.length > 0) {
            this.error(tasks.ctx.chunker.errors[0] as Error);
          }
          if (tasks.ctx.kinesisBackgroundWriter.errors.length > 0) {
            this.error(tasks.ctx.kinesisBackgroundWriter.errors[0] as Error);
          }

          if (item.ItemStatus !== 'written' && item.ItemStatus !== 'towrite') {
            // Skip items that are not written or towrite
            // We skip
            continue;
          } else {
            const sitemapWriterItem: ISitemapWriterItem = {
              customId: item.ItemID,
              sitemapItem: item.SitemapItem,
              type: item.Type,
            };

            const dataBuffer = Buffer.from(JSON.stringify(sitemapWriterItem), 'utf-8');

            // Send the item with backpressure
            await tasks.ctx.chunker.enqueue({
              PartitionKey: item.ItemID,
              Data: dataBuffer,
            });
          }

          // Update the progress bar
          progressBar.update(i + 1);
          i++;
        }
      }
    } else {
      // Purely generating fake data
      progressBar.start(parsedFlags.number, 0);
      for (let i = 0; i < parsedFlags.number; i++) {
        if (tasks.ctx.chunker.errors.length > 0) {
          this.error(tasks.ctx.chunker.errors[0] as Error);
        }
        if (tasks.ctx.kinesisBackgroundWriter.errors.length > 0) {
          this.error(tasks.ctx.kinesisBackgroundWriter.errors[0] as Error);
        }

        // Pad the number out to 10 digits
        const paddedId = i.toString().padStart(10, '0');
        const sitemapWriterItem: ISitemapWriterItem = {
          customId: paddedId,
          sitemapItem: {
            url: `https://example.com/${urlEncodedItemType}/${paddedId}.html`,
            lastmod: new Date(Date.UTC(1980, 11, 19)).toISOString(),
            changefreq: EnumChangefreq.DAILY,
          },
          ...(parsedFlags['item-type'] ? { type: parsedFlags['item-type'] } : {}),
          // TODO: Allow specifying the compactVersion
          // compactVersion: config.compactVersion === 0 ? undefined : config.compactVersion,
        };
        const dataBuffer = Buffer.from(JSON.stringify(sitemapWriterItem), 'utf-8');

        // Send the item with backpressure
        await tasks.ctx.chunker.enqueue({
          PartitionKey: `item-${paddedId}`,
          Data: dataBuffer,
        });

        // Update the progress bar
        progressBar.update(i + 1);
      }
    }

    progressBar.stop();

    //
    // Cleanup tasks
    //
    const tasks2 = new Listr<IContext>(
      [
        {
          title: 'Wait for the helpers to finish',
          task: async (_ctx: IContext) => {
            if (tasks.ctx.chunker.errors.length > 0) {
              this.error(tasks.ctx.chunker.errors[0] as Error);
            }
            if (tasks.ctx.kinesisBackgroundWriter.errors.length > 0) {
              this.error(tasks.ctx.kinesisBackgroundWriter.errors[0] as Error);
            }

            // Wait for the chunker to push all records into the background writer
            await tasks.ctx.chunker.onIdle();
            // Wait for the background writer to finish any in progress writes
            await tasks.ctx.kinesisBackgroundWriter.onIdle();
          },
        },
      ],
      {
        // @ts-expect-error this is present
        renderer: process.env.LISTR_RENDERER ?? 'default',
        rendererOptions: {
          // showSubtasks: false,
        },
        context: tasks.ctx,
      },
    );

    await tasks2.run();
  }
}
