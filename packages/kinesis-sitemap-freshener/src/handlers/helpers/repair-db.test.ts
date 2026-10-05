/// <reference types="jest" />
import { NoSuchKey } from '@aws-sdk/client-s3';
import { DBManager, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { prepareRepairDB } from './repair-db';
import { ValidateItemIDRegex } from './validate-itemid-regex';
import type { IConfig } from '../../config/config';

jest.mock('./validate-itemid-regex');
jest.mock('../../utils/log', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function record(
  ItemID: string,
  FileName = 'current.xml',
  ItemStatus: 'written' | 'removed' = 'written',
) {
  return new ItemRecord({
    Type: 'widget',
    ItemID,
    FileName,
    ItemStatus,
    SitemapItem: { url: `https://example.com/${ItemID}` },
  });
}
function options(repairDBFileItemList = true) {
  return {
    config: { repairDBFileItemList, s3SitemapsBucketName: 'unused' } as IConfig,
    dbManager: {} as DBManager,
    dbItemRecordsByFileMap: {} as Record<string, ItemRecord>,
    itemRecordsToWriteToDB: [] as ItemRecord[],
    itemRecordsToWriteToDBByFileNameOnly: [] as ItemRecord[],
    itemRecordsToWriteToSitemap: [] as ItemRecord[],
    filename: 'current.xml',
    type: 'widget',
    flatMetricsTyped: new FlatCountMetrics(),
    message: {
      operation: 'freshenFile' as const,
      repairDB: true,
      filename: 'current.xml',
      itemIDRegex: '(?<ItemID>.+)',
    },
    stats: {
      s3SitemapItemInDbCountSameFile: 0,
      s3SitemapItemInDbCountDiffFile: 0,
      s3SitemapItemNotInDbCount: 0,
      dbSitemapItemInDbCountSameFile: 0,
      dbSitemapItemInDbCountDiffFile: 0,
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(ValidateItemIDRegex).mockReset();
});

describe('repair planning preserves item ownership', () => {
  it('deduplicates S3 IDs and marks stale file records without stealing another file', async () => {
    const opts = options();
    opts.dbItemRecordsByFileMap = {
      local: record('local'),
      moved: record('moved'),
      dbmoved: record('dbmoved'),
      removed: record('removed', 'current.xml', 'removed'),
    };
    const ids = ['missing', 'missing', 'local', 'moved'];
    jest.mocked(ValidateItemIDRegex).mockResolvedValue({
      itemIDRegex: /(?<ItemID>.+)/,
      itemsWithIDs: ids.map((itemID, position) => ({
        itemID,
        item: { url: `https://example.com/${itemID}?position=${position}` },
      })),
    });
    const load = jest
      .spyOn(ItemRecord, 'loadMany')
      .mockResolvedValue([
        record('local'),
        record('moved', 'other.xml'),
        record('dbmoved', 'other.xml'),
      ]);
    await prepareRepairDB(opts);
    const keys = load.mock.calls.flatMap((call) => call[1].map((key) => key.ItemID));
    expect(keys).toEqual(['missing', 'local', 'moved', 'dbmoved', 'removed']);
    expect(opts.itemRecordsToWriteToDB.map((item) => item.ItemID)).toEqual(['missing']);
    expect(opts.itemRecordsToWriteToSitemap.map((item) => item.ItemID)).toEqual(['missing']);
    expect(opts.itemRecordsToWriteToSitemap[0].SitemapItem.url).toContain('position=1');
    expect(
      opts.itemRecordsToWriteToDBByFileNameOnly.map((item) => [
        item.ItemID,
        item.FileName,
        item.ItemStatus,
      ]),
    ).toEqual([
      ['moved', 'current.xml', 'removed'],
      ['dbmoved', 'current.xml', 'removed'],
    ]);
    expect(Object.keys(opts.dbItemRecordsByFileMap)).toEqual(['local', 'removed']);
    expect(opts.stats).toMatchObject({
      s3SitemapCountBefore: 4,
      s3SitemapCountDeduped: 3,
      consolidatedItemIDsDeduped: 5,
      s3SitemapItemNotInDbCount: 1,
      s3SitemapItemInDbCountSameFile: 1,
      s3SitemapItemInDbCountDiffFile: 1,
      dbSitemapItemInDbCountDiffFile: 1,
    });
  });

  it('limits consolidated queries to S3 IDs when by-file repair is disabled', async () => {
    const opts = options(false);
    opts.dbItemRecordsByFileMap = { dbOnly: record('dbOnly') };
    jest.mocked(ValidateItemIDRegex).mockResolvedValue({
      itemIDRegex: /(?<ItemID>.+)/,
      itemsWithIDs: [{ itemID: 'missing', item: { url: 'https://example.com/missing' } }],
    });
    const load = jest.spyOn(ItemRecord, 'loadMany').mockResolvedValue([]);
    await prepareRepairDB(opts);
    expect(load.mock.calls[0][1]).toEqual([{ ItemID: 'missing', Type: 'widget' }]);
    expect(opts.dbItemRecordsByFileMap.dbOnly).toBeDefined();
    expect(opts.itemRecordsToWriteToDBByFileNameOnly).toEqual([]);
  });

  it('allows a missing S3 object while repairing stale DB ownership', async () => {
    const opts = options();
    opts.dbItemRecordsByFileMap = { moved: record('moved') };
    jest
      .mocked(ValidateItemIDRegex)
      .mockRejectedValue(new NoSuchKey({ $metadata: {}, message: 'missing' }));
    jest.spyOn(ItemRecord, 'loadMany').mockResolvedValue([record('moved', 'other.xml')]);
    await prepareRepairDB(opts);
    expect(opts.stats).toMatchObject({
      s3SitemapCountBefore: 0,
      dbSitemapItemInDbCountDiffFile: 1,
    });
    expect(opts.itemRecordsToWriteToDB).toEqual([]);
    expect(opts.itemRecordsToWriteToDBByFileNameOnly[0].ItemStatus).toBe('removed');
  });

  it('propagates non-missing S3 failures before planning writes', async () => {
    const opts = options();
    const failure = new Error('access denied');
    jest.mocked(ValidateItemIDRegex).mockRejectedValue(failure);
    const load = jest.spyOn(ItemRecord, 'loadMany');
    await expect(prepareRepairDB(opts)).rejects.toBe(failure);
    expect(load).not.toHaveBeenCalled();
    expect(opts.itemRecordsToWriteToDB).toEqual([]);
  });

  it('propagates a failed DB prefetch instead of treating existing items as missing', async () => {
    const opts = options();
    jest.mocked(ValidateItemIDRegex).mockResolvedValue({
      itemIDRegex: /(?<ItemID>.+)/,
      itemsWithIDs: [{ itemID: 'one', item: { url: 'https://example.com/one' } }],
    });
    const failure = new Error('DB unavailable');
    jest.spyOn(ItemRecord, 'loadMany').mockRejectedValue(failure);
    await expect(prepareRepairDB(opts)).rejects.toBe(failure);
    expect(opts.itemRecordsToWriteToDB).toEqual([]);
    expect(opts.itemRecordsToWriteToSitemap).toEqual([]);
  });

  it('rejects an accidental call without repair enabled', async () => {
    const opts = options();
    opts.message.repairDB = false;
    await expect(prepareRepairDB(opts)).rejects.toThrow('repairDB is false');
    expect(ValidateItemIDRegex).not.toHaveBeenCalled();
  });
});
