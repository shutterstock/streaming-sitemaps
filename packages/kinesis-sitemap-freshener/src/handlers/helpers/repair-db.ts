import batch from 'it-batch';
import { Unit as metricUnit } from 'aws-embedded-metrics';
import keyBy from 'lodash/keyBy';
import uniq from 'lodash/uniq';
import * as s3 from '@aws-sdk/client-s3';
import { IterableMapper } from '@shutterstock/p-map-iterable';
import { DBManager, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapFreshenerTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import { ISitemapFreshenerFreshenFileMessage } from '@shutterstock/sitemaps-models-lib';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { IConfig } from '../../config/config';
import { log } from '../../utils/log';
import { SitemapItemAndItemID } from './extract-itemids';
import { ValidateItemIDRegex } from './validate-itemid-regex';
import { RepairDBStats } from './repair-db-stats';

/**
 * Only called when `repairDB` is true in the incoming message
 *
 * NOTE: Does not write to the DB or S3
 *
 * Retrieves the existing sitemap from S3
 * Checks for records in the sitemap that are not in the DB at all
 *
 * Prepare the list of records to add to the DB
 * Prepare the list of records to set to `removed` to the DB
 *   if owned by another file
 * Prepare the list of additional records to write to the new sitemap
 *
 * @param opts
 */
export async function prepareRepairDB(opts: {
  readonly config: IConfig;
  readonly dbItemRecordsByFileMap: Record<string, ItemRecord>;
  readonly itemRecordsToWriteToDB: ItemRecord[];
  readonly itemRecordsToWriteToDBByFileNameOnly: ItemRecord[];
  readonly itemRecordsToWriteToSitemap: ItemRecord[];
  readonly dbManager: DBManager;
  readonly filename: string;
  readonly flatMetricsTyped: FlatCountMetrics;
  readonly message: ISitemapFreshenerFreshenFileMessage;
  readonly type: string;
  readonly stats: RepairDBStats;
}) {
  const {
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
  } = opts;

  if (!message.repairDB) {
    throw new Error('prepareRepairDB called when repairDB is false');
  }

  log.info('starting repairDB step');

  log.info('loading existing sitemap from S3');
  let s3ItemsWithIDs: SitemapItemAndItemID[] | undefined = [];
  try {
    const ugh = await ValidateItemIDRegex({
      config,
      itemIDRegexStr: message.itemIDRegex,
      filename,
      type,
      quiet: true,
    });
    s3ItemsWithIDs = ugh.itemsWithIDs;
  } catch (err: any) {
    if (err instanceof s3.NoSuchKey) {
      s3ItemsWithIDs = [];
      log.error('repairDB got `NoSuchKey` from S3', {
        type,
        filename,
        s3BucketName: config.s3SitemapsBucketName,
      });
    } else {
      throw err;
    }
  }
  stats.s3SitemapCountBefore = s3ItemsWithIDs.length;
  const s3ItemsWithIDsMap = keyBy(s3ItemsWithIDs, (item) => item.itemID);

  flatMetricsTyped.putMetric(
    SitemapFreshenerTypedMetrics.ItemReceivedFromS3,
    stats.s3SitemapCountBefore,
    metricUnit.Count,
  );

  // Initially the Sitemap writing did not de-dupe so sometimes there are duplicates
  // in the XML files.  Use the Map to de-dupe.
  // DynamoDB BatchGets will throw if there are duplicate keys
  const s3ItemsIDsDeduped = Object.keys(s3ItemsWithIDsMap);
  stats.s3SitemapCountDeduped = s3ItemsIDsDeduped.length;

  log.info('finished loading existing sitemap from S3', {
    s3SitemapCountBefore: stats.s3SitemapCountBefore,
    s3SitemapCountDeduped: s3ItemsIDsDeduped.length,
  });

  // Get the consolidated list of unique itemIDs
  // seen across both the DB item-by-file-list and the S3 file
  const consolidatedItemIDs = s3ItemsIDsDeduped.slice();
  if (config.repairDBFileItemList) {
    Array.prototype.push.apply(consolidatedItemIDs, Object.keys(dbItemRecordsByFileMap));
  }
  const consolidatedItemIDsDeduped = uniq(consolidatedItemIDs);
  stats.consolidatedItemIDsDeduped = consolidatedItemIDsDeduped.length;
  if (config.repairDBFileItemList) {
    log.info('unique DB item IDs by filename + S3 item IDs', {
      consolidatedItemIDsDeduped: consolidatedItemIDsDeduped.length,
    });
  } else {
    log.info('unique S3 item IDs only', {
      consolidatedItemIDsDeduped: consolidatedItemIDsDeduped.length,
    });
  }

  // Fetch the ByItemID records for the DB + S3 sitemap file items
  // This needed to find records that were dual-written to another file
  const prefetchConsolidatedItemRecordsByItem = new IterableMapper<string[], ItemRecord[]>(
    batch(consolidatedItemIDsDeduped, 50),
    // eslint-disable-next-line @typescript-eslint/require-await
    async (itemObjs) =>
      ItemRecord.loadMany(
        dbManager,
        itemObjs.map((value) => {
          return {
            ItemID: value,
            Type: type,
          };
        }),
        false,
        false,
      ),
    { concurrency: 2, maxUnread: 6 },
  );

  // Make sure we only use the map, which has items that do not belong
  // to this file removed
  s3ItemsWithIDs = undefined;

  const consolidatedItemRecordsByItem: Record<string, ItemRecord> = {};
  for await (const itemRecordByItemIDBatch of prefetchConsolidatedItemRecordsByItem) {
    for (const itemRecordByItemID of itemRecordByItemIDBatch) {
      consolidatedItemRecordsByItem[itemRecordByItemID.ItemID] = itemRecordByItemID;
    }
  }

  const itemRecordsToWriteToDBByFileNameOnlyMap: Record<string, ItemRecord> = {};

  // If an item is owned by another file we need to remove it from our file
  // If there is no ByItemID record, at all, for this item, we need to add it to our file
  for (const s3ItemKey of Object.keys(s3ItemsWithIDsMap)) {
    const s3Item = s3ItemsWithIDsMap[s3ItemKey];
    const dbItemByFileName = dbItemRecordsByFileMap[s3Item.itemID];
    const s3ItemRecordByItem = consolidatedItemRecordsByItem[s3Item.itemID];

    if (s3ItemRecordByItem !== undefined && s3ItemRecordByItem.FileName !== filename) {
      // Some other file has this item
      stats.s3SitemapItemInDbCountDiffFile++;

      // This item was written to a different file
      // Update our record to say we no longer own this item
      // Do NOT update the `itemID#[itemID]#type#[type]` key
      // as that would steal ownership of the item back to us
      // This is a weird case worthy of logging
      log.warn('item was written to a different file - skipping', {
        itemID: s3ItemRecordByItem.ItemID,
        owningFileName: s3ItemRecordByItem.FileName,
        source: 's3',
      });

      flatMetricsTyped.putMetric(
        SitemapFreshenerTypedMetrics.ItemRemovedS3NotOwned,
        1,
        metricUnit.Count,
      );

      // Do not iterate as an item legitimately in the DB assigned to this file
      delete dbItemRecordsByFileMap[s3ItemRecordByItem.ItemID];

      // Change the filename to ours so we update only our record for this item
      s3ItemRecordByItem.FileName = filename;

      // Update only the ItemRecordByFileName to mark this as toRemove
      s3ItemRecordByItem.ResetTimeDirtiedISO({ toRemove: true });
      // Flip the status to removed
      s3ItemRecordByItem.ClearTimeDirtiedISO();

      // Set the SitemapItem to the one read from S3
      s3ItemRecordByItem.SitemapItem = s3Item.item;

      // Record this record for special save handling to update
      // only the ByFileName record
      itemRecordsToWriteToDBByFileNameOnlyMap[s3ItemRecordByItem.ItemID] = s3ItemRecordByItem;
    } else if (dbItemByFileName !== undefined) {
      // Item exists in DB and is assigned to our file, so we can skip it
      stats.s3SitemapItemInDbCountSameFile++;
      continue;
    } else {
      // Item is not listed with our File and has no ItemID record at all
      stats.s3SitemapItemNotInDbCount++;
      const record = new ItemRecord({
        Type: type,
        FileName: filename,
        ItemID: s3Item.itemID,
        SitemapItem: s3Item.item,
        ItemStatus: 'written',
      });

      // Item is not in the DB, we need to re-add the DB record
      itemRecordsToWriteToDB.push(record);
      // Also need to write the item back to the sitemap
      itemRecordsToWriteToSitemap.push(record);

      // The ItemCount for the FileRecord might not be correct
      // We should overwrite it at the end
      flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.ItemRepaired, 1, metricUnit.Count);

      // This item was written to this file but has no record of this in the DB
      // The item does not have an ItemID-keyed record either so we can
      // record this item in the DB as beloning to this file
      log.warn('item in S3 file has no DB record - repairing', {
        itemID: s3Item.itemID,
        source: 's3',
      });
    }
  }

  // If an item is owned by another file we need to remove it from our file
  // If there is no ByItemID record, at all, for this item, we need to add it to our file
  if (config.repairDBFileItemList) {
    for (const dbItemKey of Object.keys(dbItemRecordsByFileMap)) {
      const dbItemByFileName = dbItemRecordsByFileMap[dbItemKey];
      const dbItemRecordByItem = consolidatedItemRecordsByItem[dbItemKey];

      if (dbItemByFileName.ItemStatus === 'removed') {
        continue;
      }

      if (dbItemRecordByItem !== undefined && dbItemRecordByItem.FileName !== filename) {
        // Some other file has this item
        stats.dbSitemapItemInDbCountDiffFile++;

        // This item was written to a different file
        // Update our record to say we no longer own this item
        // Do NOT update the `itemID#[itemID]#type#[type]` key
        // as that would steal ownership of the item back to us
        // This is a weird case worthy of logging
        log.warn('item was written to a different file - skipping', {
          itemID: dbItemKey,
          owningFileName: dbItemRecordByItem.FileName,
          source: 'db',
        });

        flatMetricsTyped.putMetric(
          SitemapFreshenerTypedMetrics.ItemRemovedDBNotOwned,
          1,
          metricUnit.Count,
        );

        // Do not iterate as an item legitimately in the DB assigned to this file
        delete dbItemRecordsByFileMap[dbItemKey];

        // Change the filename to ours so we update only our record for this item
        dbItemRecordByItem.FileName = filename;

        // Update only the ItemRecordByFileName to mark this as toRemove
        dbItemRecordByItem.ResetTimeDirtiedISO({ toRemove: true });
        // Flip the status to removed
        dbItemRecordByItem.ClearTimeDirtiedISO();

        // Echo back the SitemapItem from the ByFileName record
        dbItemRecordByItem.SitemapItem = dbItemByFileName.SitemapItem;

        // Record this record for special save handling to update
        // only the ByFileName record
        itemRecordsToWriteToDBByFileNameOnlyMap[dbItemRecordByItem.ItemID] = dbItemRecordByItem;
      } else {
        // This file still owns this item
        stats.dbSitemapItemInDbCountSameFile++;
      }
    }
  }

  // Consolidate the list of by-filename-only ItemRecords to update
  Array.prototype.push.apply(
    itemRecordsToWriteToDBByFileNameOnly,
    Object.values(itemRecordsToWriteToDBByFileNameOnlyMap),
  );

  log.info('finished repairDB step', {
    repairStats: stats,
  });
}
