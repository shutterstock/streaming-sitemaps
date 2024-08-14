/// <reference types="jest" />
import 'jest-dynalite/withDb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DBManager } from './manager';
import {
  IShardStateRecord,
  ShardStateRecord,
  IShardStateRecordNoKeysLoose,
  IShardStateRecordNoKeys,
} from './shard';

describe('shard state records', () => {
  let client: DynamoDBClient;
  let dbManager: DBManager;

  beforeAll(() => {
    // console.log(`endpoint: ${process.env.MOCK_DYNAMODB_ENDPOINT}`);
    client = new DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
    dbManager = new DBManager({ client, tableName: 'sitemaps' });
  });
  afterAll(() => {
    client.destroy();
  });

  it('constructor preserves passed-in values', () => {
    const irecord: IShardStateRecordNoKeys = {
      Type: 'sometype',
      ShardId: 1,
      CurrentFileName: 'sitemap-00001.xml.gz',
      FileCount: 1,
      TotalItemCount: 5,
      CurrentFileItemCount: 5,
      TimeFirstSeenISO: '2021-10-30T16:17:07.999Z',
      TimeLastWrittenISO: '2021-10-30T16:17:07.999Z',
    };
    const record = new ShardStateRecord(irecord);

    expect(record).toMatchObject(irecord);
    expect(record.TimeFirstSeenISO).toBe('2021-10-30T16:17:07.999Z');
    expect(record.CurrentFileName).toBe('sitemap-00001.xml.gz');
  });

  it('saving an item should create a record', async () => {
    const record = new ShardStateRecord({
      Type: 'widget',
      ShardId: 1,
      CurrentFileName: 'sitemap-00001.xml.gz',
      FileCount: 1,
      TimeFirstSeenISO: '2021-10-30T16:17:07.999Z',
      TimeLastWrittenISO: '2021-10-30T16:17:07.999Z',
    });

    await record.save(dbManager);

    // Get by ShardId
    {
      const { Item } = (await dbManager.ddbDocClient.get({
        TableName: dbManager.tableName,
        Key: {
          PK: 'shardList#type#widget',
          SK: 'shardId#1',
        },
      })) as unknown as { Item: ShardStateRecord };
      expect(Item).toBeDefined();
      expect(Item.PK).toBe('shardList#type#widget');
      expect(Item.SK).toBe('shardId#1');
      expect(Item.CurrentFileName).toBe('sitemap-00001.xml.gz');
      expect(Item.Type).toBe('widget');

      expect(record).toMatchObject<IShardStateRecord>(Item);
    }
  });

  it('save throws if key is missing Type', async () => {
    // @ts-expect-error
    const record = new ShardStateRecord({});
    await expect(async () => record.save(dbManager)).rejects.toThrowError('Type is required');
  });

  it('save throws if key is missing ShardId', async () => {
    // @ts-expect-error
    const record = new ShardStateRecord({ Type: 'widget' });
    await expect(async () => record.save(dbManager)).rejects.toThrowError('ShardId is required');
  });

  describe('two records', () => {
    beforeEach(async () => {
      let irecord: IShardStateRecordNoKeysLoose = {
        Type: 'widget',
        ShardId: 1,
        CurrentFileName: 'sitemap-1-00001.xml.gz',
        TotalItemCount: 5,
        FileCount: 1,
      };
      let record = new ShardStateRecord(irecord);
      await record.save(dbManager);

      irecord = {
        Type: 'widget',
        ShardId: 2,
        CurrentFileName: 'sitemap-2-00001.xml.gz',
        TotalItemCount: 7,
        FileCount: 1,
      };
      record = new ShardStateRecord(irecord);
      await record.save(dbManager);

      // Add a record for another shardId that we should not see
      irecord = {
        Type: 'acme',
        ShardId: 1,
        CurrentFileName: 'sitemap-1-00001.xml.gz',
        TotalItemCount: 7,
        FileCount: 1,
      };
      record = new ShardStateRecord(irecord);
      await record.save(dbManager);
    });

    it('loadOne should load one record', async () => {
      {
        const record = await ShardStateRecord.loadOne(dbManager, { Type: 'widget', ShardId: 1 });

        expect(record).toBeDefined();
        expect(record.Type).toBe('widget');
        expect(record.CurrentFileName).toBe('sitemap-1-00001.xml.gz');
      }

      {
        const record = await ShardStateRecord.loadOne(dbManager, { Type: 'widget', ShardId: 2 });

        expect(record).toBeDefined();
        expect(record.Type).toBe('widget');
        expect(record.CurrentFileName).toBe('sitemap-2-00001.xml.gz');
      }
    });

    it('loadType function should load all records', async () => {
      const records = await ShardStateRecord.loadType(dbManager, { Type: 'widget' });

      expect(records).toBeDefined();
      expect(records).toBeInstanceOf(Array);
      expect(records.length).toBe(2);

      expect(records[0].Type).toBe('widget');
      expect(records[0].CurrentFileName).toBe('sitemap-1-00001.xml.gz');

      expect(records[1].Type).toBe('widget');
      expect(records[1].CurrentFileName).toBe('sitemap-2-00001.xml.gz');
    });
  });

  it('loadOne should handle missing records', async () => {
    const record = await ShardStateRecord.loadOne(dbManager, { Type: 'notype', ShardId: 1 });
    expect(record).not.toBeDefined();
  });

  it('loadType should handle missing records', async () => {
    const records = await ShardStateRecord.loadType(dbManager, { Type: 'notype' });
    expect(records).toBeDefined();
    expect(records.length).toBe(0);
  });
});
