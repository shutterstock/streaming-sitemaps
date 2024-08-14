import path from 'path';
import { promises as fs, pathExists, Stats } from 'fs-extra';
import * as s3 from '@aws-sdk/client-s3';
import { Unit as metricUnit } from 'aws-embedded-metrics';
import { Chunker } from '@shutterstock/chunker';
import { IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
import { DBManager, FileRecord, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapFreshenerTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import { ISitemapFreshenerFreshenFileMessage } from '@shutterstock/sitemaps-models-lib';
import { SitemapFileWrapper, SitemapWriteWouldOverflow } from '@shutterstock/sitemaps-wrapper-lib';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { IConfig } from '../../config/config';
import { log } from '../../utils/log';
import { RepairDBStats } from './repair-db-stats';
import { SitemapItemLoose } from 'sitemap';

/**
 * This function evaluates the sitemap and writes the results to the database and S3.
 * It checks the size and count of the sitemap, and if it's too big or too small, it writes it to a specific sub-folder.
 * It also checks if the sitemap exists locally and on S3, and handles the cases where it doesn't exist in one or both places.
 * If the sitemap is valid, it is written to S3 and the database.
 *
 * @param opts - An object containing various parameters needed for the function.
 * @param opts.config - The configuration object.
 * @param opts.dryRun - A boolean indicating whether this is a dry run.
 * @param opts.dryRunDB - A boolean indicating whether this is a dry run for the database.
 * @param opts.dbItemWriterBothKeysSaveMany - A database item writer.
 * @param opts.dbItemWriterByFileOnlySaveMany - A database item writer that only saves by file.
 * @param opts.dbManager - The database manager.
 * @param opts.itemRecordsToWriteToDB - An array of item records to write to the database.
 * @param opts.itemRecordsToWriteToDBByFileNameOnly - An array of item records to write to the database by file name only.
 * @param opts.filename - The name of the file.
 * @param opts.fileState - The state of the file.
 * @param opts.flatMetricsTyped - FlatCountMetrics for the typed metrics.
 * @param opts.message - The message for the sitemap freshener.
 * @param opts.repairStats - The repair database stats.
 * @param opts.s3Client - The S3 client.
 * @param opts.s3SitemapItemInDbCountSameFile - The count of S3 sitemap items in the database for the same file.
 * @param opts.s3SitemapItemInDbCountDiffFile - The count of S3 sitemap items in the database for different files.
 * @param opts.s3SitemapCountBefore - The count of S3 sitemaps before.
 * @param opts.sitemap - The sitemap file wrapper.
 * @param opts.type - The type of the sitemap.
 * @returns A promise that resolves when the operation is complete.
 * @throws Will throw an error if the sitemap HeadObjectCommand fails.
 */
export async function evaluateAndWriteResults(opts: {
  readonly config: IConfig;
  readonly dryRun: boolean;
  readonly dryRunDB: boolean;
  readonly dbItemWriterBothKeysSaveMany: IterableQueueMapperSimple<ItemRecord[]>;
  readonly dbItemWriterByFileOnlySaveMany: IterableQueueMapperSimple<ItemRecord[]>;
  readonly dbManager: DBManager;
  readonly itemRecordsToWriteToDB: ItemRecord[];
  readonly itemRecordsToWriteToDBByFileNameOnly: ItemRecord[];
  readonly filename: string;
  readonly fileState: FileRecord;
  readonly flatMetricsTyped: FlatCountMetrics;
  readonly message: ISitemapFreshenerFreshenFileMessage;
  readonly repairStats: RepairDBStats;
  readonly s3Client: s3.S3Client;
  readonly s3SitemapItemInDbCountSameFile: number;
  readonly s3SitemapItemInDbCountDiffFile: number;
  readonly s3SitemapCountBefore?: number;
  readonly sitemap: SitemapFileWrapper;
  readonly type: string;
}): Promise<void> {
  const {
    config,
    dbItemWriterBothKeysSaveMany,
    dbItemWriterByFileOnlySaveMany,
    dbManager,
    dryRun,
    dryRunDB,
    filename,
    fileState,
    flatMetricsTyped,
    itemRecordsToWriteToDB,
    itemRecordsToWriteToDBByFileNameOnly,
    message,
    repairStats,
    s3Client,
    s3SitemapItemInDbCountSameFile,
    s3SitemapItemInDbCountDiffFile,
    s3SitemapCountBefore,
    sitemap,
    type,
  } = opts;
  let localSitemapStats: Stats | undefined = undefined;
  if (await pathExists(sitemap.filenameAndPath)) {
    localSitemapStats = await fs.stat(sitemap.filenameAndPath);
  }

  let dryRunMsgPrefix = '';
  if (dryRun) {
    dryRunMsgPrefix = 'DRYRUN: ';
  } else if (dryRunDB) {
    dryRunMsgPrefix = 'DRYRUNDB: ';
  }

  const s3DestDirectory = path.posix.join(message.s3DirectoryOverride || config.s3Directory, type);
  const s3DestURL = `s3://${path.posix.join(
    config.s3SitemapsBucketName,
    s3DestDirectory,
    filename,
  )}`;

  const context: {
    localSitemapBytesSize: number;
    localSitemapDiskSize?: number;
    localCount: number;
    dbCount: number;
    repairStats: RepairDBStats;
    s3SitemapItemInDbCountSameFile?: number;
    s3SitemapItemInDbCountDiffFile?: number;
    s3SitemapCountBefore?: number;
    s3SitemapSizeBefore?: number;
    s3Directory: string;
    s3URL: string;
  } = {
    localSitemapBytesSize: sitemap.sizeUncompressedBytesEmitted,
    localSitemapDiskSize: localSitemapStats?.size,
    localCount: sitemap.count,
    dbCount: fileState.CountWritten,
    repairStats,
    s3SitemapItemInDbCountSameFile,
    s3SitemapItemInDbCountDiffFile,
    s3SitemapCountBefore,
    s3Directory: s3DestDirectory,
    s3URL: s3DestURL,
  };

  // Get the size of the sitemap on S3
  let existingSitemapInfo: s3.HeadObjectCommandOutput | undefined = undefined;
  try {
    existingSitemapInfo = await s3Client.send(
      new s3.HeadObjectCommand({
        Bucket: config.s3SitemapsBucketName,
        Key: path.posix.join(config.s3Directory, type, sitemap.filename),
      }),
    );
  } catch (err: any) {
    if (!(err instanceof s3.NotFound)) {
      log.error(`${dryRunMsgPrefix}sitemap HeadObjectCommand failed`, { ...context, err });
      throw err;
    }
    log.warn(`${dryRunMsgPrefix}sitemap does not exist on S3`, context);
  }

  context.s3SitemapSizeBefore = existingSitemapInfo?.ContentLength;

  // Bail if we have no local sitemap to write at all
  if (
    (localSitemapStats === undefined || localSitemapStats.size === 0) &&
    !(existingSitemapInfo?.ContentLength === undefined || existingSitemapInfo?.ContentLength === 0)
  ) {
    flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.FileFreshenFailed, 1, metricUnit.Count);
    log.error(`${dryRunMsgPrefix}local sitemap is empty, but S3 sitemap is not empty`, context);
    return;
  } else if (localSitemapStats?.size === undefined) {
    log.error(`${dryRunMsgPrefix}local sitemap does not exist, skipping upload to S3`, context);
    return;
  }

  // Use a sub-folder for malformed sitemaps wo we can examine them
  let s3DestDirectoryGoodOrBad = s3DestDirectory;

  // Check if the new sitemap got smaller by more than 50%
  if (
    existingSitemapInfo?.ContentLength !== undefined &&
    localSitemapStats?.size !== undefined &&
    localSitemapStats.size < existingSitemapInfo.ContentLength * 0.5
  ) {
    s3DestDirectoryGoodOrBad = path.posix.join(s3DestDirectory, 'freshen-too-small');
    flatMetricsTyped.putMetric(
      SitemapFreshenerTypedMetrics.FileFreshenTooSmall,
      1,
      metricUnit.Count,
    );
    const msg = `${dryRunMsgPrefix}local sitemap is too small compared to remote sitemap, writing to ${s3DestDirectoryGoodOrBad}`;
    if (dryRun) {
      log.warn(msg, context);
    } else {
      log.error(msg, context);
    }
  }

  // Check the byte size written through the sitemap stream
  // This is the `uncompressed` size even if the destination is gzip
  // This counts bytes not chars so \u00A0 is 2 bytes not 1 char
  // The limit on Bing/Google sitemap uncompressed sizes is 50 MB not 50 million chars
  if (sitemap.sizeUncompressedBytesEmitted > 50 * 1024 * 1024) {
    s3DestDirectoryGoodOrBad = path.posix.join(s3DestDirectory, 'freshen-too-big-bytes');
    flatMetricsTyped.putMetric(
      SitemapFreshenerTypedMetrics.FileFreshenTooBigBytes,
      1,
      metricUnit.Count,
    );
    const msg = `${dryRunMsgPrefix}local sitemap is too big by bytes, writing to ${s3DestDirectoryGoodOrBad}`;
    if (dryRun) {
      log.warn(msg, context);
    } else {
      log.error(msg, context);
    }
  }

  if (sitemap.count > 50000) {
    s3DestDirectoryGoodOrBad = path.posix.join(s3DestDirectory, 'freshen-too-big-count');
    flatMetricsTyped.putMetric(
      SitemapFreshenerTypedMetrics.FileFreshenTooBigCount,
      1,
      metricUnit.Count,
    );
    const msg = `${dryRunMsgPrefix}local sitemap is too big by count, writing to ${s3DestDirectoryGoodOrBad}`;
    if (dryRun) {
      log.warn(msg, context);
    } else {
      log.error(msg, context);
    }
  }

  if (sitemap.count === 0) {
    const msg = `${dryRunMsgPrefix}local sitemap has count of zero - skipping upload to s3`;
    if (dryRun) {
      log.warn(msg, context);
    } else {
      log.error(msg, context);
    }
    return;
  }

  // Write the sitemap to S3
  if (dryRun) {
    flatMetricsTyped.putMetric(
      SitemapFreshenerTypedMetrics.FileFreshenDryRunToS3,
      1,
      metricUnit.Count,
    );
    log.info(`${dryRunMsgPrefix}pushing updated sitemap to s3`, context);
  } else {
    log.info(`${dryRunMsgPrefix}pushing updated sitemap to s3`, context);
    await sitemap.pushToS3({
      bucketName: config.s3SitemapsBucketName,
      s3Directory: s3DestDirectoryGoodOrBad,
    });
    log.info(`${dryRunMsgPrefix}finished pushing updated sitemap to s3`, context);

    // Create the infixDir copies of the sitemap
    for (const infixDir of config.infixDirs) {
      // Create a new sitemap file
      const infixSitemap = new SitemapFileWrapper({
        ...sitemap.options,
        // Make the filenames unique so a path upload mistake does not clobber the main sitemap
        ...(sitemap.options.filenameRoot
          ? { filenameRoot: `${infixDir}-${sitemap.options.filenameRoot}` }
          : {}),
        ...(sitemap.options.localDirectory
          ? { localDirectory: path.posix.join(sitemap.options.localDirectory, infixDir) }
          : {}),
      });

      for (const item of sitemap.items) {
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
        s3Directory: path.posix.join(s3DestDirectory, infixDir),
      });
      await infixSitemap.delete();
    }

    flatMetricsTyped.putMetric(
      SitemapFreshenerTypedMetrics.FileFreshenWrittenToS3,
      1,
      metricUnit.Count,
    );

    if (!dryRunDB) {
      await flushToDB({
        dbItemWriterBothKeysSaveMany,
        dbItemWriterByFileOnlySaveMany,
        itemRecordsToWriteToDBByFileNameOnly,
        itemRecordsToWriteToDB,
        fileState,
        sitemap,
        dbManager,
      });
    } else {
      log.info(`${dryRunMsgPrefix}dry run, not writing to DB`, context);
    }
  }
}

/**
 * Flush the DB records
 *
 * Does NOT check the dryRunDB flag
 *
 * @param param0
 */
async function flushToDB({
  dbItemWriterBothKeysSaveMany,
  dbItemWriterByFileOnlySaveMany,
  itemRecordsToWriteToDBByFileNameOnly,
  itemRecordsToWriteToDB,
  fileState,
  sitemap,
  dbManager,
}: {
  dbItemWriterBothKeysSaveMany: IterableQueueMapperSimple<ItemRecord[]>;
  dbItemWriterByFileOnlySaveMany: IterableQueueMapperSimple<ItemRecord[]>;
  itemRecordsToWriteToDBByFileNameOnly: ItemRecord[];
  itemRecordsToWriteToDB: ItemRecord[];
  fileState: FileRecord;
  sitemap: SitemapFileWrapper;
  dbManager: DBManager;
}) {
  const itemChunkerBothKeys = new Chunker({
    countLimit: 25,
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
    sizeLimit: 16 * 1024 * 1024 * 0.8,
    sizer: (item: ItemRecord): number => {
      // This count is not perfect... it's a char count not a byte count
      // So we set sizeLimit to 80% of the max
      const itemJSON = JSON.stringify(item);
      return itemJSON.length;
    },
    writer: async (records: ItemRecord[]): Promise<void> => {
      // Return immediately if there is a slot, else wait for a slot to free up
      await dbItemWriterBothKeysSaveMany.enqueue(records);
    },
  });

  const itemChunkerByFileOnly = new Chunker({
    countLimit: 25,
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
    sizeLimit: 16 * 1024 * 1024 * 0.8,
    sizer: (item: ItemRecord): number => {
      // This count is not perfect... it's a char count not a byte count
      // So we set sizeLimit to 80% of the max
      const itemJSON = JSON.stringify(item);
      return itemJSON.length;
    },
    writer: async (records: ItemRecord[]): Promise<void> => {
      // Return immediately if there is a slot, else wait for a slot to free up
      await dbItemWriterByFileOnlySaveMany.enqueue(records);
    },
  });

  try {
    // Update DB to mark items owned by other files as removed
    if (itemRecordsToWriteToDBByFileNameOnly.length > 0) {
      log.info('pushing ItemRecords owned by other files to dynamodb', {
        count: itemRecordsToWriteToDBByFileNameOnly.length,
      });
      for (const record of itemRecordsToWriteToDBByFileNameOnly) {
        await itemChunkerByFileOnly.enqueue(record);

        if (dbItemWriterByFileOnlySaveMany.errors.length > 0) {
          log.error('error writing item to DB', {
            errors: dbItemWriterByFileOnlySaveMany.errors,
            itemID: record.ItemID,
          });
          throw new Error(`error writing item to DB: ${dbItemWriterByFileOnlySaveMany.errors[0]}`);
        }
      }
      log.info('finished pushing ItemRecords owned by other files to dynamodb', {
        count: itemRecordsToWriteToDBByFileNameOnly.length,
      });
    }

    // Write all the updated or added ItemRecords to the DB
    log.info('pushing updated ItemRecords to dynamodb', { count: itemRecordsToWriteToDB.length });
    for (const record of itemRecordsToWriteToDB) {
      await itemChunkerBothKeys.enqueue(record);

      if (dbItemWriterBothKeysSaveMany.errors.length > 0) {
        log.error('error writing item to DB', {
          errors: dbItemWriterBothKeysSaveMany.errors,
          itemID: record.ItemID,
        });
        throw new Error(`error writing item to DB: ${dbItemWriterBothKeysSaveMany.errors[0]}`);
      }
    }
    log.info('finished pushing ItemRecords records to dynamodb', {
      count: itemRecordsToWriteToDB.length,
    });
  } finally {
    // Flush the DB items before chunker goes out of scope
    await itemChunkerBothKeys.onIdle();
    await itemChunkerByFileOnly.onIdle();
  }

  // Write the updated fileState to the DB
  log.info('pushing updated FileRecord to dynamodb');
  // Use the count even if we didn't push the sitemap overtop of the S3 sitemap
  // This helps find sitemaps with invalid counts via the DB
  fileState.CountWritten = sitemap.count;
  fileState.ClearTimeDirtiedISO();
  await fileState.save(dbManager);
  log.info('finished pushing updated FileRecord to dynamodb');
}
