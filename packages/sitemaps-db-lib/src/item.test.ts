/// <reference types="jest" />
import 'jest-dynalite/withDb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DBManager } from './manager';
import { IItemRecordNoKeys, ItemRecord } from './item';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

describe('item records', () => {
  let client: DynamoDBClient;
  let dbManager: DBManager;
  beforeAll(() => {
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
    const irecord: IItemRecordNoKeys = {
      FileName: 'somefile.xml.gz',
      ItemID: '123456',
      ItemStatus: 'towrite',
      SitemapItem: {
        url: 'https://www.example.com/somepath/',
      },
      TimeFirstSeenISO: '2021-10-30T16:17:07.999Z',
      Type: 'sometype',
      TimeLastWrittenISO: '2021-10-30T16:17:07.999Z',
    };
    const record = new ItemRecord(irecord);

    expect(record).toMatchObject(irecord);
    expect(record.ItemStatus).toBe('towrite');
  });

  it('saving an item should create two records', async () => {
    const record = new ItemRecord({
      FileName: 'sitemap-00001.xml.gz',
      ItemID: '123456',
      Type: 'widget',
      SitemapItem: {
        url: 'https://www.example.com/',
      },
    });

    await record.save(dbManager);

    // Get by ItemID
    {
      const { Item } = (await dbManager.ddbDocClient.get({
        TableName: dbManager.tableName,
        Key: {
          PK: 'itemID#123456#type#widget',
          SK: 'item',
        },
      })) as unknown as { Item: ItemRecord };
      expect(Item).toBeDefined();
      expect(Item.PK).toBe('itemID#123456#type#widget');
      expect(Item.SK).toBe('item');
      expect(Item.FileName).toBe('sitemap-00001.xml.gz');
      expect(Item.Type).toBe('widget');
      expect(Item.ItemID).toBe('123456');
      expect(Item.ItemStatus).toBe('written');
      expect(Item.SitemapItem).toEqual({ url: 'https://www.example.com/' });
    }

    // Get by FileName
    {
      const { Item } = (await dbManager.ddbDocClient.get({
        TableName: dbManager.tableName,
        Key: {
          PK: 'fileName#sitemap-00001.xml.gz#type#widget',
          SK: 'itemID#123456',
        },
      })) as unknown as { Item: ItemRecord };
      expect(Item).toBeDefined();
      expect(Item.PK).toBe('fileName#sitemap-00001.xml.gz#type#widget');
      expect(Item.SK).toBe('itemID#123456');
      expect(Item.FileName).toBe('sitemap-00001.xml.gz');
      expect(Item.Type).toBe('widget');
      expect(Item.ItemID).toBe('123456');
      expect(Item.ItemStatus).toBe('written');
      expect(Item.SitemapItem).toEqual({ url: 'https://www.example.com/' });
    }
  });

  describe('two records', () => {
    beforeEach(async () => {
      let record = new ItemRecord({
        FileName: 'sitemap-00001.xml.gz',
        ItemID: '123456',
        Type: 'widget',
        SitemapItem: {
          url: 'https://www.example.com/search/',
        },
      });

      await record.save(dbManager);

      record = new ItemRecord({
        FileName: 'sitemap-00001.xml.gz',
        ItemID: '123457',
        Type: 'widget',
        SitemapItem: {
          url: 'https://www.example.com/widgets/',
        },
      });

      await record.save(dbManager);

      // Add a record for another type that we should not see
      record = new ItemRecord({
        FileName: 'sitemap-00001.xml.gz',
        ItemID: '123459',
        Type: 'acme',
        SitemapItem: {
          url: 'https://www.example.com/acme/',
        },
      });

      await record.save(dbManager);

      // Add a record for another file that we should not see
      record = new ItemRecord({
        FileName: 'sitemap-00002.xml.gz',
        ItemID: '123458',
        Type: 'widget',
        SitemapItem: {
          url: 'https://www.example.com/file2/',
        },
      });

      await record.save(dbManager);
    });

    it('loadOne should load one record', async () => {
      {
        const record = await ItemRecord.loadOne(
          dbManager,
          { Type: 'widget', ItemID: '123456' },
          true,
        );

        expect(record.ItemID).toBe('123456');
        expect(record.Type).toBe('widget');
        expect(record.SitemapItem).toEqual({
          url: 'https://www.example.com/search/',
        });
      }

      {
        const record = await ItemRecord.loadOne(
          dbManager,
          { Type: 'widget', ItemID: '123457' },
          true,
        );

        expect(record.ItemID).toBe('123457');
        expect(record.Type).toBe('widget');
        expect(record.SitemapItem).toEqual({
          url: 'https://www.example.com/widgets/',
        });
      }
    });

    it('ClearTimeDirtiedISO should work', async () => {
      // `towrite` pending
      {
        const record = await ItemRecord.loadOne(
          dbManager,
          { Type: 'widget', ItemID: '123456' },
          true,
        );

        // Confirm that ResetTimeDirtiedISO changed only the right fields
        const recordTest = await ItemRecord.loadOne(
          dbManager,
          { Type: 'widget', ItemID: '123456' },
          true,
        );
        recordTest.ResetTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeDefined();
        expect(recordTest.ItemStatus).toBe('towrite');
        const recordTestDBStruct = recordTest.dbStruct as Writeable<IItemRecordNoKeys>;
        delete recordTestDBStruct.TimeDirtiedISO;
        recordTestDBStruct.ItemStatus = 'written';
        expect(recordTestDBStruct).toEqual(record.dbStruct);

        // Confirm that ClearTimeDirtiedISO changed only the right fields
        recordTest.ClearTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeUndefined();
        expect(recordTest.ItemStatus).toBe('written');

        // Confirm that ClearTimeDirtiedISO changed only the right fields
        recordTest.ResetTimeDirtiedISO();
        recordTest.ClearTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeUndefined();
        expect(recordTest.ItemStatus).toBe('written');
      }

      // `toremove` pending
      {
        const record = await ItemRecord.loadOne(
          dbManager,
          { Type: 'widget', ItemID: '123456' },
          true,
        );

        // Confirm that ResetTimeDirtiedISO changed only the right fields
        const recordTest = await ItemRecord.loadOne(
          dbManager,
          { Type: 'widget', ItemID: '123456' },
          true,
        );
        recordTest.ResetTimeDirtiedISO({ toRemove: true });
        expect(recordTest.TimeDirtiedISO).toBeDefined();
        expect(recordTest.ItemStatus).toBe('toremove');
        const recordTestDBStruct = recordTest.dbStruct as Writeable<IItemRecordNoKeys>;
        delete recordTestDBStruct.TimeDirtiedISO;
        recordTestDBStruct.ItemStatus = 'written';
        expect(recordTestDBStruct).toEqual(record.dbStruct);

        // Confirm that ClearTimeDirtiedISO changed only the right fields
        recordTest.ClearTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeUndefined();
        expect(recordTest.ItemStatus).toBe('removed');

        // Confirm that ClearTimeDirtiedISO changed only the right fields
        recordTest.ResetTimeDirtiedISO({ toRemove: true });
        recordTest.ClearTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeUndefined();
        expect(recordTest.ItemStatus).toBe('removed');
      }
    });

    it('loadFile function should load all records', async () => {
      const records = await ItemRecord.loadFile(
        dbManager,
        {
          Type: 'widget',
          FileName: 'sitemap-00001.xml.gz',
        },
        true,
      );

      expect(records).toBeDefined();
      expect(records).toBeInstanceOf(Array);
      expect(records.length).toBe(2);

      expect(records[0].ItemID).toBe('123456');
      expect(records[0].Type).toBe('widget');
      expect(records[0].SitemapItem).toEqual({
        url: 'https://www.example.com/search/',
      });

      expect(records[1].ItemID).toBe('123457');
      expect(records[1].Type).toBe('widget');
      expect(records[1].SitemapItem).toEqual({
        url: 'https://www.example.com/widgets/',
      });
    });

    it('loadMany loads items from different keys', async () => {
      const keys = [
        { Type: 'widget', ItemID: '123458' },
        { Type: 'acme', ItemID: '123459' },
      ];
      const records = await ItemRecord.loadMany(dbManager, keys, true);

      expect(records).toBeDefined();
      expect(records.length).toBe(2);

      let record = records.find((value) => {
        return value.Type === keys[0].Type && value.ItemID === keys[0].ItemID;
      });

      expect(record?.ItemID).toBe('123458');
      expect(record?.Type).toBe('widget');
      expect(record?.SitemapItem).toEqual({
        url: 'https://www.example.com/file2/',
      });

      record = records.find((value) => {
        return value.Type === keys[1].Type && value.ItemID === keys[1].ItemID;
      });
      expect(record?.ItemID).toBe('123459');
      expect(record?.Type).toBe('acme');
      expect(record?.SitemapItem).toEqual({
        url: 'https://www.example.com/acme/',
      });
    });
  });

  it('saveMany should work', async () => {
    const items = [
      new ItemRecord({
        FileName: 'sitemap-00001.xml.gz',
        ItemID: '123456',
        Type: 'widget',
        SitemapItem: {
          url: 'https://www.example.com/search/',
        },
      }),
      new ItemRecord({
        FileName: 'sitemap-00001.xml.gz',
        ItemID: '123457',
        Type: 'widget',
        SitemapItem: {
          url: 'https://www.example.com/widgets/',
        },
      }),
    ];

    await ItemRecord.saveMany(dbManager, items);

    const loadedItems = await ItemRecord.loadMany(
      dbManager,
      [
        { Type: 'widget', ItemID: '123456' },
        { Type: 'widget', ItemID: '123457' },
      ],
      true,
    );

    const loadedOrderedItems: ItemRecord[] = [];
    loadedItems.map((value) => {
      if (value.ItemID === '123456') loadedOrderedItems[0] = value;
      if (value.ItemID === '123457') loadedOrderedItems[1] = value;
    });

    expect(items[0].dbStruct).toMatchObject(loadedOrderedItems[0].dbStruct);
    expect(items[1].dbStruct).toMatchObject(loadedOrderedItems[1].dbStruct);
  });

  it('loadOne should handle missing records', async () => {
    const record = await ItemRecord.loadOne(dbManager, { Type: 'notype', ItemID: 'noid' });
    expect(record).not.toBeDefined();
  });

  it('loadFile should handle missing records', async () => {
    const records = await ItemRecord.loadFile(dbManager, {
      Type: 'notype',
      FileName: 'nofilename.xml.gz',
    });
    expect(records).toBeDefined();
    expect(records.length).toBe(0);
  });
});
