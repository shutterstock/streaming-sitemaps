/* eslint-disable no-console */
//#region Imports
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
type Writeable<T> = { -readonly [P in keyof T]: T[P] };
const theConfig: Writeable<IConfig> = {
  awsAccountID: 123456,
  awsRegion: 'mock',
  metricsNamespace: 'some/metrics/namespace',
  siteBaseURL: 'https://www.example.com',
  s3SitemapsBucketName: 'doc-example-bucket',
  emitMetrics: false,
  logSilent: true,
  localDirectory: '/tmp/sitemaps',
  s3Directory: 'sitemaps/',
  siteBaseSitemapPath: 'sitemaps',
  tableName: 'sitemaps',
  dynamoDBConcurrentWrites: 1,
  kinesisSelfStreamName: 'sitemap-stream',
  nonDryRunAllowed: false,
  captureHeapDumps: false,
  repairDBFileItemList: true,
  debugItemWrites: false,
  infixDirs: [],
};
const origConfig = { ...theConfig };
Object.defineProperty(Config, 'instance', {
  configurable: false,
  enumerable: false,
  get: function (): IConfig {
    return theConfig;
  },
});
import { handler, overrideDBManager } from './index';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as s3 from '@aws-sdk/client-s3';
import * as kinesis from '@aws-sdk/client-kinesis';
import type * as lambda from 'aws-lambda';
import type {
  ISitemapFreshenerStartMessage,
  ISitemapFreshenerFreshenFileMessage,
  ISitemapFreshenerStartResult,
} from '@shutterstock/sitemaps-models-lib';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { DBManager, FileRecord, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import path from 'path';
import { Readable } from 'stream';
import { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import { createGzip } from 'zlib';
import { inspect } from 'util';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';
//#endregion

// skipping for now to debug tests not finishing
describe('Sitemap Freshener index.ts', () => {
  let s3Client: AwsClientStub<s3.S3Client>;
  let kinesisClient: AwsClientStub<kinesis.KinesisClient>;
  const siteBaseURL = 'https://www.example.com';
  const s3SitemapsBucketName = 'doc-example-bucket';
  let dynamoClient: DynamoDBClient;
  let dbManager: DBManager;

  beforeAll(() => {
    // console.log(`endpoint: ${process.env.MOCK_DYNAMODB_ENDPOINT}`);
    dynamoClient = new DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
    dbManager = new DBManager({ client: dynamoClient, tableName: theConfig.tableName });
  });
  afterAll(() => {
    dynamoClient.destroy();
  });

  beforeEach(async () => {
    jest.resetModules(); // Most important - it clears the cache

    // Reset the config that's visible to the handler back to defaults
    Object.keys(origConfig).map((key) => {
      // @ts-expect-error we know the fields match
      theConfig[key] = origConfig[key];
    });
    s3Client = mockClient(s3.S3Client);
    kinesisClient = mockClient(kinesis.KinesisClient);
    overrideDBManager({ dbManager, dynamoClient });

    //
    // Add FileRecords
    //
    await new FileRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
      FileStatus: 'dirty',
      CountWritten: 4,
    }).save(dbManager);

    await new FileRecord({
      FileName: 'sitemap-00002.xml.gz',
      Type: 'widget',
      FileStatus: 'dirty',
      CountWritten: 4,
    }).save(dbManager);

    // Add file that has no records and does not exist on S3
    await new FileRecord({
      FileName: 'sitemap-00003.xml.gz',
      Type: 'widget',
      FileStatus: 'written',
      CountWritten: 4,
    }).save(dbManager);

    // Add a record for another type that we should not see
    await new FileRecord({
      FileName: 'sitemap-00002.xml.gz',
      Type: 'acme',
      FileStatus: 'written',
      CountWritten: 4,
    }).save(dbManager);

    //
    // Add items to sitemap-00001.xml.gz
    //
    await new ItemRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
      ItemID: '00011',
      SitemapItem: {
        url: 'https://example.com/item-00011',
      },
      ItemStatus: 'toremove',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
      ItemID: '00012',
      SitemapItem: {
        url: 'https://example.com/item-00012',
      },
      ItemStatus: 'towrite',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
      ItemID: '00013',
      SitemapItem: {
        url: 'https://example.com/item-00013',
      },
      ItemStatus: 'written',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
      ItemID: '00014',
      SitemapItem: {
        url: 'https://example.com/item-00014',
      },
      ItemStatus: 'written',
    }).save(dbManager);

    // Add item to sitemap-00001.xml.gz then stomp on it and say it's owned by another file
    await new ItemRecord({
      FileName: 'sitemap-00001.xml.gz',
      Type: 'widget',
      ItemID: '00015',
      SitemapItem: {
        url: 'https://example.com/item-00015',
      },
      ItemStatus: 'written',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00004.xml.gz',
      Type: 'widget',
      ItemID: '00015',
      SitemapItem: {
        url: 'https://example.com/item-00015',
      },
      ItemStatus: 'written',
    }).save(dbManager);

    //
    // Add items to file sitemap-00002.xml.gz
    //
    await new ItemRecord({
      FileName: 'sitemap-00002.xml.gz',
      Type: 'widget',
      ItemID: '00021',
      SitemapItem: {
        url: 'https://example.com/item-00021',
      },
      ItemStatus: 'written',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00002.xml.gz',
      Type: 'widget',
      ItemID: '00022',
      SitemapItem: {
        url: 'https://example.com/item-00022',
      },
      ItemStatus: 'written',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00002.xml.gz',
      Type: 'widget',
      ItemID: '00023',
      SitemapItem: {
        url: 'https://example.com/item-00023',
      },
      ItemStatus: 'written',
    }).save(dbManager);
    await new ItemRecord({
      FileName: 'sitemap-00002.xml.gz',
      Type: 'widget',
      ItemID: '00024',
      SitemapItem: {
        url: 'https://example.com/item-00024',
      },
      ItemStatus: 'written',
    }).save(dbManager);
  });

  describe('operation: start', () => {
    describe('direct invoke', () => {
      it('normal invoke - dryRun not passed', async () => {
        kinesisClient.on(kinesis.PutRecordsCommand).resolves({
          Records: [],
        });

        const items: ISitemapFreshenerStartMessage[] = [
          {
            operation: 'start',
            type: 'widget',
          },
        ];

        const result = await handler(
          {
            Records: items,
          },
          {
            awsRequestId: 'local-testing',
          } as lambda.Context,
        );

        expect(result).toBeDefined();
        const resultTyped = result as ISitemapFreshenerStartResult[];
        expect(resultTyped.length).toBe(1);
        expect(resultTyped[0]).toBeDefined();
        expect(resultTyped[0].message).toBeDefined();
        expect(resultTyped[0].message).toEqual(items[0]);
        expect(resultTyped[0].filesOfType).toBe(3);
        expect(resultTyped[0].filesWritten).toBe(3);
        expect(resultTyped[0].filesSkippedActive).toBe(0);

        expect(kinesisClient.calls().length).toBe(1);

        const putRecords = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
        expect(putRecords.input.Records?.length).toBe(3);

        {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const record = putRecords.input.Records![0];
          expect(record).toBeDefined();
          expect(record.PartitionKey).toBe(
            'operation#freshenFile#type#widget#filename#sitemap-00001.xml.gz#',
          );
          expect(record.Data).toBeDefined();
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const dataBuffer0 = Buffer.from(record.Data!);
          const dataStr0 = dataBuffer0.toString('utf-8');
          const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
          // The new record should be equal
          expect(data0).toEqual({
            operation: 'freshenFile',
            dryRun: true,
            dryRunDB: true,
            type: 'widget',
            filename: 'sitemap-00001.xml.gz',
          });
        }

        {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const record = putRecords.input.Records![1];
          expect(record).toBeDefined();
          expect(record.PartitionKey).toBe(
            'operation#freshenFile#type#widget#filename#sitemap-00002.xml.gz#',
          );
          expect(record.Data).toBeDefined();
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const dataBuffer0 = Buffer.from(record.Data!);
          const dataStr0 = dataBuffer0.toString('utf-8');
          const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
          // The new record should be equal
          expect(data0).toEqual({
            operation: 'freshenFile',
            dryRun: true,
            dryRunDB: true,
            type: 'widget',
            filename: 'sitemap-00002.xml.gz',
          });
        }
      });
    });

    it('normal invoke - dryRun not passed', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          type: 'widget',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(1);

      const putRecords = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
      expect(putRecords.input.Records?.length).toBe(3);

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00001.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
        });
      }

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![1];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00002.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
        });
      }
    });

    it('normal invoke - dryRun explicitly false - non-dryRun not allowed', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(0);
    });

    it('normal invoke - dryRun explicitly false - non-dryRun allowed', async () => {
      theConfig.nonDryRunAllowed = true;

      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(1);

      const putRecords = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
      expect(putRecords.input.Records?.length).toBe(3);

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00001.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
        });
      }

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![1];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00002.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
        });
      }
    });

    it('normal invoke - dryRun explicitly true', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(1);

      const putRecords = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
      expect(putRecords.input.Records?.length).toBe(3);

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00001.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
        });
      }

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![1];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00002.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
        });
      }
    });

    it('s3DirectoryOverride', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          type: 'widget',
          s3DirectoryOverride: 'non-default-path/',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(1);

      const putRecords = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
      expect(putRecords.input.Records?.length).toBe(3);

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00001.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
        });
      }

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![1];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00002.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
        });
      }
    });

    it('repairDB - validate against file', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .callsFake((input) => {
          console.info(inspect(input, true, 10, true));
        })
        .rejects()
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/widget-123456789-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          type: 'widget',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/widget-(?<ItemID>[0-9]+)',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(1);
      expect(s3Client.calls().length).toBe(1);

      const putRecords = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
      expect(putRecords.input.Records?.length).toBe(3);

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00001.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/widget-(?<ItemID>[0-9]+)',
        });
      }

      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = putRecords.input.Records![1];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe(
          'operation#freshenFile#type#widget#filename#sitemap-00002.xml.gz#',
        );
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapFreshenerFreshenFileMessage;
        // The new record should be equal
        expect(data0).toEqual({
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/widget-(?<ItemID>[0-9]+)',
        });
      }
    });

    it('repairDB - throws if cannot extract ItemID from even 1 URL', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .callsFake((input) => {
          console.info(inspect(input, true, 10, true));
        })
        .rejects()
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/widget-123456789-super-sale-50%25-off</loc>
  </url>
  <url>
    <loc>https://www.example.com/widget-abcdefg-super-sale-50%25-off</loc>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        });

      const items: ISitemapFreshenerStartMessage[] = [
        {
          operation: 'start',
          type: 'widget',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/widget-(?<ItemID>[0-9]+)',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await expect(async () =>
        handler(
          {
            Records: records,
          },
          {
            awsRequestId: 'local-testing',
          } as lambda.Context,
        ),
      ).rejects.toThrowError(
        '`https://www.example.com/widget-abcdefg-super-sale-50%25-off` does not match `itemIDRegex`',
      );

      expect(kinesisClient.calls().length).toBe(0);
      expect(s3Client.calls().length).toBe(1);
    });
  });

  describe('operation: freshenFile', () => {
    it('normal invoke', async () => {
      theConfig.nonDryRunAllowed = true;
      kinesisClient.onAnyCommand().rejects();
      s3Client
        .onAnyCommand()
        .rejects()
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NotFound({ $metadata: { httpStatusCode: 404 }, message: 'NotFound' }))
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({})
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join('non-default-path/', 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({})
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join('non-default-path/', 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .resolves({});

      const items: ISitemapFreshenerFreshenFileMessage[] = [
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
        },
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
        },
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00003.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(0);

      expect(s3Client.calls().length).toBe(5);

      // Validate that the FileRecord has status `written`
      const fileRecords = await FileRecord.loadType(dbManager, { Type: 'widget' });
      expect(fileRecords.length).toBe(3);
      for (const fileRecord of fileRecords) {
        expect(fileRecord).toBeInstanceOf(FileRecord);
        expect(fileRecord.FileStatus).toBe('written');

        // Validate that the ItemRecord's all have ItemStatus `written`
        const itemRecords = await ItemRecord.loadFile(dbManager, {
          FileName: fileRecord.FileName,
          Type: fileRecord.Type,
        });

        if (fileRecord.FileName === 'sitemap-00003.xml.gz') {
          continue;
        }

        expect(itemRecords.length).toBeGreaterThan(0);
        for (const itemRecord of itemRecords) {
          expect(itemRecord).toBeInstanceOf(ItemRecord);
          expect(itemRecord.ItemStatus).toMatch(/written|removed/);
        }
      }

      //
      // Fetch the sitemap from S3 and confirm it has 4 items
      //
      {
        const s3SitemapPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: s3SitemapPutCommand.input.Key,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/widget/',
          filenameRoot: 'sitemap-00001',
          compress: true,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        // 1 `toremove` item is removed from original 4
        // Note: the item owned by another file is not removed because `repairDB` is not set
        expect(sitemap.count).toBe(4);
      }

      {
        const s3SitemapPutCommand = s3Client.call(3).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: s3SitemapPutCommand.input.Key,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'non-default-path/widget/',
          filenameRoot: 'sitemap-00002',
          compress: true,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(4);
      }
    }, 60000);

    it('s3 dry run', async () => {
      kinesisClient.onAnyCommand().rejects();
      s3Client
        .onAnyCommand()
        .rejects()
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        });

      const items: ISitemapFreshenerFreshenFileMessage[] = [
        {
          operation: 'freshenFile',
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
        },
        {
          operation: 'freshenFile',
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(0);

      expect(s3Client.calls().length).toBe(2);
    });

    it('repairDB', async () => {
      theConfig.nonDryRunAllowed = true;
      kinesisClient.onAnyCommand().rejects();
      s3Client
        .onAnyCommand()
        .callsFake((input) => {
          console.info(inspect(input, true, 10, true));
        })
        .rejects()
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/item-10001-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        })

        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/item-10002-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }))
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NotFound({ $metadata: { httpStatusCode: 404 }, message: 'NotFound' }))
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({})
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join('non-default-path/', 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({});

      const items: ISitemapFreshenerFreshenFileMessage[] = [
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00003.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(0);

      expect(s3Client.calls().length).toBe(8);

      // Validate that the FileRecord has status `written`
      const fileRecords = await FileRecord.loadType(dbManager, { Type: 'widget' });
      expect(fileRecords.length).toBe(3);
      for (const fileRecord of fileRecords) {
        expect(fileRecord).toBeInstanceOf(FileRecord);
        expect(fileRecord.FileStatus).toMatch(/^written|empty$/);

        // Validate that the ItemRecord's all have ItemStatus `written`
        const itemRecords = await ItemRecord.loadFile(
          dbManager,
          {
            FileName: fileRecord.FileName,
            Type: fileRecord.Type,
          },
          true,
        );

        if (fileRecord.FileName !== 'sitemap-00003.xml.gz') {
          const newRecords = itemRecords.filter((value) => {
            return value.ItemID === '10002' || value.ItemID === '10001';
          });
          expect(newRecords.length).toBe(1);
          expect(newRecords[0].SitemapItem).toBeDefined();
          expect(newRecords[0].SitemapItem.url).toContain('super-sale-50%25-off');

          expect(itemRecords.length).toBeGreaterThan(0);
          for (const itemRecord of itemRecords) {
            expect(itemRecord).toBeInstanceOf(ItemRecord);
            expect(itemRecord.ItemStatus).toMatch(/written|removed/);
          }
        }
      }

      //
      // Fetch the sitemap from S3 and confirm it has 4 items
      //
      {
        const s3SitemapPutCommand = s3Client.call(2).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: s3SitemapPutCommand.input.Key,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/widget/',
          filenameRoot: 'sitemap-00001',
          compress: true,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        // 1 item added from existing XML, 3 items added from DB
        expect(sitemap.count).toBe(4);
      }

      {
        const s3SitemapPutCommand = s3Client.call(5).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: s3SitemapPutCommand.input.Key,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'non-default-path/widget/',
          filenameRoot: 'sitemap-00002',
          compress: true,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        // 1 item added from existing XML, 4 items added from DB
        expect(sitemap.count).toBe(5);
      }
    }, 60000);

    it('repairDB - items present in wrong S3 files are removed', async () => {
      theConfig.nonDryRunAllowed = true;
      kinesisClient.onAnyCommand().rejects();
      s3Client
        .onAnyCommand()
        .callsFake((input) => {
          console.info(inspect(input, true, 10, true));
        })
        .rejects()
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/item-10001-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>https://www.example.com/item-00021</loc>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/item-10002-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
  <url>
  <loc>https://www.example.com/item-00011</loc>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }))
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NotFound({ $metadata: { httpStatusCode: 404 }, message: 'NotFound' }))
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({})
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join('non-default-path/', 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({});

      const items: ISitemapFreshenerFreshenFileMessage[] = [
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
        {
          operation: 'freshenFile',
          dryRun: false,
          dryRunDB: false,
          type: 'widget',
          filename: 'sitemap-00003.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(0);

      expect(s3Client.calls().length).toBe(8);

      // Check that per-item record and per-file record are the same
      {
        const itemInTwoItemRecordByFile = (
          await ItemRecord.loadFile(dbManager, {
            FileName: 'sitemap-00001.xml.gz',
            Type: 'widget',
          })
        ).filter((value) => {
          return value.ItemID === '00021';
        });
        expect(itemInTwoItemRecordByFile.length).toBe(1);
        expect(itemInTwoItemRecordByFile[0].ItemID).toBe('00021');
        expect(itemInTwoItemRecordByFile[0].FileName).toBe('sitemap-00001.xml.gz');
        expect(itemInTwoItemRecordByFile[0].ItemStatus).toBe('removed');

        const itemInTwoItemRecordByItem = await ItemRecord.loadOne(dbManager, {
          Type: 'widget',
          ItemID: '00021',
        });
        expect(itemInTwoItemRecordByItem).toBeDefined();
        // This item should still belong to the right file
        expect(itemInTwoItemRecordByItem.FileName).toBe('sitemap-00002.xml.gz');
        expect(itemInTwoItemRecordByItem.ItemStatus).toBe('written');
      }

      {
        const itemInTwoItemRecordByFile = (
          await ItemRecord.loadFile(dbManager, {
            FileName: 'sitemap-00002.xml.gz',
            Type: 'widget',
          })
        ).filter((value) => {
          return value.ItemID === '00011';
        });
        expect(itemInTwoItemRecordByFile.length).toBe(1);
        expect(itemInTwoItemRecordByFile[0].ItemID).toBe('00011');
        expect(itemInTwoItemRecordByFile[0].FileName).toBe('sitemap-00002.xml.gz');
        expect(itemInTwoItemRecordByFile[0].ItemStatus).toBe('removed');

        const itemInTwoItemRecordByItem = await ItemRecord.loadOne(dbManager, {
          Type: 'widget',
          ItemID: '00011',
        });
        expect(itemInTwoItemRecordByItem).toBeDefined();
        // This item should still belong to the right file
        expect(itemInTwoItemRecordByItem.FileName).toBe('sitemap-00001.xml.gz');
        // will be `written` because the other record set the status when that file was processed
        expect(itemInTwoItemRecordByItem.ItemStatus).toBe('removed');
      }

      // Validate that the FileRecord has status `written`
      const fileRecords = await FileRecord.loadType(dbManager, { Type: 'widget' });
      expect(fileRecords.length).toBe(3);
      for (const fileRecord of fileRecords) {
        expect(fileRecord).toBeInstanceOf(FileRecord);
        expect(fileRecord.FileStatus).toMatch(/^written|empty$/);

        // Validate that the ItemRecord's all have ItemStatus `written`
        const itemRecords = await ItemRecord.loadFile(
          dbManager,
          {
            FileName: fileRecord.FileName,
            Type: fileRecord.Type,
          },
          true,
        );

        if (fileRecord.FileName === 'sitemap-00003.xml.gz') {
          continue;
        }

        const newRecords = itemRecords.filter((value) => {
          return value.ItemID === '10002' || value.ItemID === '10001';
        });
        expect(newRecords.length).toBe(1);
        expect(newRecords[0].SitemapItem).toBeDefined();
        expect(newRecords[0].SitemapItem.url).toContain('super-sale-50%25-off');

        expect(itemRecords.length).toBeGreaterThan(0);
        for (const itemRecord of itemRecords) {
          expect(itemRecord).toBeInstanceOf(ItemRecord);
          expect(itemRecord.ItemStatus).toMatch(/written|removed/);
        }
      }

      //
      // Fetch the sitemap from S3 and confirm it has 4 items
      //
      {
        const s3SitemapPutCommand = s3Client.call(2).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: s3SitemapPutCommand.input.Key,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/widget/',
          filenameRoot: 'sitemap-00001',
          compress: true,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        // 1 item added from existing XML, 3 items added from DB
        expect(sitemap.count).toBe(4);
        const thisFileItem = items.filter((value) => value.url.includes('item-00012'));
        expect(thisFileItem.length).toBe(1);
        const otherFileItem = items.filter((value) => value.url.includes('item-00021'));
        expect(otherFileItem.length).toBe(0);
      }

      {
        const s3SitemapPutCommand = s3Client.call(5).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: s3SitemapPutCommand.input.Key,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'non-default-path/widget/',
          filenameRoot: 'sitemap-00002',
          compress: true,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        // 1 item added from existing XML, 4 items added from DB
        expect(sitemap.count).toBe(5);
        const thisFileItem = items.filter((value) => value.url.includes('item-00021'));
        expect(thisFileItem.length).toBe(1);
        const otherFileItem = items.filter((value) => value.url.includes('item-00011'));
        expect(otherFileItem.length).toBe(0);
      }
    }, 60000);

    it('repairDB dry run', async () => {
      kinesisClient.onAnyCommand().rejects();
      s3Client
        .onAnyCommand()
        .callsFake((input) => {
          console.info(inspect(input, true, 10, true));
        })
        .rejects()
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/item-10001-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        })

        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          Body: Readable.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/item-10002-super-sale-50%25-off</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>`,
          ).pipe(createGzip()) as unknown as StreamingBlobPayloadOutputTypes,
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .resolves({
          ContentLength: 260,
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }))
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00003.xml.gz'),
          },
          false,
        )
        .rejects(new s3.NotFound({ $metadata: { httpStatusCode: 404 }, message: 'NotFound' }))
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join(theConfig.s3Directory, 'widget', 'sitemap-00001.xml.gz'),
          },
          false,
        )
        .rejects({})
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: path.posix.join('non-default-path/', 'widget', 'sitemap-00002.xml.gz'),
          },
          false,
        )
        .rejects({});

      const items: ISitemapFreshenerFreshenFileMessage[] = [
        {
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00001.xml.gz',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
        {
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00002.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
        {
          operation: 'freshenFile',
          dryRun: true,
          dryRunDB: true,
          type: 'widget',
          filename: 'sitemap-00003.xml.gz',
          s3DirectoryOverride: 'non-default-path/',
          repairDB: true,
          itemIDRegex: '^https:\\/\\/www\\.example\\.com\\/item-(?<ItemID>[0-9]+)',
        },
      ];

      const records: lambda.KinesisStreamRecord[] = [];
      for (const item of items) {
        records.push({
          awsRegion: 'us-east-1',
          eventID: 'shardId-00000000001:123456',
          eventName: 'cat',
          eventSource: 'dog',
          eventSourceARN: 'arn:aws:something',
          eventVersion: 'v1',
          invokeIdentityArn: 'arn:aws:something',
          kinesis: {
            data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(kinesisClient.calls().length).toBe(0);

      expect(s3Client.calls().length).toBe(6);

      // Validate that the FileRecord still has status `dirty`
      const fileRecords = await FileRecord.loadType(dbManager, { Type: 'widget' });
      expect(fileRecords.length).toBe(3);
      expect(fileRecords[0].FileStatus).toBe('dirty');
      expect(fileRecords[1].FileStatus).toBe('dirty');
      for (const fileRecord of fileRecords) {
        expect(fileRecord).toBeInstanceOf(FileRecord);

        // Validate that the ItemRecord's all have ItemStatus `written`
        const itemRecords = await ItemRecord.loadFile(
          dbManager,
          {
            FileName: fileRecord.FileName,
            Type: fileRecord.Type,
          },
          true,
        );

        if (fileRecord.FileName !== 'sitemap-00003.xml.gz') {
          const newRecords = itemRecords.filter((value) => {
            return value.ItemID === '10002' || value.ItemID === '10001';
          });
          expect(newRecords.length).toBe(0);

          expect(itemRecords.length).toBeGreaterThan(0);
          const seenStatuses: { [status: string]: true } = {};
          for (const itemRecord of itemRecords) {
            expect(itemRecord).toBeInstanceOf(ItemRecord);
            seenStatuses[itemRecord.ItemStatus] = true;
          }

          if (fileRecord.FileName === 'sitemap-00001.xml.gz') {
            expect(Object.keys(seenStatuses)).toContain('written');
            expect(Object.keys(seenStatuses)).toContain('towrite');
            expect(Object.keys(seenStatuses)).toContain('toremove');
          } else {
            expect(Object.keys(seenStatuses)).toContain('written');
          }
        }
      }
    });
  });
});
