import * as s3 from '@aws-sdk/client-s3';
import keyBy from 'lodash/keyBy';
import { Unit as metricUnit } from 'aws-embedded-metrics';
import { IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
import { DBManager, FileRecord, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapFreshenerTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import {
  ISitemapFreshenerFreshenFileMessage,
  ISitemapFreshenerFreshenFileResult,
} from '@shutterstock/sitemaps-models-lib';
import { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { IConfig } from '../config/config';
import { cleanupSitemapItem } from './helpers/cleanup-sitemap-item';
import { log } from '../utils/log';
import { evaluateAndWriteResults } from './helpers/evaluate-results';
import { prepareRepairDB } from './helpers/repair-db';
import { RepairDBStats } from './helpers/repair-db-stats';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * Handles the freshening of a file message. This function is responsible for loading the file state,
 * getting the sitemap items from the DB, cross-checking S3 items against DB items, evaluating item statuses,
 * creating a new sitemap, writing items to the sitemap, writing the sitemap file to disk, and evaluating and writing results.
 *
 * @param {Object} opts - The options for the function.
 * @param {IConfig} opts.config - The configuration object.
 * @param {boolean} opts.dryRun - A flag indicating whether this is a dry run.
 * @param {boolean} opts.dryRunDB - A flag indicating whether this is a dry run for the DB.
 * @param {IterableQueueMapperSimple<ItemRecord[]>} opts.dbItemWriterBothKeysSaveMany - The DB item writer for both keys.
 * @param {IterableQueueMapperSimple<ItemRecord[]>} opts.dbItemWriterByFileOnlySaveMany - The DB item writer for file only.
 * @param {DBManager} opts.dbManager - The DB manager.
 * @param {FlatCountMetrics} opts.flatMetricsTyped - FlatMetricsCount for the typed metrics.
 * @param {ISitemapFreshenerFreshenFileMessage} opts.message - The message to freshen.
 * @param {s3.S3Client} opts.s3Client - The S3 client.
 * @param {string} opts.type - The type of the operation.
 *
 * @returns {Promise<ISitemapFreshenerFreshenFileResult>} - A promise that resolves to the result of the freshening operation.
 *
 * @throws {Error} - Throws an error if the filename is not provided or if the file state could not be loaded.
 */
export async function handleFreshenFileMessage(opts: {
  readonly config: IConfig;
  readonly dryRun: boolean;
  readonly dryRunDB: boolean;
  readonly dbItemWriterBothKeysSaveMany: IterableQueueMapperSimple<ItemRecord[]>;
  readonly dbItemWriterByFileOnlySaveMany: IterableQueueMapperSimple<ItemRecord[]>;
  readonly dbManager: DBManager;
  readonly flatMetricsTyped: FlatCountMetrics;
  readonly message: ISitemapFreshenerFreshenFileMessage;
  readonly s3Client: s3.S3Client;
  readonly type: string;
}): Promise<ISitemapFreshenerFreshenFileResult> {
  const {
    config,
    dbItemWriterBothKeysSaveMany,
    dbItemWriterByFileOnlySaveMany,
    dbManager,
    dryRun,
    dryRunDB,
    flatMetricsTyped,
    message,
    s3Client,
    type,
  } = opts;
  const result: Writeable<ISitemapFreshenerFreshenFileResult> = { message };
  const { filename } = message;
  let sitemap: SitemapFileWrapper | undefined = undefined;

  log.options.meta.filename = filename;

  if (filename === undefined || filename === '') {
    throw new Error('filename is required for `freshenFile` operation');
  }

  log.info('starting file freshen operation');

  const fileState = await FileRecord.loadOne(dbManager, {
    Type: type,
    FileName: filename,
  });
  if (fileState === undefined) {
    throw new Error(
      `could not load file state for \`freshenFile\` operation: ${type}, ${filename}`,
    );
  }
  log.info('loaded file state', {
    fileState: fileState.dbStruct,
  });

  // Get the sitemap items from the DB
  let itemRecordsByFile: ItemRecord[] | undefined = await ItemRecord.loadFile(
    dbManager,
    {
      Type: type,
      FileName: filename,
    },
    true,
  );

  flatMetricsTyped.putMetric(
    SitemapFreshenerTypedMetrics.ItemReceivedFromDB,
    itemRecordsByFile.length,
    metricUnit.Count,
  );

  const dbItemRecordsByFileMap = keyBy(itemRecordsByFile, (item) => item.ItemID);
  // Make sure we only use the map
  itemRecordsByFile = undefined;

  try {
    const itemRecordsToWriteToDB: ItemRecord[] = [];
    const itemRecordsToWriteToSitemap: ItemRecord[] = [];
    const itemRecordsToWriteToDBByFileNameOnly: ItemRecord[] = [];

    //
    // Loop through S3 Items, cross-checking against DB Items
    //
    const stats: RepairDBStats = {
      s3SitemapItemInDbCountSameFile: 0,
      s3SitemapItemInDbCountDiffFile: 0,
      s3SitemapItemNotInDbCount: 0,
      dbSitemapItemInDbCountSameFile: 0,
      dbSitemapItemInDbCountDiffFile: 0,
    };

    if (message.repairDB) {
      await prepareRepairDB({
        config,
        dbManager,
        dbItemRecordsByFileMap,
        itemRecordsToWriteToDB,
        itemRecordsToWriteToDBByFileNameOnly,
        itemRecordsToWriteToSitemap,
        filename,
        flatMetricsTyped,
        message,
        stats,
        type,
      });
    }

    //
    // Loop through DB Records
    //
    const dbItemRecordsByFileMapKeys = Object.keys(dbItemRecordsByFileMap);
    log.info('evaluating item statuses', {
      dbItemRecordsByFileMapKeys: dbItemRecordsByFileMapKeys.length,
    });
    for (const recordKey of dbItemRecordsByFileMapKeys) {
      const record = dbItemRecordsByFileMap[recordKey];

      log.options.meta.itemID = record.ItemID;

      if (record.ItemStatus === 'removed') {
        flatMetricsTyped.putMetric(
          SitemapFreshenerTypedMetrics.ItemAlreadyRemoved,
          1,
          metricUnit.Count,
        );

        log.info('skipping item because it is already removed');

        // Do not add this item to the new sitemap object
        continue;
      }

      if (record.ItemStatus === 'toremove') {
        flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.ItemRemoved, 1, metricUnit.Count);

        // Change status from `toremove` to `removed`
        record.ClearTimeDirtiedISO();
        itemRecordsToWriteToDB.push(record);

        // Decrement count of items written to the sitemap XML
        fileState.RemoveFileItem();

        // Do not add this item to the new sitemap object
        continue;
      }

      if (record.ItemStatus === 'towrite') {
        flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.ItemFreshened, 1, metricUnit.Count);

        // Change status from `toremove` to `removed`
        record.ClearTimeDirtiedISO();

        // Record that we want to write this item to the DB
        itemRecordsToWriteToDB.push(record);
      } else if (record.ItemStatus === 'written') {
        flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.ItemPreserved, 1, metricUnit.Count);
      } else {
        throw new Error('Unknown ItemStatus: ' + record.ItemStatus);
      }

      // Record that we want to write this item to the sitemap
      itemRecordsToWriteToSitemap.push(record);
    }
    delete log.options.meta.itemID;
    log.info('finished evaluating item statuses', {
      itemRecordsToWriteToSitemap: itemRecordsToWriteToSitemap.length,
      itemRecordsToWriteToDB: itemRecordsToWriteToDB.length,
      dbItemRecordsByFileMapKeys: dbItemRecordsByFileMapKeys.length,
    });

    // Create the new sitemap
    sitemap = new SitemapFileWrapper({
      siteBaseURL: config.siteBaseURL,
      // Have to preserve the compression setting
      // Changing the setting would break the index and duplicate the FileRecord
      compress: filename.endsWith('.gz'),
      filenameRoot: filename.replace('.xml', '').replace('.gz', ''),
      localDirectory: config.localDirectory,
      // Gotta fit whatever is in the DB
      limitCount: 50000,
      // Gotta fit whatever is in the DB
      limitBytes: 50 * 1024 * 1024,
    });

    // Cleanup and write to Sitemap
    log.info('writing items to the sitemap', {
      itemRecordsToWriteToSitemap: itemRecordsToWriteToSitemap.length,
      itemRecordsToWriteToDB: itemRecordsToWriteToDB.length,
      dbItemRecordsByFileMapKeys: dbItemRecordsByFileMapKeys.length,
    });
    let itemIndex = 0;
    for (const itemRecord of itemRecordsToWriteToSitemap) {
      const { SitemapItem: item } = itemRecord;

      log.options.meta.itemID = itemRecord.ItemID;

      if (
        config.debugItemWrites &&
        (itemIndex < 2 || itemIndex === itemRecordsToWriteToSitemap.length - 1)
      ) {
        log.info('cleaning up item', { itemIndex, item });
      }
      // Remove invisible and fix path chars
      cleanupSitemapItem({ item, flatMetricsTyped });
      if (
        config.debugItemWrites &&
        (itemIndex < 2 || itemIndex === itemRecordsToWriteToSitemap.length - 1)
      ) {
        log.info('finished cleaning up item', { itemIndex, item });
      }

      // Write the item to the sitemap
      // We disregard limits while writing and re-evaluate the file before writing to S3
      if (
        config.debugItemWrites &&
        (itemIndex < 2 || itemIndex === itemRecordsToWriteToSitemap.length - 1)
      ) {
        log.info('writing item', { itemIndex, item });
      }
      await sitemap.write({ item, disregardByteLimit: true, disregardCountLimit: true });
      if (
        config.debugItemWrites &&
        (itemIndex < 2 || itemIndex === itemRecordsToWriteToSitemap.length - 1)
      ) {
        log.info('finished writing item', { itemIndex, item });
      }

      flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.ItemWritten, 1, metricUnit.Count);

      itemIndex++;
    }
    delete log.options.meta.itemID;
    log.info('finished writing items to the sitemap', {
      itemRecordsToWriteToSitemap: itemRecordsToWriteToSitemap.length,
      itemRecordsToWriteToDB: itemRecordsToWriteToDB.length,
      dbItemRecordsByFileMapKeys: dbItemRecordsByFileMapKeys.length,
    });

    // Wait for the sitemap to finish writing
    log.info('writing sitemap file to disk', {
      sitemapCount: sitemap.count,
    });
    await sitemap.end();
    log.info('finished writing sitemap file to disk', {
      sitemapCount: sitemap.count,
      sizeUncompressedBytesEmitted: sitemap.sizeUncompressedBytesEmitted,
    });

    await evaluateAndWriteResults({
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
      repairStats: stats,
      s3Client,
      s3SitemapItemInDbCountSameFile: stats.s3SitemapItemInDbCountSameFile,
      s3SitemapItemInDbCountDiffFile: stats.s3SitemapItemInDbCountDiffFile,
      s3SitemapCountBefore: stats.s3SitemapCountBefore,
      sitemap,
      type,
    });

    return result;
  } finally {
    // Delete the sitemap
    if (sitemap !== undefined) {
      try {
        if (!sitemap.ended) {
          await sitemap.end();
        }
      } catch (err: any) {
        log.error(`failed to close sitemap file during cleanup ${sitemap.filenameAndPath}`, err);
      }
      try {
        await sitemap.delete();
      } catch (err: any) {
        log.error(`failed to delete sitemap file during cleanup ${sitemap.filenameAndPath}`, err);
      }
    }
  }
}
