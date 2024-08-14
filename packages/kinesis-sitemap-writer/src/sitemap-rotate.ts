import { KinesisClient, PutRecordsCommand } from '@aws-sdk/client-kinesis';
import { SitemapWriterTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import { IIndexWriterMessage, ISitemapWriterItem } from '@shutterstock/sitemaps-models-lib';
import { SitemapFileNamingSchemes } from './config/config';
import { SitemapFileWrapper, SitemapWriteWouldOverflow } from '@shutterstock/sitemaps-wrapper-lib';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { DBManager, FileRecord, ShardStateRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapFileAndStats } from './sitemap-file-stats';
import { IConfig } from './config/config';
import { log } from './utils/log';
import { KinesisRetrierStatic } from '@shutterstock/kinesis-helpers';
import { Unit as metricUnit } from 'aws-embedded-metrics';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
import { SitemapItemLoose } from 'sitemap';

export type s3BackgroundUploaderOptions = {
  dbManager: DBManager;
  kinesisClient: KinesisClient;
  sitemapAndStats: SitemapFileAndStats;
  infixDirs: string[];
  type: string;
  config: IConfig;
};

/**
 * Close and push a sitemap file to S3, deleting the local file when complete
 *
 * @param sitemapAndStats
 * @param s3Uploader
 * @param type
 * @param s3UploadErrors
 */
export async function backgroundUploadSitemapWorker(
  opts: s3BackgroundUploaderOptions,
): Promise<void> {
  const { sitemapAndStats, type, config, dbManager, kinesisClient, infixDirs } = opts;
  const { sitemap: currentSitemap } = sitemapAndStats;

  // Wait for items to finish writing to the file
  await currentSitemap.end();

  try {
    // Push the file to S3 in the background
    const { s3Path } = await currentSitemap.pushToS3({
      bucketName: config.s3SitemapsBucketName,
      s3Directory: path.posix.join(config.s3Directory, type),
    });

    // Create the infixDir copies of the sitemap
    for (const infixDir of infixDirs) {
      // Create a new sitemap file
      const infixSitemap = new SitemapFileWrapper({
        ...currentSitemap.options,
        // Make the filenames unique so a path upload mistake does not clobber the main sitemap
        ...(currentSitemap.options.filenameRoot
          ? { filenameRoot: `${infixDir}-${currentSitemap.options.filenameRoot}` }
          : {}),
        ...(currentSitemap.options.localDirectory
          ? { localDirectory: path.posix.join(currentSitemap.options.localDirectory, infixDir) }
          : {}),
      });

      for (const item of currentSitemap.items) {
        const urlPath = /^https?:/.test(item.url) ? new URL(item.url).pathname : item.url;
        const newItem: SitemapItemLoose = {
          ...{
            url: path.posix.join('', infixDir, urlPath),
            lastmod: item.lastmod,
            lastmodISO: item.lastmodISO,
          },
        };

        try {
          await infixSitemap.write({ item: newItem });
        } catch (error: any) {
          if (error instanceof SitemapWriteWouldOverflow) {
            // Not a problem... so this infix sitemap is missing a few items...
            continue;
          }

          // This is a real error, so throw it
          throw error;
        }
      }

      // Push the file to an infix subdir
      await infixSitemap.end();
      await infixSitemap.pushToS3({
        bucketName: config.s3SitemapsBucketName,
        s3Directory: path.posix.join(config.s3Directory, type, infixDir),
      });
      await infixSitemap.delete();
    }

    // Save updated data about this file in DynamoDB
    await sitemapAndStats.stats.save(dbManager);

    const indexWriterItem: IIndexWriterMessage = {
      indexItem: {
        url: new URL(
          path.posix.join(config.siteBaseSitemapPath, type, currentSitemap.filename),
          config.siteBaseURL,
        ).toString(),
        lastmod: new Date().toISOString(),
      },
      action: sitemapAndStats.existing ? 'update' : 'add',
      type,
    };

    await KinesisRetrierStatic.putRecords(
      kinesisClient,
      new PutRecordsCommand({
        StreamName: config.kinesisIndexWriterStreamName,
        Records: [
          {
            Data: Buffer.from(JSON.stringify(indexWriterItem), 'utf-8'),
            PartitionKey: type,
          },
        ],
      }),
    );

    log.info('pushed sitemap to s3', { s3Path });
  } catch (error) {
    log.error('error pushing sitemap to s3', { sitemapFilename: currentSitemap.filename });
    throw error;
  } finally {
    // Delete the local file
    await currentSitemap.delete();
  }
}

export type s3BackgroundUploader = IterableQueueMapperSimple<s3BackgroundUploaderOptions>;

/**
 * Create a new root filename (no .xml or .xml.gz extension) for a sitemap file,
 * based of the desired type (uuid) or state (index and date+index) and type.
 *
 * @param opts
 * @returns root filename for new sitemap
 */

export function createSitemapNameRoot(opts: {
  shardState: ShardStateRecord;
  sitemapFileNamingScheme: SitemapFileNamingSchemes;
}): string {
  const { shardState, sitemapFileNamingScheme } = opts;

  const paddedShardId = shardState.ShardId.toString().padStart(3, '0');

  // Handle stateless uuid naming
  if (sitemapFileNamingScheme === 'uuidv4') {
    return `${shardState.Type}-${paddedShardId}-${uuidv4()}`;
  }

  // Get the next index from the ShardState
  const nextIndex = shardState.FileCount + 1;
  const paddedNextIndex = nextIndex.toString().padStart(5, '0');

  if (sitemapFileNamingScheme === 'index') {
    return `${shardState.Type}-${paddedShardId}-${paddedNextIndex}`;
  } else if (sitemapFileNamingScheme === 'date+index') {
    const dateStr = new Date().toISOString().slice(0, 10);
    return `${shardState.Type}-${dateStr}-${paddedShardId}-${paddedNextIndex}`;
  } else {
    throw new Error(`unhandled sitemap file naming scheme: ${sitemapFileNamingScheme}`);
  }
}

/**
 * Create a new sitemap file
 *
 * @param opts
 * @returns New SitemapFileWrapper
 */

export async function createNewSitemap(opts: {
  sitemapFileNamingScheme: SitemapFileNamingSchemes;
  shardState: ShardStateRecord;
  config: IConfig;
  dbManager: DBManager;
}): Promise<SitemapFileAndStats> {
  const { sitemapFileNamingScheme, shardState, config, dbManager } = opts;

  const sitemap = new SitemapFileWrapper({
    compress: config.compressSitemapFiles,
    filenameRoot: createSitemapNameRoot({
      shardState,
      sitemapFileNamingScheme,
    }),
    siteBaseURL: config.siteBaseURL,
    localDirectory: config.localDirectory,
    limitCount: config.itemsPerSitemapLimit,
  });
  const stats = new FileRecord({
    Type: shardState.Type,
    FileName: sitemap.filename,
  });

  // Save the new file record in DynamoDB
  await stats.save(dbManager);

  // Record the new file and reset the file items count stat
  shardState.ChangeCurrentFile(sitemap.filename);
  await shardState.save(dbManager);

  return new SitemapFileAndStats({ sitemap, existing: false, stats });
}

/**
 * Initiate background upload of the curent sitemap file
 * Create and return a new sitemap file
 *
 * @param opts
 * @returns
 */
export async function rotateSitemapFile(opts: {
  sitemapAndStats: SitemapFileAndStats;
  s3Uploader: s3BackgroundUploader;
  shardState: ShardStateRecord;
  flatMetricsTyped: FlatCountMetrics;
  skipUpload?: boolean;
  config: IConfig;
  dbManager: DBManager;
  kinesisClient: KinesisClient;
}): Promise<SitemapFileAndStats> {
  const {
    sitemapAndStats,
    s3Uploader,
    shardState,
    flatMetricsTyped,
    skipUpload = false,
    config,
    dbManager,
    kinesisClient,
  } = opts;
  const { sitemap: currentSitemap } = sitemapAndStats;
  const { sizeUncompressed, count } = currentSitemap;

  if (!skipUpload) {
    // Close the current file
    await s3Uploader.enqueue({
      dbManager,
      kinesisClient,
      config,
      sitemapAndStats,
      type: shardState.Type,
      infixDirs: config.infixDirs,
    });
  }

  // Open a new sitemap file
  const newSitemap = await createNewSitemap({
    sitemapFileNamingScheme: config.sitemapFileNamingScheme,
    shardState,
    config,
    dbManager,
  });
  log.info('prior sitemap filled up - starting new sitemap file', {
    type: shardState.Type,
    shardId: shardState.ShardId,
    priorSitemapFilename: currentSitemap.filename,
    priorSitemapCount: count,
    priorSitemapSizeUncompressed: sizeUncompressed,
    usingSitemapFilename: newSitemap.sitemap.filename,
  });
  flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapFileCreated, 1, metricUnit.Count);
  return newSitemap;
}

/**
 * Attempt to write to the current sitemap file.
 * If the write throws an exception because the new item would exceed the allowed byte length,
 * then create a new file, push the old file into the upload queue, write the item
 * to the new file, and return a handle to the new file.
 *
 * @param opts
 * @returns
 */
export async function writeOrRotateAndWrite(opts: {
  currentSitemap: SitemapFileAndStats;
  item: ISitemapWriterItem;
  s3Uploader: s3BackgroundUploader;
  flatMetricsTyped: FlatCountMetrics;
  shardState: ShardStateRecord;
  config: IConfig;
  dbManager: DBManager;
  kinesisClient: KinesisClient;
}): Promise<SitemapFileAndStats> {
  const {
    currentSitemap,
    item,
    s3Uploader,
    flatMetricsTyped,
    shardState,
    dbManager,
    config,
    kinesisClient,
  } = opts;

  try {
    await currentSitemap.sitemap.write({ item: item.sitemapItem });
  } catch (error: any) {
    if (error instanceof SitemapWriteWouldOverflow) {
      // Close the old sitemap, open a new one
      const newSitemap = await rotateSitemapFile({
        sitemapAndStats: currentSitemap,
        s3Uploader,
        flatMetricsTyped,
        shardState,
        config,
        dbManager,
        kinesisClient,
      });

      // Write the item to the new sitemap
      await newSitemap.sitemap.write({ item: item.sitemapItem });

      return newSitemap;
    } else {
      throw error;
    }
  }
  return currentSitemap;
}
