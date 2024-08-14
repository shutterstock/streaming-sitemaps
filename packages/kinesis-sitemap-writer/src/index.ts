import 'reflect-metadata';
import 'source-map-support/register';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as kinesis from '@aws-sdk/client-kinesis';
import { S3Client } from '@aws-sdk/client-s3';
import https from 'https';
import zlib from 'zlib';
import AggregateError from 'aggregate-error';
import type * as lambda from 'aws-lambda';
import type { ISitemapWriterItem } from '@shutterstock/sitemaps-models-lib';
import {
  metricScope,
  Unit as metricUnit,
  Configuration as metricConfiguration,
} from 'aws-embedded-metrics';
import { FlatCountMetrics, metricScopeDummy } from '@shutterstock/aws-embedded-metrics-flatten';
import { Chunker } from '@shutterstock/chunker';
import { IterableMapper, IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
import { Config } from './config/config';
import {
  SitemapWriterMetrics,
  SitemapWriterTypedMetrics,
} from '@shutterstock/sitemaps-metrics-lib';
import { SitemapWrapperOverrideAWSClients } from '@shutterstock/sitemaps-wrapper-lib';
import batch from 'it-batch';
import { DBManager, ItemRecord, ShardStateRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapFileAndStats } from './sitemap-file-stats';
import {
  backgroundUploadSitemapWorker,
  rotateSitemapFile,
  s3BackgroundUploader,
  s3BackgroundUploaderOptions,
  writeOrRotateAndWrite,
} from './sitemap-rotate';
import { loadInitialSitemapFile } from './sitemap-load-initial';
import { log } from './utils/log';
import { VError } from 'verror';
import { KinesisBackgroundWriter, KinesisRetrier } from '@shutterstock/kinesis-helpers';

const config = Config.instance;

// Initially setup the dbclient and s3client
let dbManager: DBManager;
let dynamoClient = captureAWSv3Client(
  new DynamoDBClient({
    maxAttempts: 16, // maxAttempts defaults to 3
    // Throttling base delay is 500 ms
    // Other error base delay is 100 ms
    // Default strategy is exponential backoff with a max delay of 20 seconds per try
    // regardless of which attempt count it is (exponential backoff up to 20 seocnds, then constant 20 seconds)
  }),
);
dbManager = new DBManager({ client: dynamoClient, tableName: config.tableName });
const s3Client = captureAWSv3Client(
  new S3Client({
    maxAttempts: 16,
  }),
);
const kinesisClient = captureAWSv3Client(
  new kinesis.KinesisClient({
    maxAttempts: 16,
  }),
);
SitemapWrapperOverrideAWSClients({ s3Client });

export function overrideDBManager(opts: {
  dbManager: DBManager;
  dynamoClient: DynamoDBClient;
}): void {
  dbManager = opts.dbManager;
  dynamoClient = opts.dynamoClient;
}

metricConfiguration.namespace = config.metricsNamespace;

log.info('rendered config', { config, maxSockets: https.globalAgent.maxSockets });
log.info('config files found', { configFiles: Config.configFiles });

process.on('uncaughtException', (error) => {
  log.error('uncaughtException');
  log.error(error, { extraMsg: 'uncaughtException' });
});
process.on('unhandledRejection', (error) => {
  log.error('unhandledRejection');
  if (error !== undefined && error !== null && typeof error === 'object') {
    log.error(error as Error, { extraMsg: 'unhandledRejection' });
  }
});

const enableMetricScope = config.emitMetrics ? metricScope : metricScopeDummy;

export const handler = enableMetricScope(
  (metrics) =>
    async (payload: lambda.KinesisStreamEvent, context?: lambda.Context): Promise<void> => {
      const startTime = Date.now();
      const flatMetrics = new FlatCountMetrics();
      let lastSeenItem: ISitemapWriterItem | undefined = undefined;
      let lastFileName: string | undefined = undefined;

      const shardId = parseInt(
        (payload.Records.length > 0
          ? payload.Records[0].eventID.split(':')[0]
          : 'shardId-000000000000'
        )
          .split('-')
          .pop() as string,
        10,
      );

      // Pipeline:
      // Chunker -> KinesisBackgroundWriter -> KinesisRetrier -> KinesisClient
      const kinesisRetrier = new KinesisRetrier({
        kinesisClient,
      });
      const kinesisBackgroundWriter = new KinesisBackgroundWriter({
        concurrency: 1,
        kinesisClient: kinesisRetrier,
      });
      const chunkerCompact = new Chunker({
        countLimit: 500,
        sizeLimit: 5 * 1024 * 1024 * 0.95, // Stay under the 5 MB size limit
        sizer: (item: kinesis.PutRecordsRequestEntry): number => {
          const itemJSON = JSON.stringify(item);
          return itemJSON.length;
        },
        writer: async (records: kinesis.PutRecordsRequestEntry[]): Promise<void> => {
          // We don't get a result because this await only waits till the write is queued
          await kinesisBackgroundWriter.send(
            new kinesis.PutRecordsCommand({
              StreamName: config.kinesisSelfStreamName,
              Records: records,
            }),
          );
        },
      });

      // Set logger request-specific context
      log.options.meta = {
        env: Config.envLevel,
      };

      try {
        metrics.setProperty('RequestId', context?.awsRequestId);
        metrics.setProperty('Env', Config.envLevel);

        metrics.putMetric(SitemapWriterMetrics.EventReceived, 1, metricUnit.Count);
        metrics.putMetric(
          SitemapWriterMetrics.MsgReceived,
          payload.Records.length,
          metricUnit.Count,
        );
        await metrics.flush();

        log.info('grouping messages by type');
        const messagesByType = groupMessagesByType({ payload, flatMetrics, shardId });
        log.info('finished grouping messages by type');
        // @ts-expect-error - Free the input Records - Make sure they are not touched again
        delete payload.Records;

        //
        // Loop through the consolidated list of items by type
        //
        for (const type of Object.keys(messagesByType)) {
          log.info('top of type loop', { type });

          const flatMetricsTyped = new FlatCountMetrics();
          flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.TypeStarted, 1, metricUnit.Count);
          flatMetricsTyped.putMetric(
            SitemapWriterTypedMetrics.Items,
            messagesByType[type].length,
            metricUnit.Count,
          );

          //
          // Create a background s3 file uploader and dynamodb writer
          //
          const s3Uploader: s3BackgroundUploader =
            new IterableQueueMapperSimple<s3BackgroundUploaderOptions>(
              backgroundUploadSitemapWorker,
              { concurrency: config.s3ConcurrentWrites },
            );
          const dbWriter = new IterableQueueMapperSimple(
            async (records: ItemRecord[]): Promise<void> => {
              await ItemRecord.saveMany(dbManager, records);
            },
            { concurrency: config.dynamoDBConcurrentWrites },
          );

          // Create a chunker for this topic to size batch the ItemRecord writes
          const itemChunker = new Chunker({
            countLimit: 25,
            // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
            sizeLimit: 16 * 1024 * 1024 * 0.95, // Stay under the 16 MB size limit
            sizer: (item: ItemRecord): number => {
              const itemJSON = JSON.stringify(item);
              return itemJSON.length;
            },
            writer: async (records: ItemRecord[]): Promise<void> => {
              // Return immediately if there is a slot, else wait for a slot to free up
              await dbWriter.enqueue(records);
            },
          });

          let shardState: ShardStateRecord | undefined = undefined;
          let currentSitemap: SitemapFileAndStats | undefined = undefined;

          try {
            const itemStateCache: { [customId: string]: ItemRecord } = {};

            log.info('de-duplicating records in the input', { type });

            // Use only the most recent message for each item id
            const items: DecodedPlusPayload[] = [];
            const uniqueItems: { [customId: string]: DecodedPlusPayload } = {};
            messagesByType[type].map((value) => {
              if (uniqueItems[value.sitemapWriterItem.customId] !== undefined) {
                flatMetricsTyped.putMetric(
                  SitemapWriterTypedMetrics.DuplicateSkippedInput,
                  1,
                  metricUnit.Count,
                );
                // log.warn('duplicate coalesced in input data', {
                //   type,
                //   customId: value.customId,
                //   url: value.sitemapItem.url,
                // });
              }
              uniqueItems[value.sitemapWriterItem.customId] = value;
            });
            Object.keys(uniqueItems).map((key) => {
              items.push(uniqueItems[key]);
            });

            // Load the shard state
            log.info('getting shard state', { type });
            shardState =
              (await ShardStateRecord.loadOne(dbManager, {
                Type: type,
                ShardId: shardId,
              })) ||
              new ShardStateRecord({
                Type: type,
                ShardId: shardId,
              });

            log.info('got shard state', { type, shardState: shardState.dbStruct });

            // Save the last file name for debugging
            lastFileName = shardState.CurrentFileName;

            if (items.length === 0) {
              log.warn('skipping processing of message type due to no items', {
                type,
                itemsCount: items.length,
              });

              flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.NoItems, 1, metricUnit.Count);
              continue;
            }

            log.info('starting processing of message type', { type, itemsCount: items.length });

            // Prefetch the Item DB info in the background
            const itemStatePrefetcher = createItemStatePreFetcher({
              items,
              type,
              flatMetricsTyped,
            });

            // Loop through the pre-fetched DynamoDB states
            for await (const itemAndItemStateBatch of itemStatePrefetcher) {
              if (itemAndItemStateBatch.error !== undefined) {
                log.error(itemAndItemStateBatch.error, {
                  extraMsg: 'item state prefetcher encountered an error',
                });
                throw itemAndItemStateBatch.error;
              }
              if (itemAndItemStateBatch.items === undefined) {
                throw new TypeError('items was undefined');
              }

              for (const itemAndItemState of itemAndItemStateBatch.items) {
                const { item: rawItem, itemState } = itemAndItemState;
                // Hold onto the item for error reporting
                lastSeenItem = rawItem.sitemapWriterItem;

                // Bail out if the background uploader encountered any error
                if (s3Uploader.errors.length > 0) {
                  log.error(
                    's3 background uploader encountered errors - bailing out of file iteration',
                    {
                      type,
                    },
                  );
                  throw new AggregateError(s3Uploader.errors);
                }
                if (dbWriter.errors.length > 0) {
                  log.error(
                    'DynamoDB background writer encountered errors - bailing out of file iteration',
                    {
                      type,
                    },
                  );
                  throw new AggregateError(dbWriter.errors);
                }
                // Bail out if the background uploader encountered any error
                if (kinesisBackgroundWriter.errors.length > 0) {
                  metrics.putMetric(
                    SitemapWriterMetrics.KinesisBackgroundWriterError,
                    kinesisBackgroundWriter.errors.length,
                    metricUnit.Count,
                  );
                  log.error('kinesis background writer encountered errors - bailing out', {
                    type,
                    errors: kinesisBackgroundWriter.errors,
                  });
                  throw new AggregateError(kinesisBackgroundWriter.errors);
                }

                const { customId } = rawItem.sitemapWriterItem;

                // Check if the item is already known
                // We always check the in memory cache
                // We optionally check DynamoDB
                const item = itemStateCache[customId] || itemState;
                let shouldWriteToXML = true;
                // Check if this record should be compacted (not written back to the stream)
                // Compaction is in effect when the incomingCompactVersion is set and the
                // incoming record has no compactVersion OR is less than the incomingCompactVersion
                let recordShouldBeCompacted = false;
                if (config.incomingCompactVersion > 0) {
                  if (
                    rawItem.sitemapWriterItem.compactVersion === undefined ||
                    rawItem.sitemapWriterItem.compactVersion < config.incomingCompactVersion
                  ) {
                    recordShouldBeCompacted = true;
                  }
                }
                if (item !== undefined) {
                  // This item exists: if it's from a different filename we've got a duplicate
                  if (recordShouldBeCompacted) {
                    shouldWriteToXML = false;
                    flatMetricsTyped.putMetric(
                      SitemapWriterTypedMetrics.DuplicateCompacted,
                      1,
                      metricUnit.Count,
                    );
                  } else if (item.FileName !== shardState.CurrentFileName) {
                    shouldWriteToXML = false;
                    flatMetricsTyped.putMetric(
                      SitemapWriterTypedMetrics.DuplicateSkipped,
                      1,
                      metricUnit.Count,
                    );
                    // 2022-03-17 - Too expensive when backfill records are present
                    // log.warn('duplicate, sitemap file does not match', {
                    //   type,
                    //   customId,
                    //   url: rawItem.sitemapItem.url,
                    //   usingSitemapFilename: shardState.CurrentFileName,
                    // });

                    // TODO: Load the prior file state and mark that it's dirty again
                  } else {
                    // We got another instance of the same item during writing
                    // of a single new sitemap file.  This *should* be allowed, but,
                    // the sitemap writer writes directly to the file without batching
                    // and consolidating items with the same ID, so this would write two
                    // lines with the same item on them.
                    shouldWriteToXML = false;
                    flatMetricsTyped.putMetric('DuplicateSkippedSameFile', 1, metricUnit.Count);
                    // 2022-03-17 - Too expensive when backfill records are present
                    // log.warn('duplicate, sitemap file matches but item already written', {
                    //   type,
                    //   customId,
                    //   url: rawItem.sitemapItem.url,
                    //   usingSitemapFilename: shardState.CurrentFileName,
                    // });

                    // We can mark the current file dirty since an item in it has been updated
                    if (currentSitemap !== undefined) {
                      currentSitemap.stats.ResetTimeDirtiedISO();
                    }
                  }
                }

                // Loop around if this item can't be written
                if (!shouldWriteToXML) {
                  item.ResetTimeDirtiedISO();
                  item.SitemapItem = rawItem.sitemapWriterItem.sitemapItem;

                  // Save the updated item in the cache
                  itemStateCache[customId] = item;

                  // Save the updated SitemapItemLoose data to the DB
                  // This makes it easy to freshen the file using the latest DB
                  // contents for each item
                  if (config.storeItemStateInDynamoDB) {
                    await itemChunker.enqueue(item);
                  }
                  continue;
                }

                // Loop around if we're compacting this record but it's not a duplicate
                if (recordShouldBeCompacted) {
                  flatMetricsTyped.putMetric(
                    SitemapWriterTypedMetrics.UniqueCompacted,
                    1,
                    metricUnit.Count,
                  );

                  // Set compactVersion to the version we're expecting
                  rawItem.sitemapWriterItem.compactVersion = config.incomingCompactVersion;

                  // Write back to our own stream
                  // Tell the chunker to write the item, eventually
                  const dataBuffer = Buffer.from(
                    JSON.stringify(rawItem.sitemapWriterItem),
                    'utf-8',
                  );
                  // zlib kinda sucks TBH
                  // if (config.compressRecords) {
                  //   dataBuffer = await deflateAsync(dataBuffer);
                  // }
                  await chunkerCompact.enqueue({
                    Data: dataBuffer,
                    PartitionKey: rawItem.payload.partitionKey,
                  });
                  continue;
                }

                //
                // currentSitemap may not have been loaded until this point
                // We get batches of updated records that have nothing to write, so we do not
                // load or parse the existing sitemap file until we hit the first record that
                // needs to be written (if any)
                //
                if (currentSitemap === undefined) {
                  //
                  // Load the sitemap file off of S3 or create a new one
                  // NOTE: This is an EXPENSIVE operation to parse the existing XML
                  // (can be up to 30 seconds to parse a > 30 MB XML file)
                  //
                  currentSitemap = await loadInitialSitemapFile({
                    config,
                    dbManager,
                    shardState,
                    flatMetricsTyped,
                  });

                  // Save the last file name for debugging
                  lastFileName = shardState.CurrentFileName;
                }

                // Create a new sitemap file whenever the last one fills up
                if (currentSitemap.sitemap.full) {
                  currentSitemap = await rotateSitemapFile({
                    sitemapAndStats: currentSitemap,
                    s3Uploader,
                    flatMetricsTyped,
                    shardState,
                    config,
                    dbManager,
                    kinesisClient,
                  });

                  // Save the last file name for debugging
                  lastFileName = shardState.CurrentFileName;
                }

                // Write this single item
                currentSitemap = await writeOrRotateAndWrite({
                  currentSitemap,
                  item: rawItem.sitemapWriterItem,
                  s3Uploader,
                  flatMetricsTyped,
                  shardState,
                  config,
                  dbManager,
                  kinesisClient,
                });
                // Save the last file name for debugging
                lastFileName = shardState.CurrentFileName;

                // Record that we added an item to whatever the current sitemap file is
                shardState.AddFileItem();
                currentSitemap.stats.AddFileItem();

                // This item doesn't exist yet, save which file we wrote it to
                const newitem = new ItemRecord({
                  Type: type,
                  ItemID: customId,
                  FileName: shardState.CurrentFileName,
                  SitemapItem: rawItem.sitemapWriterItem.sitemapItem,
                });
                itemStateCache[customId] = newitem;
                if (config.storeItemStateInDynamoDB) {
                  await itemChunker.enqueue(newitem);
                }

                flatMetricsTyped.putMetric(
                  SitemapWriterTypedMetrics.SitemapItemWritten,
                  1,
                  metricUnit.Count,
                );
              }
            }
            // ^^^ END of Item Loop

            if (s3Uploader.errors.length > 0) {
              log.error('cleanup - there were errors with s3 background uploads - throwing', {
                type,
              });
              throw new AggregateError(s3Uploader.errors);
            }
            if (dbWriter.errors.length > 0) {
              log.error('cleanup - there were errors with DynamoDB background writes - throwing', {
                type,
              });
              throw new AggregateError(dbWriter.errors);
            }
            if (kinesisBackgroundWriter.errors.length > 0) {
              log.error('cleanup - there were errors with Kinesis background writes - throwing', {
                type,
              });
              throw new AggregateError(kinesisBackgroundWriter.errors);
            }

            log.info('finished type', { type });
            flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.TypeDone, 1, metricUnit.Count);
          } catch (error) {
            flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.TypeFailed, 1, metricUnit.Count);
            log.error(error as Error, {
              caughtException: true,
              type,
              extraMsg: 'Caught exception at top of type loop',
              lastFileName,
              lastSeenItem,
            });

            // Re-throw so the batch will stall or be retried and succeed
            throw error;
          } finally {
            // Flush the metrics collected by the type handler
            const metricsTyped = metrics.new();
            metricsTyped.putDimensions({ SitemapType: type });
            flatMetricsTyped.flush(metricsTyped);
            await metricsTyped.flush();

            // Close the current file and push to S3
            if (currentSitemap !== undefined) {
              if (
                currentSitemap.stats.FileStatus === 'empty' &&
                currentSitemap.sitemap.count === 0
              ) {
                log.warn('current sitemap has no items written to it', {
                  type,
                });

                try {
                  await currentSitemap.sitemap.end();
                } catch {
                  // Discard this exception
                }
              } else {
                log.info('uploading last sitemap - starting', {
                  type,
                });
                await s3Uploader.enqueue({
                  sitemapAndStats: currentSitemap,
                  type,
                  config,
                  dbManager,
                  kinesisClient,
                  infixDirs: config.infixDirs,
                });
              }

              // Wait for all S3 sitemap uploads to finish
              await s3Uploader.onIdle();
              log.info('uploading last sitemap - finished', {
                type,
              });

              // Save the final shard and file state
              await shardState?.save(dbManager);
              await currentSitemap?.stats.save(dbManager);

              // Flush the chunker to the DB Writer, then wait for the DB Writer to finish
              await itemChunker.onIdle();
              await dbWriter.onIdle();
            }
          }
        }
        // ^^^ END of Type Loop

        log.info('finished payload');
        metrics.putMetric(SitemapWriterMetrics.EventComplete, 1, metricUnit.Count);
      } catch (error) {
        metrics.putMetric(SitemapWriterMetrics.EventFailed, 1, metricUnit.Count);
        log.error(error as Error, {
          caughtException: true,
          extraMsg: 'Caught exception at top level',
          lastFileName,
          lastSeenItem,
        });

        // Re-throw so the batch will stall or be retried and succeed
        throw error;
      } finally {
        await chunkerCompact.onIdle();
        await kinesisBackgroundWriter.onIdle();

        metrics.putMetric(
          SitemapWriterMetrics.DurationMS,
          Date.now() - startTime,
          metricUnit.Milliseconds,
        );
        // Output the counts metrics as single value metrics instead of arrays of thousands
        flatMetrics.flush(metrics);
      }
    },
);

type MessagesByType = {
  [type: string]: DecodedPlusPayload[];
};

/**
 * We will have multiple records.  We want to group items across all records
 * that are of the same type (e.g. widget) so that we read and parse
 * any prior sitemap file for this shard and type only once.
 * @param opts
 * @returns
 */

export function groupMessagesByType(opts: {
  flatMetrics: FlatCountMetrics;
  payload: lambda.KinesisStreamEvent;
  shardId: number;
}): MessagesByType {
  const { flatMetrics, payload, shardId } = opts;
  const messagesByType: MessagesByType = {};

  for (const record of payload.Records) {
    // Example:
    // "eventID": "shardId-000000000000:49625148559272883496733425358362899333280976872660795394",
    const thisRecordShardId = parseInt(record.eventID.split(':')[0].split('-').pop() as string, 10);

    if (shardId !== thisRecordShardId) {
      // This should never happen... but let's just make sure as it would break our logic
      throw new Error(
        `Received mix-matched shardIds in a single invocation - first record: ${shardId}, later saw: ${thisRecordShardId}`,
      );
    }

    const dataBuff = Buffer.from(record.kinesis.data, 'base64');

    // Yeah yeah yeah, `inflateSync` blocks the event loop...
    // Except:
    //   1) We block the event loop anyway because we have to decompress everything before starting
    //   2) Making the decompression happening with an IterableQueue with back pressure didn't help
    //   3) `inflateSync` is up to 4x faster than `inflate` using the benchmark in `node`:
    //      https://github.com/nodejs/node/blob/master/benchmark/zlib/inflate.js
    //
    // Benchmark Results (rate, elapsed)
    // =================
    // node tests/index.js
    // tests/index.js n=800000 inputLen=1024 method="inflateSyncParallel": 270,300.9035812546, 2.959664542
    // tests/index.js n=800000 inputLen=1024 method="inflate": 73,536.01542054949, 10.879022958
    // tests/index.js n=800000 inputLen=1024 method="inflateSync": 261,844.48409660932, 3.055248625
    // tests/index.js n=800000 inputLen=1024 method="inflateParallel": 127,317.08136094638, 6.283524500
    const dataStr = (dataBuff.readUInt8() === 120 ? zlib.inflateSync(dataBuff) : dataBuff).toString(
      'utf-8',
    );
    const data: DecodedPlusPayload = {
      sitemapWriterItem: JSON.parse(dataStr) as ISitemapWriterItem,
      payload: record.kinesis,
    };

    if (config.throwOnCompactVersion > 0) {
      // Throw out of the Lambda if we encounter a specific compactVersion
      // This is typically done when compacting and needing the processing
      // to not process the newly written compacted records until a human
      // intervenes (e.g. to set parallelization-factor back to 1)
      if (data.sitemapWriterItem.compactVersion === config.throwOnCompactVersion) {
        flatMetrics.putMetric(SitemapWriterMetrics.ExceptionCompactVersion, 1, metricUnit.Count);

        throw new Error(
          `Throwing due to compactVersion encountered: ${config.throwOnCompactVersion}`,
        );
      }
    }

    // Skip if no sitemapItem or url
    if (
      data.sitemapWriterItem.sitemapItem === undefined ||
      data.sitemapWriterItem.sitemapItem.url === undefined ||
      data.sitemapWriterItem.type === undefined
    ) {
      flatMetrics.putMetric(SitemapWriterMetrics.MsgSkipped, 1, metricUnit.Count);
      continue;
    }

    const { type } = data.sitemapWriterItem;

    // Create the type if we haven't already
    let messageType = messagesByType[type];
    if (messageType === undefined) {
      messageType = [];
      messagesByType[type] = messageType;
    }

    // Add the item to the end of the list
    messageType.push(data);
  }

  return messagesByType;
}

export type DecodedPlusPayload = {
  sitemapWriterItem: ISitemapWriterItem;
  payload: lambda.KinesisStreamRecordPayload;
};
type PreFetchedItems = {
  items?: { item: DecodedPlusPayload; itemState?: ItemRecord }[];
  error?: Error;
};

/**
 * Create the DynamoDB Item State Prefetcher.
 *
 * @param opts
 * @returns AsyncIterable of hydrated items
 */
export function createItemStatePreFetcher(opts: {
  items: DecodedPlusPayload[];
  type: string;
  flatMetricsTyped: FlatCountMetrics;
}): IterableMapper<ISitemapWriterItem, PreFetchedItems> {
  return new IterableMapper(
    batch(opts.items, 100),
    async (itemBatch): Promise<PreFetchedItems> => {
      try {
        const resultMap: {
          [customId: string]: {
            item: DecodedPlusPayload;
            itemState?: ItemRecord;
          };
        } = {};

        for (const item of itemBatch) {
          if (resultMap[item.sitemapWriterItem.customId] !== undefined) {
            opts.flatMetricsTyped.putMetric(
              SitemapWriterTypedMetrics.PreFetcherUnexpectedDuplicate,
              1,
              metricUnit.Count,
            );
            log.error(
              'createItemStatePreFetcher saw a duplicate customId when it should not have',
              {
                itemCustomId: item.sitemapWriterItem.customId,
                itemType: item.sitemapWriterItem.type,
                itemSitemapItem: item.sitemapWriterItem.sitemapItem,
                resultMapCustomId:
                  resultMap[item.sitemapWriterItem.customId].item.sitemapWriterItem.customId,
                resultMapSitemapItem:
                  resultMap[item.sitemapWriterItem.customId].item.sitemapWriterItem.sitemapItem,
                resultMapType:
                  resultMap[item.sitemapWriterItem.customId].item.sitemapWriterItem.type,
              },
            );
          } else {
            // Save the item
            resultMap[item.sitemapWriterItem.customId] = { item };
          }
        }

        if (config.storeItemStateInDynamoDB) {
          // DynamoDB will reject requests with duplicate IDs
          // But... we already de-duplicated IDs above for the entire payload
          const itemStates = await ItemRecord.loadMany(
            dbManager,
            itemBatch.map((value) => {
              return {
                ItemID: value.sitemapWriterItem.customId,
                Type: opts.type,
              };
            }),
          );

          for (const itemState of itemStates) {
            if (
              itemState === undefined ||
              itemState.ItemID === undefined ||
              itemState.ItemID === ''
            ) {
              opts.flatMetricsTyped.putMetric(
                SitemapWriterTypedMetrics.PreFetcherInvalidDBItem,
                1,
                metricUnit.Count,
              );
              log.error('createItemStatePreFetcher - item state from DB is invalid', {
                itemState,
              });
            } else {
              opts.flatMetricsTyped.putMetric(
                SitemapWriterTypedMetrics.PreFetcherHydratedItem,
                1,
                metricUnit.Count,
              );
              resultMap[itemState.ItemID].itemState = itemState;
            }
          }

          // Now we should have a map with the item and the optional
          // ItemState from DynamoDB for each input item.
        }

        const items: { item: DecodedPlusPayload; itemState?: ItemRecord }[] = [];
        for (const customId of Object.keys(resultMap)) {
          items.push(resultMap[customId]);
        }

        if (items.length !== itemBatch.length) {
          opts.flatMetricsTyped.putMetric(
            SitemapWriterTypedMetrics.PreFetcherLostItems,
            1,
            metricUnit.Count,
          );
          log.error('createItemStatePreFetcher - less output items than input items', {
            itemsLength: items.length,
            itemBatchLength: itemBatch.length,
            items,
            itemBatch,
          });
        }

        return { items };
      } catch (error) {
        const newErr = new VError(error as Error, `fetching item state for ids failed`);
        return { error: newErr };
      }
    },
    {
      concurrency: config.dynamoDBConcurrentReads,
      maxUnread: config.dynamoDBPrefetchMaxUnread,
      stopOnMapperError: false,
    },
  );
}
