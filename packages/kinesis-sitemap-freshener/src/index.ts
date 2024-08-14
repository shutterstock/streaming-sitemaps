import 'reflect-metadata';
import 'source-map-support/register';
import { captureAWSv3Client, setContextMissingStrategy } from 'aws-xray-sdk-core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as kinesis from '@aws-sdk/client-kinesis';
import * as s3 from '@aws-sdk/client-s3';
import type * as lambda from 'aws-lambda';
import type {
  ISitemapFreshenerFreshenFileMessage,
  ISitemapFreshenerMessageBase,
  ISitemapFreshenerStartMessage,
  ISitemapFreshenerResultBase,
  ISitemapFreshenerStartResult,
  ISitemapFreshenerLambdaEvent,
} from '@shutterstock/sitemaps-models-lib';
import {
  metricScope,
  Unit as metricUnit,
  Configuration as metricConfiguration,
  MetricsLogger,
} from 'aws-embedded-metrics';
import { FlatCountMetrics, metricScopeDummy } from '@shutterstock/aws-embedded-metrics-flatten';
import { Chunker } from '@shutterstock/chunker';
import { IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
import { Config } from './config/config';
import { SitemapWrapperOverrideAWSClients } from '@shutterstock/sitemaps-wrapper-lib';
import { DBManager, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { log, localTesting } from './utils/log';
import { KinesisBackgroundWriter, KinesisRetrier } from '@shutterstock/kinesis-helpers';
import {
  SitemapFreshenerMetrics,
  SitemapFreshenerTypedMetrics,
} from '@shutterstock/sitemaps-metrics-lib';
import { memory } from '@shutterstock/sitemaps-utils-lib';
import { handleStartMessage } from './handlers/start';
import { handleFreshenFileMessage } from './handlers/freshen-file';

//#region Initialization
let capturedMemoryDumpAlready = false;
export const config = Config.instance;

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
  new s3.S3Client({
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

log.info('rendered config', { config });
log.info('config files found', { configFiles: Config.configFiles });

const enableMetricScope = config.emitMetrics && !localTesting ? metricScope : metricScopeDummy;
//#endregion

export const handler = enableMetricScope(
  (metrics) =>
    async (
      payload: lambda.KinesisStreamEvent | ISitemapFreshenerLambdaEvent,
      context?: lambda.Context,
    ): Promise<void | ISitemapFreshenerResultBase[]> => {
      //#region Initialization
      const startTime = Date.now();
      const flatMetricsTypedMap = new Map<string, FlatCountMetrics>();

      let heapdumper: memory.heapdumps3 | undefined;
      if (config.captureHeapDumps && !capturedMemoryDumpAlready) {
        heapdumper = new memory.heapdumps3({
          bucketName: config.s3SitemapsBucketName,
          bucketPrefix: 'heapdumps/',
          logger: log,
        });
      }

      const {
        chunkerStream,
        dbItemWriterBothKeysSaveMany,
        dbItemWriterByFileOnlySaveMany,
        kinesisBackgroundWriter,
      } = setupWriters();
      //#endregion

      try {
        metrics.setProperty('RequestId', context?.awsRequestId);
        metrics.setProperty('Env', Config.envLevel);

        metrics.putMetric(SitemapFreshenerMetrics.EventReceived, 1, metricUnit.Count);
        metrics.putMetric(
          SitemapFreshenerMetrics.MsgReceived,
          payload.Records.length,
          metricUnit.Count,
        );
        await metrics.flush();

        // #region Payload Conversion
        // Decode the incoming payload into messages
        let payloadIsMessages = false;
        const results: ISitemapFreshenerResultBase[] = [];
        const messages = payload.Records.map((record) => {
          // Reset logger request-specific context
          log.options.meta = {
            env: Config.envLevel,
          };

          const recordAsKinesis = record as lambda.KinesisStreamRecord;
          const recordAsMessage = record as ISitemapFreshenerMessageBase;

          if (recordAsKinesis.kinesis && recordAsKinesis.kinesis.data) {
            if (payloadIsMessages) {
              throw new Error('mixed payload of Kinesis / direct messages not allowed');
            }
            const dataBuff = Buffer.from(recordAsKinesis.kinesis.data, 'base64');
            const dataStr = dataBuff.toString('utf-8');
            const message = JSON.parse(dataStr) as ISitemapFreshenerMessageBase;

            return message;
          } else if (recordAsMessage.type) {
            payloadIsMessages = true;
            return recordAsMessage;
          }
        });
        // Do not touch the incoming records anymore
        // @ts-expect-error yes we really want to delete this
        delete payload.Records;
        // #endregion

        // Loop through the normalized messages
        // #region Decoded Record Loop
        for (const message of messages) {
          // #region Top of Loop Setup
          log.info('top of record loop');

          if (message === undefined) {
            throw new Error('message is undefined');
          }

          const { type = '', operation } = message;
          const flatMetricsTyped = getFlatCountMetricsForType(type, flatMetricsTypedMap);

          // Dry-run === "safe" as we do not write to DB or S3
          // Config sets whether to allow message to select non-dry-run mode
          const dryRun = (config.nonDryRunAllowed ? message.dryRun : true) ?? true;
          const dryRunDB = dryRun || (message.dryRunDB ?? true);

          // Bail out if dryRun is `false` but non-dryRuns are not allowed
          if (dryRun !== (message.dryRun ?? true)) {
            log.error('dryRun mismatch - skipping this message', {
              computedDryRun: dryRun,
              computedDryRunDB: dryRunDB,
              incomingDryRun: message.dryRun,
              message,
            });
            results.push({
              message,
              computedDryRun: dryRun,
              computedDryRunDB: dryRunDB,
              incomingDryRun: message.dryRun,
              error: 'dryRun mismatch - skipping this message',
            } as ISitemapFreshenerStartResult);

            continue;
          }

          log.options.meta.operation = operation;
          log.options.meta.dryRun = dryRun;
          log.options.meta.dryRunDB = dryRunDB;
          log.options.meta.type = type;

          flatMetricsTyped.putMetric(
            SitemapFreshenerTypedMetrics.EventsReceived,
            1,
            metricUnit.Count,
          );
          // #endregion Top of Loop Setup

          if (operation === 'start') {
            results.push(
              await handleStartMessage({
                config,
                chunkerStream,
                dbManager,
                dryRun,
                dryRunDB,
                flatMetricsTyped,
                message: message as ISitemapFreshenerStartMessage,
                type,
              }),
            );
          } else if (operation === 'freshenFile') {
            results.push(
              await handleFreshenFileMessage({
                config,
                dbItemWriterBothKeysSaveMany,
                dbItemWriterByFileOnlySaveMany,
                dbManager,
                dryRun,
                dryRunDB,
                flatMetricsTyped,
                message: message as ISitemapFreshenerFreshenFileMessage,
                s3Client,
                type,
              }),
            );
          } else {
            throw new Error(`Unknown operation: ${operation}`);
          }
        }
        // #endregion Decoded Record Loop

        // Reset the logger request-specific context
        log.options.meta = { env: log.options.meta.env };
        log.info('finished payload');
        metrics.putMetric(SitemapFreshenerMetrics.EventDone, 1, metricUnit.Count);

        if (payloadIsMessages) {
          return results;
        }
      } catch (error) {
        metrics.putMetric(SitemapFreshenerMetrics.EventFailed, 1, metricUnit.Count);
        log.error(error as Error, {
          caughtException: true,
          extraMsg: 'Caught exception at top level',
        });

        // Re-throw so the batch will stall or be retried and succeed
        throw error;
      } finally {
        log.info('finished payload - starting finally');

        try {
          await chunkerStream.onIdle();
          await kinesisBackgroundWriter.onIdle();
        } catch (error) {
          log.error(error as Error, {
            caughtException: true,
            extraMsg: 'Caught exception flushing kinesis chunker',
          });
        }

        // Flush the chunker to the DB Writer, then wait for the DB Writer to finish
        try {
          await dbItemWriterBothKeysSaveMany.onIdle();
          await dbItemWriterByFileOnlySaveMany.onIdle();
        } catch (error) {
          log.error(error as Error, {
            caughtException: true,
            extraMsg: 'Caught exception flushing db writer',
          });
        }

        // Push any memory dump to s3 if we created one
        if (heapdumper !== undefined) {
          capturedMemoryDumpAlready = await heapdumper.shutdownAndFlush();
        }

        metrics.putMetric(
          SitemapFreshenerMetrics.DurationMS,
          Date.now() - startTime,
          metricUnit.Milliseconds,
        );
        // Output the typed metrics
        await flushTypedMetrics(flatMetricsTypedMap, metrics);
        log.info('finished payload - ending finally');
      }
    },
);

/**
 * Setup the background writers that we use to write to the DB and S3
 * @returns
 */
function setupWriters() {
  // Pipeline:
  // Chunker -> KinesisBackgroundWriter -> KinesisRetrier -> KinesisClient
  const kinesisRetrier = new KinesisRetrier({
    kinesisClient,
  });
  const kinesisBackgroundWriter = new KinesisBackgroundWriter({
    concurrency: 1,
    kinesisClient: kinesisRetrier,
  });
  const chunkerStream = new Chunker({
    countLimit: 500,
    sizeLimit: 5 * 1024 * 1024 * 0.95,
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

  //
  // Create background dynamodb writers
  //
  const dbItemWriterBothKeysSaveMany = new IterableQueueMapperSimple(
    async (records: ItemRecord[]): Promise<void> => {
      await ItemRecord.saveMany(dbManager, records);
    },
    { concurrency: config.dynamoDBConcurrentWrites },
  );
  const dbItemWriterByFileOnlySaveMany = new IterableQueueMapperSimple(
    async (records: ItemRecord[]): Promise<void> => {
      await ItemRecord.saveMany(dbManager, records, true);
    },
    { concurrency: config.dynamoDBConcurrentWrites },
  );
  return {
    chunkerStream,
    dbItemWriterBothKeysSaveMany,
    dbItemWriterByFileOnlySaveMany,
    kinesisBackgroundWriter,
  };
}

export function getFlatCountMetricsForType(
  type: string,
  flatMetricsTypedMap: Map<string, FlatCountMetrics>,
): FlatCountMetrics {
  if (flatMetricsTypedMap.has(type)) {
    return flatMetricsTypedMap.get(type)!;
  } else {
    const newFlatMetrics = new FlatCountMetrics();
    flatMetricsTypedMap.set(type, newFlatMetrics);
    return newFlatMetrics;
  }
}

export async function flushTypedMetrics(
  flatMetricsTypedMap: Map<string, FlatCountMetrics>,
  metrics: MetricsLogger,
) {
  for (const [type, flatMetricsTyped] of flatMetricsTypedMap) {
    const metricsTyped = metrics.new();
    metricsTyped.putDimensions({
      SitemapType: type,
    });
    flatMetricsTyped.flush(metricsTyped);
    await metricsTyped.flush();
  }
}

if (localTesting) {
  const message: ISitemapFreshenerFreshenFileMessage = {
    operation: 'freshenFile',
    repairDB: true,
    type: 'widget',
    s3DirectoryOverride: 'dry-run-db-sitemaps/',
    itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/widgets\\/widget-(?<ItemID>[0-9]+)',
    dryRun: false,
    dryRunDB: true,
    filename: 'widget-2021-11-16-000-00001.xml',
  };

  setContextMissingStrategy('LOG_ERROR');

  void handler({ Records: [message] }, {
    awsRequestId: 'local',
    functionName: 'local',
  } as lambda.Context);
}
