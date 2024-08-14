//index.test.ts
/// <reference types="jest" />
import 'jest-dynalite/withDb';
// reflect-metadata wants to be imported first so we have to import
// it before the Config since we're importing the Config before the
// handler
import 'reflect-metadata';
// Config has to be mocked before the handler is imported because
// the handler accesses the static Config.instance at file scope.
// Note: jest.spyOn(Config, 'instance', 'get').mockImplementation(...)
// does not work here because Config.instance is a static class property
// not an object property.
import { Config, IConfig } from './config/config';
jest.mock('./config/config');
Object.defineProperty(Config, 'instance', {
  configurable: false,
  enumerable: false,
  get: jest.fn((): IConfig => {
    return {
      awsAccountID: 123456,
      awsRegion: 'mock',
      metricsNamespace: 'some/metrics/namespace',
      siteBaseURL: 'https://www.example.com',
      s3SitemapsBucketName: 'doc-example-bucket',
      compressSitemapFiles: false,
      emitMetrics: false,
      logSilent: true,
      localDirectory: '/tmp/sitemaps',
      s3Directory: 'sitemaps/',
      siteBaseSitemapPath: 'sitemaps',
      sitemapFileNamingScheme: 'index',
      tableName: 'sitemaps',
      storeItemStateInDynamoDB: false,
      itemsPerSitemapLimit: 5000,
      kinesisIndexWriterStreamName: 'sitemap-index-stream',
      dynamoDBConcurrentReads: 2,
      dynamoDBPrefetchMaxUnread: 4,
      dynamoDBConcurrentWrites: 20,
      s3ConcurrentWrites: 4,
      throwOnCompactVersion: 0,
      incomingCompactVersion: 0,
      kinesisSelfStreamName: 'sitemap-stream',
      infixDirs: [],
    };
  }),
});
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { overrideDBManager } from './index';
import { createNewSitemap, createSitemapNameRoot } from './sitemap-rotate';
import { ShardStateRecord, DBManager } from '@shutterstock/sitemaps-db-lib';
const testUUID = '88888888-4444-4444-4444-cccccccccccc';
const testUUID2 = '88888888-4444-4444-4444-ccccccccccc2';
const testUUIDs = [testUUID, testUUID2];
import { v4 } from 'uuid';
// jest.mock('uuid');
jest.mock('uuid', () => {
  let uuidIndex = 0;
  return {
    v4: jest.fn(() => testUUIDs[uuidIndex++ % testUUIDs.length]),
  };
});

describe('sitemap-rotate', () => {
  let config: IConfig;
  let sitemapExtension: string;
  let dynamoClient: DynamoDBClient;
  let dbManager: DBManager;

  beforeAll(() => {
    config = { ...Config.instance };

    // console.log(`endpoint: ${process.env.MOCK_DYNAMODB_ENDPOINT}`);
    dynamoClient = new DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
    dbManager = new DBManager({ client: dynamoClient, tableName: config.tableName });
  });
  afterAll(() => {
    dynamoClient.destroy();
  });

  beforeEach(() => {
    config = { ...Config.instance };
    sitemapExtension = config.compressSitemapFiles ? '.xml.gz' : '.xml';
    overrideDBManager({ dbManager, dynamoClient });
  });

  afterEach(() => {
    // Reset the uuid mock so we get the same uuid on second call
    //(v4 as jest.MockedFunction<typeof v4>).mockReset();
  });

  describe('createSitemapNameRoot', () => {
    const type = 'acme';
    const shardId = 123;

    beforeEach(() => {
      (v4 as jest.MockedFunction<typeof v4>).mockImplementation(() => {
        return testUUID;
      });
    });

    describe('uuidv4', () => {
      it('empty state', () => {
        const result = createSitemapNameRoot({
          shardState: new ShardStateRecord({
            ShardId: shardId,
            Type: type,
          }),
          sitemapFileNamingScheme: 'uuidv4',
        });
        expect(result).toBe(`${type}-${shardId}-${testUUID}`);
      });

      it('existing state', () => {
        const result = createSitemapNameRoot({
          shardState: new ShardStateRecord({
            ShardId: shardId,
            Type: type,
            CurrentFileName: `${testUUID2}${sitemapExtension}`,
            FileCount: 1,
          }),
          sitemapFileNamingScheme: 'uuidv4',
        });
        expect(result).toBe(`${type}-${shardId}-${testUUID}`);
      });
    });

    describe('index', () => {
      it('empty state', () => {
        const result = createSitemapNameRoot({
          shardState: new ShardStateRecord({
            ShardId: shardId,
            Type: type,
          }),
          sitemapFileNamingScheme: 'index',
        });
        expect(result).toBe(`${type}-${shardId}-00001`);
      });

      it('existing state', () => {
        const result = createSitemapNameRoot({
          shardState: new ShardStateRecord({
            ShardId: shardId,
            Type: type,
            CurrentFileName: `${type}-${shardId}-00063${sitemapExtension}`,
            FileCount: 63,
          }),
          sitemapFileNamingScheme: 'index',
        });
        expect(result).toBe(`${type}-${shardId}-00064`);
      });
    });

    describe('date+index', () => {
      it('empty state', () => {
        const result = createSitemapNameRoot({
          shardState: new ShardStateRecord({
            ShardId: shardId,
            Type: type,
            CurrentFileName: '',
            FileCount: 0,
          }),
          sitemapFileNamingScheme: 'date+index',
        });
        expect(result).toBe(`${type}-${new Date().toISOString().slice(0, 10)}-${shardId}-00001`);
      });

      it('existing state', () => {
        const result = createSitemapNameRoot({
          shardState: new ShardStateRecord({
            ShardId: shardId,
            Type: type,
            CurrentFileName: `${type}-2021-10-27-${shardId}-00063${sitemapExtension}`,
            FileCount: 63,
          }),
          sitemapFileNamingScheme: 'date+index',
        });
        expect(result).toBe(`${type}-${new Date().toISOString().slice(0, 10)}-${shardId}-00064`);
      });
    });
  });

  describe('createNewSitemap', () => {
    const type = 'acme';
    const shardId = 123;

    describe('uuidv4', () => {
      beforeEach(() => {
        (v4 as jest.MockedFunction<typeof v4>).mockImplementation(() => {
          return testUUID;
        });
      });

      it('empty state', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
          CurrentFileName: '',
        });
        const result = await createNewSitemap({
          sitemapFileNamingScheme: 'uuidv4',
          shardState,
          config,
          dbManager,
        });
        expect(result.sitemap.filename).toBe(`${type}-${shardId}-${testUUID}${sitemapExtension}`);
        expect(shardState.CurrentFileName).toBe(result.sitemap.filename);
        expect(shardState.FileCount).toBe(1);
      });

      it('empty state - blank filename', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
        });
        const result = await createNewSitemap({
          sitemapFileNamingScheme: 'uuidv4',
          shardState,
          config,
          dbManager,
        });
        expect(result.sitemap.filename).toBe(`${type}-${shardId}-${testUUID}${sitemapExtension}`);
        expect(shardState.CurrentFileName).toBe(result.sitemap.filename);
        expect(shardState.FileCount).toBe(1);
      });

      it('existing state', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
        });
        shardState.ChangeCurrentFile(`${type}/${type}-${shardId}-${testUUID2}${sitemapExtension}`);
        const result = await createNewSitemap({
          sitemapFileNamingScheme: 'uuidv4',
          shardState,
          config,
          dbManager,
        });
        expect(result).toBeDefined();
        expect(result.sitemap.filename).toBe(`${type}-${shardId}-${testUUID}${sitemapExtension}`);
        expect(shardState.FileCount).toBe(2);
        expect(shardState.CurrentFileName).toBe(result.sitemap.filename);
      });
    });

    describe('index', () => {
      it('empty state', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
          CurrentFileName: '',
          CurrentFileItemCount: 0,
        });
        const result = await createNewSitemap({
          sitemapFileNamingScheme: 'index',
          shardState,
          config,
          dbManager,
        });
        expect(result).toBeDefined();
        expect(result.sitemap.filename).toBe(`${type}-${shardId}-00001${sitemapExtension}`);
        expect(shardState.FileCount).toBe(1);
      });

      it('existing state', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
          FileCount: 60,
        });
        shardState.ChangeCurrentFile(`${type}/${type}-${shardId}-00001${sitemapExtension}`);
        shardState.ChangeCurrentFile(`${type}/${type}-${shardId}-00007${sitemapExtension}`);
        shardState.ChangeCurrentFile(`${type}/${type}-${shardId}-000063${sitemapExtension}`);
        const result = await createNewSitemap({
          sitemapFileNamingScheme: 'index',
          shardState,
          config,
          dbManager,
        });
        expect(result).toBeDefined();
        expect(result.sitemap.filename).toBe(`${type}-${shardId}-00064${sitemapExtension}`);
        expect(shardState.FileCount).toBe(64);
        expect(shardState.CurrentFileName).toBe(result.sitemap.filename);
      });
    });

    describe('date+index', () => {
      it('empty state', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
          CurrentFileName: '',
        });
        let result = await createNewSitemap({
          sitemapFileNamingScheme: 'date+index',
          shardState,
          config,
          dbManager,
        });
        expect(result).toBeDefined();
        expect(result.sitemap.filename).toBe(
          `${type}-${new Date().toISOString().slice(0, 10)}-${shardId}-00001${sitemapExtension}`,
        );
        expect(shardState.FileCount).toBe(1);
        expect(shardState.CurrentFileName).toBe(result.sitemap.filename);
        expect(shardState.FileCount).toBe(1);

        result = await createNewSitemap({
          sitemapFileNamingScheme: 'date+index',
          shardState,
          config,
          dbManager,
        });
        expect(result).toBeDefined();
        expect(result.sitemap.filename).toBe(
          `${type}-${new Date().toISOString().slice(0, 10)}-${shardId}-00002${sitemapExtension}`,
        );
        expect(shardState.FileCount).toBe(2);
      });

      it('existing state', async () => {
        const shardState = new ShardStateRecord({
          Type: type,
          ShardId: shardId,
          FileCount: 60,
        });
        shardState.ChangeCurrentFile(`${type}-2021-10-27-${shardId}-00001${sitemapExtension}`);
        shardState.ChangeCurrentFile(`${type}-2021-10-27-${shardId}-00007${sitemapExtension}`);
        shardState.ChangeCurrentFile(`${type}-2021-10-27-${shardId}-00063${sitemapExtension}`);
        const result = await createNewSitemap({
          sitemapFileNamingScheme: 'date+index',
          shardState,
          config,
          dbManager,
        });
        expect(result).toBeDefined();
        expect(result.sitemap.filename).toBe(
          `${type}-${new Date().toISOString().slice(0, 10)}-${shardId}-00064${sitemapExtension}`,
        );
        expect(shardState.CurrentFileName).toBe(result.sitemap.filename);
        expect(shardState.FileCount).toBe(64);
      });
    });
  });
});
