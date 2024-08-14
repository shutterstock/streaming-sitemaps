/// <reference types="jest" />
import 'jest-dynalite/withDb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DBManager } from './manager';
import { IFileRecord, FileRecord, IFileRecordNoKeysLoose, IFileRecordNoKeys } from './file';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

describe('file records', () => {
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
    const irecord: IFileRecordNoKeys = {
      FileName: 'somefile.xml.gz',
      Type: 'sometype',
      FileStatus: 'dirty',
      TimeFirstSeenISO: '2021-10-30T16:17:07.999Z',
      CountWritten: 50000,
      TimeLastWrittenISO: '2021-10-30T16:17:07.999Z',
    };
    const record = new FileRecord(irecord);
    record.ResetTimeDirtiedISO();

    expect(record).toMatchObject(irecord);
    expect(record.FileStatus).toBe('dirty');
  });

  it('saving an item should create a record', async () => {
    const record = new FileRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
    });

    record.AddFileItem();

    await record.save(dbManager);

    // Get by FileName
    {
      const { Item } = (await dbManager.ddbDocClient.get({
        TableName: dbManager.tableName,
        Key: {
          PK: 'fileList#type#widget',
          SK: 'fileName#sitemap-00001.xml.gz',
        },
      })) as unknown as { Item: FileRecord };
      expect(Item).toBeDefined();
      expect(Item.PK).toBe('fileList#type#widget');
      expect(Item.SK).toBe('fileName#sitemap-00001.xml.gz');
      expect(Item.FileName).toBe('sitemap-00001.xml.gz');
      expect(Item.Type).toBe('widget');
      expect(Item.FileStatus).toBe('written');

      expect(record).toMatchObject<IFileRecord>(Item);
    }
  });

  describe('two records', () => {
    beforeEach(async () => {
      let irecord: IFileRecordNoKeysLoose = {
        FileName: 'sitemap-00001.xml.gz',
        Type: 'widget',
      };
      let record = new FileRecord(irecord);
      await record.save(dbManager);

      irecord = {
        FileName: 'sitemap-00002.xml.gz',
        Type: 'widget',
      };
      record = new FileRecord(irecord);
      await record.save(dbManager);

      // Add a record for another type that we should not see
      irecord = {
        FileName: 'sitemap-00002.xml.gz',
        Type: 'acme',
      };
      record = new FileRecord(irecord);
      await record.save(dbManager);
    });

    it('loadOne should load one record', async () => {
      {
        const record = await FileRecord.loadOne(dbManager, {
          Type: 'widget',
          FileName: 'sitemap-00001.xml.gz',
        });

        expect(record).toBeDefined();
        expect(record.Type).toBe('widget');
        expect(record.FileName).toBe('sitemap-00001.xml.gz');
      }

      {
        const record = await FileRecord.loadOne(dbManager, {
          Type: 'widget',
          FileName: 'sitemap-00002.xml.gz',
        });

        expect(record).toBeDefined();
        expect(record.Type).toBe('widget');
        expect(record.FileName).toBe('sitemap-00002.xml.gz');
      }
    });

    it('ClearTimeDirtiedISO should work', async () => {
      {
        const record = await FileRecord.loadOne(dbManager, {
          Type: 'widget',
          FileName: 'sitemap-00001.xml.gz',
        });

        // Confirm that ResetTimeDirtiedISO changed only the right fields
        const recordTest = await FileRecord.loadOne(dbManager, {
          Type: 'widget',
          FileName: 'sitemap-00001.xml.gz',
        });
        recordTest.ResetTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeDefined();
        expect(recordTest.FileStatus).toBe('dirty');
        const recordTestDBStruct = recordTest.dbStruct as Writeable<IFileRecordNoKeys>;
        delete recordTestDBStruct.TimeDirtiedISO;
        recordTestDBStruct.FileStatus = 'empty';
        expect(recordTestDBStruct).toEqual(record.dbStruct);

        // Confirm that ClearTimeDirtiedISO changed only the right fields
        recordTest.ClearTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeUndefined();
        expect(recordTest.FileStatus).toBe('empty');

        // Confirm that ClearTimeDirtiedISO changed only the right fields
        recordTest.AddFileItem();
        recordTest.ResetTimeDirtiedISO();
        recordTest.ClearTimeDirtiedISO();
        expect(recordTest.TimeDirtiedISO).toBeUndefined();
        expect(recordTest.FileStatus).toBe('written');
      }
    });

    it('loadType function should load all records', async () => {
      const records = await FileRecord.loadType(dbManager, { Type: 'widget' });

      expect(records).toBeDefined();
      expect(records).toBeInstanceOf(Array);
      expect(records.length).toBe(2);

      expect(records[0].Type).toBe('widget');
      expect(records[0].FileName).toBe('sitemap-00001.xml.gz');

      expect(records[1].Type).toBe('widget');
      expect(records[1].FileName).toBe('sitemap-00002.xml.gz');
    });
  });

  it('loadOne should handle missing records', async () => {
    const record = await FileRecord.loadOne(dbManager, {
      Type: 'notype',
      FileName: 'nofilename.xml.gz',
    });
    expect(record).not.toBeDefined();
  });

  it('loadType should handle missing records', async () => {
    const records = await FileRecord.loadType(dbManager, { Type: 'notype' });
    expect(records).toBeDefined();
    expect(records.length).toBe(0);
  });
});
