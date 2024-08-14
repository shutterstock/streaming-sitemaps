import 'reflect-metadata';
import 'source-map-support/register';
import path from 'path';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import { S3Client } from '@aws-sdk/client-s3';
import https from 'https';
import type * as lambda from 'aws-lambda';
import type { IIndexWriterMessage } from '@shutterstock/sitemaps-models-lib';
import { IndexWriterMetrics, IndexWriterTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import { LambdaLog, LogMessage } from 'lambda-log';
import {
  metricScope,
  Unit as metricUnit,
  Configuration as metricConfiguration,
} from 'aws-embedded-metrics';
import { Config } from './config/config';
import { FlatCountMetrics, metricScopeDummy } from '@shutterstock/aws-embedded-metrics-flatten';
import {
  SitemapWrapperOverrideAWSClients,
  SitemapIndexWrapper,
} from '@shutterstock/sitemaps-wrapper-lib';
import { IndexItem } from 'sitemap';

// Initially setup the s3client
const s3Client = captureAWSv3Client(new S3Client({}));
SitemapWrapperOverrideAWSClients({ s3Client });

const localTesting = process.env.DEBUG ? true : false;
const config = Config.instance;

const log = new LambdaLog({
  dev: localTesting,
  //debug: localTesting,
  silent: config.logSilent,
});
if (localTesting) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log.options.dynamicMeta = (_message: LogMessage) => {
    return {
      timestamp: new Date().toISOString(),
    };
  };
}

metricConfiguration.namespace = config.metricsNamespace;

log.info('rendered config', { config, maxSockets: https.globalAgent.maxSockets });
log.info('config files found', { configFiles: Config.configFiles });

const enableMetricScope = config.emitMetrics ? metricScope : metricScopeDummy;

export const handler = enableMetricScope(
  (metrics) =>
    async (payload: lambda.KinesisStreamEvent, context?: lambda.Context): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const startTime = Date.now();

      // Set logger request-specific context
      log.options.meta = {
        env: Config.envLevel,
      };

      try {
        metrics.setProperty('RequestId', context?.awsRequestId);
        metrics.setProperty('Env', Config.envLevel);

        metrics.putMetric(IndexWriterMetrics.EventReceived, 1, metricUnit.Count);
        metrics.putMetric(IndexWriterMetrics.MsgReceived, payload.Records.length, metricUnit.Count);
        await metrics.flush();

        // We will have multiple records, which will generally be from multiple
        // shards in the sitemap-writer.  We want to group items across all records
        // that are of the same type (e.g. type 1, type 2) in order to pack the sitemap
        // files as close to 50k items as possible.
        //
        // For the nominal case of processing new records, each of the records
        // of a particular type might have only 10 to 1,000 items and there may
        // be up to # of shards (e.g. 8) of these.  We want to end up with 1 sitemap
        // xml file that has 80 to 8,000 items in it, not 8 files with 10 to 1,000 items
        // in them.
        const messagesByType: { [type: string]: IIndexWriterMessage[] } = {};
        for (const record of payload.Records) {
          const msg: IIndexWriterMessage = JSON.parse(
            Buffer.from(record.kinesis.data, 'base64').toString('utf-8'),
          ) as IIndexWriterMessage;

          const { type } = msg;

          // Create the type if we haven't already
          let messageType = messagesByType[type];
          if (messageType === undefined) {
            messageType = [];
            messagesByType[type] = messageType;
          }

          // Add the item to the end of the list
          messageType.push(msg);
        }
        // ^^^ END of Files of Type Consolidation Loop

        //
        // Loop through the consolidated list of files by type
        //
        for (const type of Object.keys(messagesByType)) {
          const flatMetricsTyped = new FlatCountMetrics();
          flatMetricsTyped.putMetric(IndexWriterTypedMetrics.TypeStarted, 1, metricUnit.Count);

          // If one type fails, process the others
          try {
            const msgs = messagesByType[type];

            log.info('starting processing of message type', { type });

            // Load the existing sitemap index off of S3
            // OR... create new one
            const {
              index: existingIndex,
              existing: indexWasExisting,
              items: existingItems,
            } = await SitemapIndexWrapper.fromS3({
              bucketName: config.s3SitemapsBucketName,
              compress: config.compressSitemapFiles,
              s3Directory: config.s3Directory,
              filenameRoot: `${type}-index`,
            });
            await existingIndex.end();
            await existingIndex.delete();

            // Create a new index since we're going to write back all items
            const newIndex = new SitemapIndexWrapper({
              compress: config.compressSitemapFiles,
              filenameRoot: `${type}-index`,
            });
            log.info('opened sitemap index for type', {
              type,
              indexWasExisting,
              lastSitemapFilename: existingIndex.lastFilename,
            });

            // Store the existing items in a map
            const existingItemsMapByUrl: { [url: string]: IndexItem } = {};
            for (const item of existingItems) {
              existingItemsMapByUrl[item.url] = item;
            }

            // Add items to the index array
            for (const msg of msgs) {
              if (msg.action === 'update') {
                flatMetricsTyped.putMetric(
                  IndexWriterTypedMetrics.ActionUpdate,
                  1,
                  metricUnit.Count,
                );
              } else if (msg.action === 'add') {
                flatMetricsTyped.putMetric(IndexWriterTypedMetrics.ActionAdd, 1, metricUnit.Count);
              } else {
                log.warn('unknown action type - skipping', {
                  type,
                  indexItem: msg.indexItem,
                });
                flatMetricsTyped.putMetric(
                  IndexWriterTypedMetrics.ActionUnknown,
                  1,
                  metricUnit.Count,
                );
                continue;
              }

              // Add to or overwrite item in the existing items map
              existingItemsMapByUrl[msg.indexItem.url] = msg.indexItem;
            }

            // Flatten the map back into an array
            const newIndexItems: IndexItem[] = [];
            for (const key of Object.keys(existingItemsMapByUrl)) {
              newIndexItems.push(existingItemsMapByUrl[key]);
            }
            // Sort by url (which should lexicographically sort by order the files were added)
            newIndexItems.sort((a, b) => {
              if (a.url < b.url) {
                return -1;
              }
              if (a.url > b.url) {
                return 1;
              }
              return 0;
            });

            log.info('uploading sitemap index - starting', {
              type,
            });
            await newIndex.writeArray({ items: newIndexItems });
            await newIndex.end();
            await newIndex.pushToS3({
              bucketName: config.s3SitemapsBucketName,
              s3Directory: config.s3Directory,
            });
            await newIndex.delete();
            log.info('uploading sitemap index - finished', {
              type,
            });

            // Create the infixDir copies of the index
            for (const infixDir of config.infixDirs) {
              // Create a new index file
              const infixSitemap = new SitemapIndexWrapper({
                ...newIndex.options,
                // Make the filenames unique so a path upload mistake does not clobber the main sitemap
                ...(newIndex.options.filenameRoot
                  ? { filenameRoot: `${newIndex.options.filenameRoot}-${infixDir}` }
                  : {}),
              });

              for (const item of newIndex.items) {
                const url = new URL(item.url);
                const urlParts = url.pathname.split('/');
                const fileName = urlParts.pop();
                url.pathname = path.posix.join(...urlParts, infixDir, `${infixDir}-${fileName}`);
                const newItem: IndexItem = {
                  ...{
                    url: url.toString(),
                    lastmod: item.lastmod,
                  },
                };

                await infixSitemap.write({ item: newItem });
              }

              // Push the file
              await infixSitemap.end();
              await infixSitemap.pushToS3({
                bucketName: config.s3SitemapsBucketName,
                s3Directory: config.s3Directory,
              });
              await infixSitemap.delete();
            }

            log.info('finished type', { type });
            flatMetricsTyped.putMetric(IndexWriterTypedMetrics.TypeDone, 1, metricUnit.Count);
          } catch (error) {
            flatMetricsTyped.putMetric(IndexWriterTypedMetrics.TypeFailed, 1, metricUnit.Count);
            log.error(error as Error, {
              caughtException: true,
              type,
              extraMsg: 'Caught exception at top of type loop',
            });
          } finally {
            // Flush the metrics collected by the type handler
            const metricsTyped = metrics.new();
            metricsTyped.putDimensions({ SitemapType: type });
            flatMetricsTyped.flush(metricsTyped);
            await metricsTyped.flush();
          }
        }
        // ^^^ END of Type Loop

        log.info('finished payload');
        metrics.putMetric(IndexWriterMetrics.EventComplete, 1, metricUnit.Count);
      } catch (error) {
        metrics.putMetric(IndexWriterMetrics.EventFailed, 1, metricUnit.Count);
        log.error(error as Error, {
          caughtException: true,
          extraMsg: 'Caught exception at top level',
        });
      } finally {
        metrics.putMetric(
          IndexWriterMetrics.DurationMS,
          Date.now() - startTime,
          metricUnit.Milliseconds,
        );
      }
    },
);
