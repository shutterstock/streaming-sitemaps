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
  compressSitemapFiles: false,
  emitMetrics: false,
  logSilent: true,
  localDirectory: '/tmp/sitemaps',
  s3Directory: 'sitemaps/',
  siteBaseSitemapPath: 'sitemaps',
  sitemapFileNamingScheme: 'index',
  tableName: 'sitemaps',
  storeItemStateInDynamoDB: true,
  itemsPerSitemapLimit: 500,
  kinesisIndexWriterStreamName: 'sitemap-index-stream',
  dynamoDBConcurrentReads: 2,
  dynamoDBPrefetchMaxUnread: 4,
  dynamoDBConcurrentWrites: 20,
  s3ConcurrentWrites: 4,
  incomingCompactVersion: 0,
  throwOnCompactVersion: 0,
  kinesisSelfStreamName: 'sitemap-stream',
  infixDirs: [],
};
const origConfig = { ...theConfig };
Object.defineProperty(Config, 'instance', {
  configurable: false,
  enumerable: false,
  get: jest.fn((): IConfig => {
    return theConfig;
  }),
});
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as s3 from '@aws-sdk/client-s3';
import * as kinesis from '@aws-sdk/client-kinesis';
import {
  createItemStatePreFetcher,
  DecodedPlusPayload,
  groupMessagesByType,
  handler,
  overrideDBManager,
} from './index';
import type * as lambda from 'aws-lambda';
import type { ISitemapWriterItem } from '@shutterstock/sitemaps-models-lib';
import { Readable } from 'stream';
import zlib from 'zlib';
import { promisify } from 'util';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import { ShardStateRecord, DBManager, FileRecord, ItemRecord } from '@shutterstock/sitemaps-db-lib';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';

const deflateAsync = promisify(zlib.deflate);

describe('Sitemap Writer index.ts', () => {
  let s3Client: AwsClientStub<s3.S3Client>;
  let kinesisClient: AwsClientStub<kinesis.KinesisClient>;
  const siteBaseURL = 'https://www.example.com';
  const s3SitemapsBucketName = 'doc-example-bucket';
  let sitemapExtension: string;
  let dynamoClient: DynamoDBClient;
  let dbManager: DBManager;
  const shardId = 1;
  const shardIdPadded = shardId.toString().padStart(3, '0');

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

  beforeEach(() => {
    // Reset the config that's visible to the handler back to defaults
    Object.keys(origConfig).map((key) => {
      // @ts-expect-error we know the fields match
      theConfig[key] = origConfig[key];
    });
    s3Client = mockClient(s3.S3Client);
    kinesisClient = mockClient(kinesis.KinesisClient);
    sitemapExtension = theConfig.compressSitemapFiles ? '.xml.gz' : '.xml';
    overrideDBManager({ dbManager, dynamoClient });
  });

  afterEach(() => {
    // Reset the uuid mock so we get the same uuid on second call
    //(v4 as jest.MockedFunction<typeof v4>).mockReset();
  });

  describe('lambda handler', () => {
    it('empty state initialization', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path3' },
          customId: '3',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path4' },
          customId: '4',
          type: 'image',
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
            data: (await deflateAsync(Buffer.from(JSON.stringify(item), 'utf-8'))).toString(
              'base64',
            ),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      // Save one of the items in the DB so it gets detected as a duplicate
      const duplicateRecord = new ItemRecord({
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
        ItemID: '3',
        SitemapItem: {
          url: 'https://www.example.com/',
        },
        Type: 'image',
        ItemStatus: 'written',
      });
      await duplicateRecord.save(dbManager);

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(1);

      const s3SitemapPutCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
      expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
      const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);
      expect(s3SitemapPutCommand.input.Key).toBe(
        `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
      );

      //
      // Check ShardState in DynamoDB
      //
      const shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(shardState.TotalItemCount).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      const fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe(theConfig.storeItemStateInDynamoDB ? 'dirty' : 'written');
      expect(fileState.CountWritten).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Fetch the sitemap from S3 and confirm it has 4 items
      //
      s3Client
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
        });
      const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        // FIXME: the sub-folder for the sitemap needs to be handled automagically
        s3Directory: 'sitemaps/image/',
        filenameRoot: `image-${shardIdPadded}-00001`,
        compress: theConfig.compressSitemapFiles,
        siteBaseURL,
      });
      expect(sitemapExisting).toBe(true);
      expect(sitemap.count).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
    });

    it('existing index, unfull last sitemap', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00003${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path3' },
          customId: '3',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path4' },
          customId: '4',
          type: 'image',
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

      expect(s3Client.calls().length).toBe(1);

      const sitemap1Request = s3Client.call(0).args[0] as s3.PutObjectCommand;
      expect(sitemap1Request).toBeInstanceOf(s3.PutObjectCommand);
      expect(sitemap1Request.input.Key).toBe(
        `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
      );
      const s3SitemapStream = Readable.from(sitemap1Request.input.Body as string);

      //
      // Check ShardState in DynamoDB
      //
      let shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(4);
      expect(shardState.TotalItemCount).toBe(4);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      let fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(4);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // NOTE: We cannot read and validate the s3 index/sitemap in this test
      // because the read is destructive on the s3 body streams.
      // So we just invoke the handler a second time and check the final results
      //

      s3Client
        .reset()
        .onAnyCommand()
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({ Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes })
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      // Read one of the DB items so we can check it's update time later to make
      // sure it's not written again
      const itemStateBefore2ndFileWrite = await ItemRecord.loadOne(dbManager, {
        Type: 'image',
        ItemID: '1',
      });
      expect(itemStateBefore2ndFileWrite).toBeDefined();
      expect(itemStateBefore2ndFileWrite.FileName).toBe('image-001-00001.xml');
      expect(itemStateBefore2ndFileWrite.ItemStatus).toBe('written');
      expect(itemStateBefore2ndFileWrite.TimeLastWrittenISO).toBeDefined();

      //
      // Call the handler again with more items
      //
      const items2: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some15/photo/path5' },
          customId: '5',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some15/photo/path6' },
          customId: '6',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some16/photo/path7' },
          customId: '7',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some16/photo/path8' },
          customId: '8',
          type: 'image',
        },
      ];

      const records2: lambda.KinesisStreamRecord[] = [];
      for (const item of items2) {
        records2.push({
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
          Records: records2,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(2);

      const sitemap1Request2 = s3Client.call(1).args[0] as s3.PutObjectCommand;
      expect(sitemap1Request2).toBeInstanceOf(s3.PutObjectCommand);
      expect(sitemap1Request2.input.Key).toBe(
        `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
      );
      const s3SitemapStream2 = Readable.from(sitemap1Request2.input.Body as string);

      //
      // Check ShardState in DynamoDB
      //
      shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(8);
      expect(shardState.TotalItemCount).toBe(8);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(8);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      // Make sure the items already in the file are not rewritten to the DB
      const itemStateAfter2ndFileWrite = await ItemRecord.loadOne(dbManager, {
        Type: 'image',
        ItemID: '1',
      });
      expect(itemStateAfter2ndFileWrite).toBeDefined();
      expect(itemStateAfter2ndFileWrite.FileName).toBe('image-001-00001.xml');
      expect(itemStateAfter2ndFileWrite.ItemStatus).toBe('written');
      expect(itemStateAfter2ndFileWrite.TimeLastWrittenISO).toBeDefined();
      expect(itemStateAfter2ndFileWrite.TimeLastWrittenISO).toBe(
        itemStateBefore2ndFileWrite.TimeLastWrittenISO,
      );

      //
      // Fetch the sitemap from S3 and confirm it has 8 items
      //
      s3Client
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapStream2 as unknown as StreamingBlobPayloadOutputTypes,
        });
      const { sitemap: sitemap2, existing: sitemapExisting2 } = await SitemapFileWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        // FIXME: the sub-folder for the sitemap needs to be handled automagically
        s3Directory: 'sitemaps/image/',
        filenameRoot: `image-${shardIdPadded}-00001`,
        compress: theConfig.compressSitemapFiles,
        siteBaseURL,
      });
      expect(sitemapExisting2).toBe(true);
      expect(sitemap2.count).toBe(8);
    });

    //
    // This typically happens when a new shard is created and
    // the first payload it gets is entirely duplicates
    //
    it('no items written to sitemap', async () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
        },
      ];

      //
      // Save our one record to the DB so it's eliminated as a duplicate
      //
      const itemRecord = new ItemRecord({
        FileName: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        ItemID: items[0].customId,
        Type: items[0].type as string,
        SitemapItem: items[0].sitemapItem!,
      });
      await itemRecord.save(dbManager);

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

      expect(s3Client.calls().length).toBe(0);

      //
      // Check ShardState in DynamoDB
      //
      let shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      // 2022-03-16 - After delay loading of sitemap, the shardState is not touched
      // when nothing is written
      expect(shardState).toBeUndefined();
      // expect(shardState.FileCount).toBe(1);
      // expect(shardState.CurrentFileItemCount).toBe(0);
      // expect(shardState.TotalItemCount).toBe(0);
      // expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      let fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      // 2022-03-16 - After delay loading of sitemap, the shardState is not touched
      // when nothing is written
      expect(fileState).toBeUndefined();
      // expect(fileState.FileStatus).toBe('empty');
      // expect(fileState.CountWritten).toBe(0);
      // expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Call the handler again with more items
      //
      const items2: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some15/photo/path5' },
          customId: '5',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some15/photo/path6' },
          customId: '6',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some16/photo/path7' },
          customId: '7',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some16/photo/path8' },
          customId: '8',
          type: 'image',
        },
      ];

      const records2: lambda.KinesisStreamRecord[] = [];
      for (const item of items2) {
        records2.push({
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
          Records: records2,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(1);

      const sitemap1Request2 = s3Client.call(0).args[0] as s3.PutObjectCommand;
      expect(sitemap1Request2).toBeInstanceOf(s3.PutObjectCommand);
      expect(sitemap1Request2.input.Key).toBe(
        `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
      );
      const s3SitemapStream2 = Readable.from(sitemap1Request2.input.Body as string);

      //
      // Check ShardState in DynamoDB
      //
      shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(4);
      expect(shardState.TotalItemCount).toBe(4);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(4);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Fetch the sitemap from S3 and confirm it has 4 items
      //
      s3Client
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapStream2 as unknown as StreamingBlobPayloadOutputTypes,
        });
      const { sitemap: sitemap2, existing: sitemapExisting2 } = await SitemapFileWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        // FIXME: the sub-folder for the sitemap needs to be handled automagically
        s3Directory: 'sitemaps/image/',
        filenameRoot: `image-${shardIdPadded}-00001`,
        compress: theConfig.compressSitemapFiles,
        siteBaseURL,
      });
      expect(sitemapExisting2).toBe(true);
      expect(sitemap2.count).toBe(4);
    });

    it('handles compaction - writing uniques back to stream, dropping duplicates', async () => {
      (theConfig as Writeable<IConfig>).incomingCompactVersion = 2;
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client.onAnyCommand().rejects();

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
          // Note: Not setting compactVersion here
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
          compactVersion: 1,
        },
        // {
        //   sitemapItem: { url: '/some13/photo/path2' },
        //   customId: '2',
        //   type: 'image',
        //   compactVersion: 2,
        // },
      ];

      //
      // Save our one record to the DB so it's eliminated as a duplicate
      //
      const itemRecord = new ItemRecord({
        FileName: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        ItemID: items[0].customId,
        Type: items[0].type as string,
        SitemapItem: items[0].sitemapItem!,
      });
      await itemRecord.save(dbManager);

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
            partitionKey: `${item.customId}`,
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

      expect(s3Client.calls().length).toBe(0);
      expect(kinesisClient.calls().length).toBe(1);

      //
      // Check that one record was compacted back to the stream
      //
      {
        const compactionRequest = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
        expect(compactionRequest).toBeInstanceOf(kinesis.PutRecordsCommand);
        expect(compactionRequest.input.Records).toBeDefined();
        expect(compactionRequest.input.Records?.length).toBe(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = compactionRequest.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe('2');
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapWriterItem;
        // The new record should be equal except the compactVersion is updated
        expect(data0).toEqual({ ...items[1], compactVersion: 2 });
      }

      //
      // Check ShardState in DynamoDB
      //
      let shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeUndefined();

      //
      // Check FileState in DynamoDB
      //
      let fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeUndefined();

      //
      // Call the handler again with more items
      //
      const items2: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some15/photo/path5' },
          customId: '5',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some15/photo/path6' },
          customId: '6',
          type: 'image',
          compactVersion: 2,
        },
        {
          sitemapItem: { url: '/some16/photo/path7' },
          customId: '7',
          type: 'image',
          compactVersion: 2,
        },
        {
          sitemapItem: { url: '/some16/photo/path8' },
          customId: '8',
          type: 'image',
          compactVersion: 2,
        },
      ];

      const records2: lambda.KinesisStreamRecord[] = [];
      for (const item of items2) {
        records2.push({
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
            partitionKey: `${item.customId}`,
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      kinesisClient.resetHistory();
      await handler(
        {
          Records: records2,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(1);

      const sitemap1Request2 = s3Client.call(0).args[0] as s3.PutObjectCommand;
      expect(sitemap1Request2).toBeInstanceOf(s3.PutObjectCommand);
      expect(sitemap1Request2.input.Key).toBe(
        `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
      );
      const s3SitemapStream2 = Readable.from(sitemap1Request2.input.Body as string);

      //
      // Check ShardState in DynamoDB
      //
      shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(3);
      expect(shardState.TotalItemCount).toBe(3);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(3);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Fetch the sitemap from S3 and confirm it has 3 items
      //
      s3Client
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapStream2 as unknown as StreamingBlobPayloadOutputTypes,
        });
      const { sitemap: sitemap2, existing: sitemapExisting2 } = await SitemapFileWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        // FIXME: the sub-folder for the sitemap needs to be handled automagically
        s3Directory: 'sitemaps/image/',
        filenameRoot: `image-${shardIdPadded}-00001`,
        compress: theConfig.compressSitemapFiles,
        siteBaseURL,
      });
      expect(sitemapExisting2).toBe(true);
      expect(sitemap2.count).toBe(3);

      // Confirm an item was written back to kinesis
      {
        // The index-writer message is the first call
        expect(kinesisClient.calls().length).toBe(2);
        const compactionRequest = kinesisClient.call(1).args[0] as kinesis.PutRecordsCommand;
        expect(compactionRequest).toBeInstanceOf(kinesis.PutRecordsCommand);
        expect(compactionRequest.input.Records).toBeDefined();
        expect(compactionRequest.input.Records?.length).toBe(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = compactionRequest.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe('5');
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapWriterItem;
        // The new record should be equal except the compactVersion is updated
        expect(data0).toEqual({ ...items2[0], compactVersion: 2 });
      }
    });

    it('throws on unexpected compaction version record', async () => {
      (theConfig as Writeable<IConfig>).incomingCompactVersion = 2;
      (theConfig as Writeable<IConfig>).throwOnCompactVersion = 2;
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client.onAnyCommand().rejects();

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
          // Note: Not setting compactVersion here
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
          compactVersion: 1,
        },
        // {
        //   sitemapItem: { url: '/some13/photo/path2' },
        //   customId: '2',
        //   type: 'image',
        //   compactVersion: 2,
        // },
      ];

      //
      // Save our one record to the DB so it's eliminated as a duplicate
      //
      const itemRecord = new ItemRecord({
        FileName: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        ItemID: items[0].customId,
        Type: items[0].type as string,
        SitemapItem: items[0].sitemapItem!,
      });
      await itemRecord.save(dbManager);

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
            partitionKey: `${item.customId}`,
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

      expect(s3Client.calls().length).toBe(0);
      expect(kinesisClient.calls().length).toBe(1);

      //
      // Check that one record was compacted back to the stream
      //
      {
        const compactionRequest = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
        expect(compactionRequest).toBeInstanceOf(kinesis.PutRecordsCommand);
        expect(compactionRequest.input.Records).toBeDefined();
        expect(compactionRequest.input.Records?.length).toBe(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const record = compactionRequest.input.Records![0];
        expect(record).toBeDefined();
        expect(record.PartitionKey).toBe('2');
        expect(record.Data).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dataBuffer0 = Buffer.from(record.Data!);
        const dataStr0 = dataBuffer0.toString('utf-8');
        const data0 = JSON.parse(dataStr0) as ISitemapWriterItem;
        // The new record should be equal except the compactVersion is updated
        expect(data0).toEqual({ ...items[1], compactVersion: 2 });
      }

      //
      // Check ShardState in DynamoDB
      //
      const shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeUndefined();

      //
      // Check FileState in DynamoDB
      //
      const fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeUndefined();

      //
      // Call the handler again with more items
      //
      const items2: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some15/photo/path5' },
          customId: '5',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some15/photo/path6' },
          customId: '6',
          type: 'image',
          compactVersion: 2,
        },
        {
          sitemapItem: { url: '/some16/photo/path7' },
          customId: '7',
          type: 'image',
          compactVersion: 2,
        },
        {
          sitemapItem: { url: '/some16/photo/path8' },
          customId: '8',
          type: 'image',
          compactVersion: 2,
        },
      ];

      const records2: lambda.KinesisStreamRecord[] = [];
      for (const item of items2) {
        records2.push({
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
            partitionKey: `${item.customId}`,
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      kinesisClient.resetHistory();
      await expect(async () =>
        handler(
          {
            Records: records2,
          },
          {
            awsRequestId: 'local-testing',
          } as lambda.Context,
        ),
      ).rejects.toThrow('Throwing due to compactVersion encountered: 2');

      // Sitemap should not be retrieved or written
      expect(s3Client.calls().length).toBe(0);

      // No writes to kinesis since we throw before processing records
      expect(kinesisClient.calls().length).toBe(0);
    });

    // Shows that multiple records of the same type end up in a single file
    // if less than the configured sitemap item limit of that type
    it('more than itemsPerSitemapLimit records spill over into a 2nd sitemap file', async () => {
      const itemCount = Math.floor(theConfig.itemsPerSitemapLimit * 1.1);
      const items: ISitemapWriterItem[] = [];
      for (let i = 0; i < itemCount; i++) {
        const item: ISitemapWriterItem = {
          sitemapItem: { url: `${siteBaseURL}/some/image/path/${i}` },
          customId: `${i}`,
          type: 'image',
        };
        items.push(item);
      }

      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap1 file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolves({})
        // Sitemap2 file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00002${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

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

      expect(s3Client.calls().length).toBe(2);

      const s3SitemapStream = Readable.from(
        (s3Client.call(0).args[0] as s3.PutObjectCommand).input.Body as string,
      );
      const s3SitemapStream2 = Readable.from(
        (s3Client.call(1).args[0] as s3.PutObjectCommand).input.Body as string,
      );

      //
      // Check ShardState in DynamoDB
      //
      const shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(2);
      expect(shardState.CurrentFileItemCount).toBe(itemCount - theConfig.itemsPerSitemapLimit);
      expect(shardState.TotalItemCount).toBe(itemCount);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00002${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      let fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(theConfig.itemsPerSitemapLimit);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00002${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(itemCount - theConfig.itemsPerSitemapLimit);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00002${sitemapExtension}`);

      //
      // Fetch the sitemap from S3 and confirm it has correct count of items
      //
      s3Client
        .reset()
        .onAnyCommand()
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
        })
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00002${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapStream2 as unknown as StreamingBlobPayloadOutputTypes,
        });
      const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        // FIXME: the sub-folder for the sitemap needs to be handled automagically
        s3Directory: 'sitemaps/image/',
        filenameRoot: `image-${shardIdPadded}-00001`,
        compress: theConfig.compressSitemapFiles,
        siteBaseURL,
      });
      expect(sitemapExisting).toBe(true);
      expect(sitemap.count).toBe(theConfig.itemsPerSitemapLimit);

      const { sitemap: sitemap2, existing: sitemapExisting2 } = await SitemapFileWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        // FIXME: the sub-folder for the sitemap needs to be handled automagically
        s3Directory: 'sitemaps/image/',
        filenameRoot: `image-${shardIdPadded}-00002`,
        compress: theConfig.compressSitemapFiles,
        siteBaseURL,
      });
      expect(sitemapExisting2).toBe(true);
      expect(sitemap2.count).toBe(itemCount - theConfig.itemsPerSitemapLimit);
    }, 120000);

    // Shows that multiple types of records
    // get split into the the right number of files
    it('mixed types with arbitrary names, get split into distinct sitemap files', async () => {
      const types = ['type1', 'type2'];
      const typesCount = types.length;

      // Reject any command we don't configure
      s3Client.onAnyCommand().rejects();

      kinesisClient.on(kinesis.PutRecordsCommand).resolves({ Records: [] });

      const file1Count = theConfig.itemsPerSitemapLimit;
      const file2Count = Math.floor(theConfig.itemsPerSitemapLimit * 0.1);

      const itemCount = file1Count + file2Count + 2;
      const fileItems: { [key: string]: ISitemapWriterItem[] } = {};
      const records: { [key: string]: lambda.KinesisStreamRecord[] } = {};

      for (const type of types) {
        fileItems[type] = [];
        records[type] = [];

        for (let i = 0; i < itemCount; i++) {
          let itemID = i + 1;

          // Write a dupe from the first file
          if (i === itemCount - 2) itemID = 1;
          // Write a dupe from the second file
          if (i === itemCount - 1) itemID = file1Count + 1;

          const item: ISitemapWriterItem = {
            sitemapItem: { url: `/some/${type}/path/${itemID}` },
            customId: `${itemID}`,
            type,
          };
          fileItems[type].push(item);
        }

        s3Client
          // Sitemap1 file upload
          .on(
            s3.PutObjectCommand,
            {
              Bucket: s3SitemapsBucketName,
              Key: `sitemaps/${type}/${type}-${shardIdPadded}-00001${sitemapExtension}`,
            },
            false,
          )
          .resolves({})
          // Sitemap2 file upload
          .on(
            s3.PutObjectCommand,
            {
              Bucket: s3SitemapsBucketName,
              Key: `sitemaps/${type}/${type}-${shardIdPadded}-00002${sitemapExtension}`,
            },
            false,
          )
          .resolves({});

        for (const item of fileItems[type]) {
          records[type].push({
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

        // Save one of the items in the DB so it gets detected as a duplicate
        // The state of this item should change to `towrite` when detected as a dupe
        const duplicateRecord = new ItemRecord({
          FileName: `${type}-${shardIdPadded}-00002${sitemapExtension}`,
          ItemID: `${file1Count + 2}`,
          SitemapItem: {
            url: 'https://www.example.com/',
          },
          Type: type,
          ItemStatus: 'written',
        });
        await duplicateRecord.save(dbManager);
      }

      const consolidatedRecords: lambda.KinesisStreamRecord[] = [];
      for (const type of Object.keys(records)) {
        Array.prototype.push.apply(consolidatedRecords, records[type]);
      }

      await handler(
        {
          Records: consolidatedRecords,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      const s3CallsPerType = 2;
      let s3CallsOffset = 0;
      const s3CallsFromHandler = s3Client.calls();
      expect(s3CallsFromHandler.length).toBe(s3CallsPerType * typesCount);

      for (const type of types) {
        const s3SitemapStream = Readable.from(
          (s3CallsFromHandler[s3CallsOffset + 0].args[0] as s3.PutObjectCommand).input
            .Body as string,
        );
        const s3SitemapStream2 = Readable.from(
          (s3CallsFromHandler[s3CallsOffset + 1].args[0] as s3.PutObjectCommand).input
            .Body as string,
        );

        //
        // Check ShardState in DynamoDB
        //
        const shardState = await ShardStateRecord.loadOne(dbManager, {
          Type: type,
          ShardId: 1,
        });
        expect(shardState).toBeDefined();
        expect(shardState.FileCount).toBe(2);
        expect(shardState.CurrentFileItemCount).toBe(
          theConfig.storeItemStateInDynamoDB ? file2Count - 1 : file2Count,
        );
        expect(shardState.TotalItemCount).toBe(
          theConfig.storeItemStateInDynamoDB
            ? file1Count + file2Count - 1
            : file1Count + file2Count,
        );
        expect(shardState.CurrentFileName).toBe(
          `${type}-${shardIdPadded}-00002${sitemapExtension}`,
        );

        //
        // Check FileState in DynamoDB
        //
        const fileState = await FileRecord.loadOne(dbManager, {
          Type: type,
          FileName: `${type}-${shardIdPadded}-00002${sitemapExtension}`,
        });
        expect(fileState).toBeDefined();
        // When storing item state in the DB we will mark this file as dirty
        // because one of it's items is already stored in the DB
        expect(fileState.FileStatus).toBe(theConfig.storeItemStateInDynamoDB ? 'dirty' : 'written');
        expect(fileState.CountWritten).toBe(
          theConfig.storeItemStateInDynamoDB ? file2Count - 1 : file2Count,
        );
        expect(fileState.FileName).toBe(`${type}-${shardIdPadded}-00002${sitemapExtension}`);

        //
        // Check a normally written item
        //
        if (theConfig.storeItemStateInDynamoDB) {
          let itemState = await ItemRecord.loadOne(
            dbManager,
            {
              ItemID: `${file1Count + file2Count}`,
              Type: type,
            },
            true,
          );
          expect(itemState).toBeDefined();
          expect(itemState.FileName).toBe(`${type}-${shardIdPadded}-00002${sitemapExtension}`);
          expect(itemState.ItemID).toBe(`${file1Count + file2Count}`);
          expect(itemState.ItemStatus).toBe('written');
          expect(itemState.Type).toBe(type);
          expect(itemState.SitemapItem).toBeDefined();
          expect(itemState.SitemapItem.url).toBe(`/some/${type}/path/${file1Count + file2Count}`);

          //
          // Check a dupe for the 1st file written at the end
          //
          itemState = await ItemRecord.loadOne(
            dbManager,
            {
              ItemID: '1',
              Type: type,
            },
            true,
          );
          expect(itemState).toBeDefined();
          expect(itemState.FileName).toBe(`${type}-${shardIdPadded}-00001${sitemapExtension}`);
          expect(itemState.ItemID).toBe('1');
          // When de-duping with Dynamo the in-file duplicate is weeded out
          expect(itemState.ItemStatus).toBe(
            theConfig.storeItemStateInDynamoDB ? 'written' : 'towrite',
          );
          expect(itemState.Type).toBe(type);
          expect(itemState.SitemapItem).toBeDefined();
          expect(itemState.SitemapItem.url).toBe(`/some/${type}/path/1`);

          //
          // Check a dupe for the 2nd file written at the end
          //
          itemState = await ItemRecord.loadOne(
            dbManager,
            {
              ItemID: `${file1Count + 1}`,
              Type: type,
            },
            true,
          );
          expect(itemState).toBeDefined();
          expect(itemState.FileName).toBe(`${type}-${shardIdPadded}-00002${sitemapExtension}`);
          expect(itemState.ItemID).toBe(`${file1Count + 1}`);
          // When de-duping with Dynamo the in-file duplicate is weeded out
          expect(itemState.ItemStatus).toBe(
            theConfig.storeItemStateInDynamoDB ? 'written' : 'towrite',
          );
          expect(itemState.Type).toBe(type);
          expect(itemState.SitemapItem).toBeDefined();
          expect(itemState.SitemapItem.url).toBe(`/some/${type}/path/${file1Count + 1}`);

          //
          // Check the ItemRecord that was written before calling the handler()
          //
          itemState = await ItemRecord.loadOne(
            dbManager,
            {
              ItemID: `${file1Count + 2}`,
              Type: type,
            },
            true,
          );
          expect(itemState).toBeDefined();
          expect(itemState.FileName).toBe(`${type}-${shardIdPadded}-00002${sitemapExtension}`);
          expect(itemState.ItemID).toBe(`${file1Count + 2}`);
          // This item should update it's state in the DB to be towrite
          expect(itemState.ItemStatus).toBe(
            theConfig.storeItemStateInDynamoDB ? 'towrite' : 'written',
          );
          expect(itemState.Type).toBe(type);
          expect(itemState.SitemapItem).toBeDefined();
          expect(itemState.SitemapItem.url).toBe(`/some/${type}/path/${file1Count + 2}`);
        }

        //
        // Fetch the sitemap from S3 and confirm it has correct count of items
        //
        s3Client
          .reset()
          .onAnyCommand()
          .rejects()
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/${type}/${type}-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          })
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/${type}/${type}-${shardIdPadded}-00002${sitemapExtension}`,
          })
          .resolves({
            Body: s3SitemapStream2 as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: `sitemaps/${type}/`,
          filenameRoot: `${type}-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(file1Count);

        const { sitemap: sitemap2, existing: sitemapExisting2 } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: `sitemaps/${type}/`,
          filenameRoot: `${type}-${shardIdPadded}-00002`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting2).toBe(true);
        expect(sitemap2.count).toBe(
          theConfig.storeItemStateInDynamoDB ? file2Count - 1 : file2Count,
        );

        s3CallsOffset += s3CallsPerType;
      }
    }, 240000);
  });

  describe('groupMessagesByType', () => {
    it('should work', () => {
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });

      const flatMetrics = new FlatCountMetrics();

      const itemCount = Math.floor(theConfig.itemsPerSitemapLimit * 1.1);
      const items: ISitemapWriterItem[] = [];
      for (let i = 0; i < itemCount; i++) {
        const item: ISitemapWriterItem = {
          sitemapItem: { url: `${siteBaseURL}/some/image/path/${i}` },
          customId: `${i}`,
          type: 'image',
        };
        items.push(item);
      }

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

      const payload = {
        window: {
          end: 'now',
          start: 'now',
        },
        eventSourceARN: 'arn',
        isFinalInvokeForWindow: false,
        isWindowTerminatedEarly: false,
        shardId: 'shard-1',
        Records: records,
      };

      const result = groupMessagesByType({ flatMetrics, payload, shardId: 1 });

      expect(result).toBeDefined();
      expect(result['image'].length).toBe(itemCount);
    });
  });

  describe('createItemStatePreFetcher', () => {
    it('should work', async () => {
      const itemCount = Math.floor(theConfig.itemsPerSitemapLimit * 1.1);
      const items: DecodedPlusPayload[] = [];
      for (let i = 0; i < itemCount; i++) {
        const item: DecodedPlusPayload = {
          // @ts-expect-error only need partitionKey
          payload: {
            partitionKey: '123',
          },
          sitemapWriterItem: {
            sitemapItem: { url: `${siteBaseURL}/some/image/path/${i}` },
            customId: `${i}`,
            type: 'image',
          },
        };
        items.push(item);
      }

      const flatMetricsTyped = new FlatCountMetrics();
      const prefetcher = createItemStatePreFetcher({
        items,
        type: 'image',
        flatMetricsTyped,
      });

      let aggregatedCount = 0;
      for await (const hydratedItemsBatch of prefetcher) {
        expect(hydratedItemsBatch).toBeDefined();
        expect(hydratedItemsBatch.error).toBeUndefined;
        expect(hydratedItemsBatch.items).toBeDefined();

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        aggregatedCount += hydratedItemsBatch!.items!.length;

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        for (const item of hydratedItemsBatch!.items!) {
          expect(item).toBeDefined();
          expect(item.item).toBeDefined();
          expect(item.itemState).not.toBeDefined();
        }
      }

      expect(aggregatedCount).toBe(itemCount);
    });

    it('should handle items in DB already', async () => {
      const itemCount = Math.floor(theConfig.itemsPerSitemapLimit * 1.1);
      let itemDuplicateCount = 0;
      const items: DecodedPlusPayload[] = [];
      for (let i = 0; i < itemCount; i++) {
        const item: DecodedPlusPayload = {
          // @ts-expect-error paritionKey is enough
          payload: {
            partitionKey: '123',
          },
          sitemapWriterItem: {
            sitemapItem: { url: `${siteBaseURL}/some/image/path/${i}` },
            customId: `${i}`,
            type: 'image',
          },
        };

        // Save half the items in the DB so they gets detected as a duplicate
        if (i % 2 === 0) {
          itemDuplicateCount += 1;
          const duplicateRecord = new ItemRecord({
            FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
            ItemID: `${i}`,
            SitemapItem: {
              url: `https://www.example.com/${i}`,
            },
            Type: 'image',
            ItemStatus: 'written',
          });
          await duplicateRecord.save(dbManager);
        }

        items.push(item);
      }

      const flatMetricsTyped = new FlatCountMetrics();
      const prefetcher = createItemStatePreFetcher({
        items,
        type: 'image',
        flatMetricsTyped,
      });

      let aggregatedCount = 0;
      let aggregatedDuplicateCount = 0;
      for await (const hydratedItemsBatch of prefetcher) {
        expect(hydratedItemsBatch).toBeDefined();
        expect(hydratedItemsBatch.error).toBeUndefined;
        expect(hydratedItemsBatch.items).toBeDefined();

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        aggregatedCount += hydratedItemsBatch!.items!.length;

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        for (const item of hydratedItemsBatch!.items!) {
          expect(item).toBeDefined();
          expect(item.item).toBeDefined();
          if (parseInt(item.item.sitemapWriterItem.customId, 10) % 2 === 0) {
            expect(item.itemState).toBeDefined();
            aggregatedDuplicateCount += 1;
          } else {
            expect(item.itemState).not.toBeDefined();
          }
        }
      }

      expect(aggregatedCount).toBe(itemCount);
      expect(aggregatedDuplicateCount).toBe(itemDuplicateCount);
    });
  });

  describe('infix sitemaps', () => {
    it("should write two sitemaps if infix is ['de']", async () => {
      theConfig.infixDirs = ['de'];
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({})
        // Infix Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({});

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path3' },
          customId: '3',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path4' },
          customId: '4',
          type: 'image',
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
            data: (await deflateAsync(Buffer.from(JSON.stringify(item), 'utf-8'))).toString(
              'base64',
            ),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      // Save one of the items in the DB so it gets detected as a duplicate
      const duplicateRecord = new ItemRecord({
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
        ItemID: '3',
        SitemapItem: {
          url: 'https://www.example.com/',
        },
        Type: 'image',
        ItemStatus: 'written',
      });
      await duplicateRecord.save(dbManager);

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(2);

      // Primary sitemap
      {
        const s3SitemapPutCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);
        expect(s3SitemapPutCommand.input.Key).toBe(
          `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        );

        //
        // Fetch the sitemap from S3 and confirm it has 4 items
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolvesOnce({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/',
          filenameRoot: `image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items.length).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      }

      // Infix sitemap
      {
        const s3SitemapPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);
        expect(s3SitemapPutCommand.input.Key).toBe(
          `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
        );

        //
        // Fetch the sitemap from S3 and confirm it has 4 items
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolvesOnce({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/de/',
          filenameRoot: `de-image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items.length).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      }

      //
      // Check ShardState in DynamoDB
      //
      const shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(shardState.TotalItemCount).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      const fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe(theConfig.storeItemStateInDynamoDB ? 'dirty' : 'written');
      expect(fileState.CountWritten).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);
    });

    it("should write three sitemaps if infix is ['de', 'fr']", async () => {
      theConfig.infixDirs = ['de', 'fr'];
      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({})
        // de Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({})
        // fr Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/fr/fr-image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({});

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1' },
          customId: '1',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path3' },
          customId: '3',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path4' },
          customId: '4',
          type: 'image',
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
            data: (await deflateAsync(Buffer.from(JSON.stringify(item), 'utf-8'))).toString(
              'base64',
            ),
            sequenceNumber: '1',
            partitionKey: 'something',
            kinesisSchemaVersion: 'x',
            approximateArrivalTimestamp: 1,
          },
        });
      }

      // Save one of the items in the DB so it gets detected as a duplicate
      const duplicateRecord = new ItemRecord({
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
        ItemID: '3',
        SitemapItem: {
          url: 'https://www.example.com/',
        },
        Type: 'image',
        ItemStatus: 'written',
      });
      await duplicateRecord.save(dbManager);

      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(3);

      // There should only be 1 kinesis record written
      expect(kinesisClient.calls().length).toBe(1);
      const kinesisPutRecordsCommand = kinesisClient.call(0).args[0] as kinesis.PutRecordsCommand;
      expect(kinesisPutRecordsCommand).toBeInstanceOf(kinesis.PutRecordsCommand);
      expect(kinesisPutRecordsCommand.input.Records?.length).toBe(1);

      // Primary sitemap
      {
        const s3SitemapPutCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);
        expect(s3SitemapPutCommand.input.Key).toBe(
          `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        );

        //
        // Fetch the sitemap from S3 and confirm it has 4 items
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolvesOnce({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/',
          filenameRoot: `image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items.length).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items[0].url).toBe('https://www.example.com/some13/photo/path1');
      }

      // de sitemap
      {
        const s3SitemapPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);
        expect(s3SitemapPutCommand.input.Key).toBe(
          `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
        );

        //
        // Fetch the sitemap from S3 and confirm it has 4 items
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolvesOnce({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/de/',
          filenameRoot: `de-image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items.length).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items[0].url).toBe('https://www.example.com/de/some13/photo/path1');
      }

      // fr sitemap
      {
        const s3SitemapPutCommand = s3Client.call(2).args[0] as s3.PutObjectCommand;
        expect(s3SitemapPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        const s3SitemapStream = Readable.from(s3SitemapPutCommand.input.Body as string);
        expect(s3SitemapPutCommand.input.Key).toBe(
          `sitemaps/image/fr/fr-image-${shardIdPadded}-00001${sitemapExtension}`,
        );

        //
        // Fetch the sitemap from S3 and confirm it has 4 items
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/fr/fr-image-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolvesOnce({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const {
          sitemap,
          existing: sitemapExisting,
          items,
        } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/fr/',
          filenameRoot: `fr-image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items.length).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
        expect(items[0].url).toBe('https://www.example.com/fr/some13/photo/path1');
      }

      //
      // Check ShardState in DynamoDB
      //
      const shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(shardState.TotalItemCount).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      const fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe(theConfig.storeItemStateInDynamoDB ? 'dirty' : 'written');
      expect(fileState.CountWritten).toBe(theConfig.storeItemStateInDynamoDB ? 3 : 4);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);
    });

    it('existing index, unfull last sitemap', async () => {
      theConfig.infixDirs = ['de'];

      kinesisClient.on(kinesis.PutRecordsCommand).resolves({
        Records: [],
      });
      s3Client
        .onAnyCommand()
        .callsFake((command) => {
          // eslint-disable-next-line no-console
          console.log(`got unhandled command: ${command.constructor.name}`);
        })
        .rejects()
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({})
        // de Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            CacheControl: 'max-age=900; public',
            ContentType: 'application/xml',
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({});

      const items: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some13/photo/path1', lastmod: '2022-06-26T19:35:36.290Z' },
          customId: '1',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some13/photo/path2' },
          customId: '2',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path3' },
          customId: '3',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some14/photo/path4' },
          customId: '4',
          type: 'image',
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

      //
      // 1st Handler call to create sitemap contents
      //
      await handler(
        {
          Records: records,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(2);

      // Get stream for Primary sitemap
      const sitemapRequestPrimary = s3Client.call(0).args[0] as s3.PutObjectCommand;
      expect(sitemapRequestPrimary).toBeInstanceOf(s3.PutObjectCommand);
      expect(sitemapRequestPrimary.input.Key).toBe(
        `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
      );
      const s3SitemapStreamPrimary = Readable.from(sitemapRequestPrimary.input.Body as string);

      // Get stream for De sitemap
      const sitemapRequestDe = s3Client.call(1).args[0] as s3.PutObjectCommand;
      expect(sitemapRequestDe).toBeInstanceOf(s3.PutObjectCommand);
      expect(sitemapRequestDe.input.Key).toBe(
        `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
      );
      const s3SitemapStreamDe = Readable.from(sitemapRequestDe.input.Body as string);

      //
      // Check ShardState in DynamoDB
      //
      let shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(4);
      expect(shardState.TotalItemCount).toBe(4);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      let fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(4);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // NOTE: We cannot read and validate the s3 index/sitemap in this test
      // because the read is destructive on the s3 body streams.
      // So we just invoke the handler a second time and check the final results
      //

      s3Client
        .reset()
        .onAnyCommand()
        .callsFake((command) => {
          // eslint-disable-next-line no-console
          console.log(`got unhandled command: ${command.constructor.name}`);
        })
        .rejects()
        // Primary sitemap echo back
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolvesOnce({
          Body: s3SitemapStreamPrimary as unknown as StreamingBlobPayloadOutputTypes,
        })
        // De sitemap echo back
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolvesOnce({ Body: s3SitemapStreamDe as unknown as StreamingBlobPayloadOutputTypes })
        // Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({})
        // de Sitemap file upload
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({});

      //
      // Call the handler again with more items
      //
      const items2: ISitemapWriterItem[] = [
        {
          sitemapItem: { url: '/some15/photo/path5', lastmod: '2022-06-26T19:35:36.290Z' },
          customId: '5',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some15/photo/path6' },
          customId: '6',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some16/photo/path7' },
          customId: '7',
          type: 'image',
        },
        {
          sitemapItem: { url: '/some16/photo/path8' },
          customId: '8',
          type: 'image',
        },
      ];

      const records2: lambda.KinesisStreamRecord[] = [];
      for (const item of items2) {
        records2.push({
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

      //
      // 2nd Handler call to update sitemap contents
      //
      await handler(
        {
          Records: records2,
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(3);

      // Primary sitemap check
      {
        const sitemapRequest = s3Client.call(1).args[0] as s3.PutObjectCommand;
        expect(sitemapRequest).toBeInstanceOf(s3.PutObjectCommand);
        expect(sitemapRequest.input.Key).toBe(
          `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
        );
        const s3SitemapStream = Readable.from(sitemapRequest.input.Body as string);

        //
        // Fetch the sitemap from S3 and confirm it has 8 items
        //
        s3Client
          .on(
            s3.GetObjectCommand,
            {
              Bucket: s3SitemapsBucketName,
              Key: `sitemaps/image/image-${shardIdPadded}-00001${sitemapExtension}`,
            },
            false,
          )
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/',
          filenameRoot: `image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(8);
        expect(sitemap.items[0].url).toBe('https://www.example.com/some13/photo/path1');
        expect(sitemap.items[4].url).toBe('https://www.example.com/some15/photo/path5');
        expect(sitemap.items[0].lastmod).toBe('2022-06-26T19:35:36.290Z');
        expect(sitemap.items[4].lastmod).toBe('2022-06-26T19:35:36.290Z');
      }

      // de sitemap check
      {
        const sitemapRequest = s3Client.call(2).args[0] as s3.PutObjectCommand;
        expect(sitemapRequest).toBeInstanceOf(s3.PutObjectCommand);
        expect(sitemapRequest.input.Key).toBe(
          `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
        );
        const s3SitemapStream = Readable.from(sitemapRequest.input.Body as string);

        //
        // Fetch the sitemap from S3 and confirm it has 8 items
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image/de/de-image-${shardIdPadded}-00001${sitemapExtension}`,
          })
          .resolves({
            Body: s3SitemapStream as unknown as StreamingBlobPayloadOutputTypes,
          });
        const { sitemap, existing: sitemapExisting } = await SitemapFileWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          // FIXME: the sub-folder for the sitemap needs to be handled automagically
          s3Directory: 'sitemaps/image/de/',
          filenameRoot: `de-image-${shardIdPadded}-00001`,
          compress: theConfig.compressSitemapFiles,
          siteBaseURL,
        });
        expect(sitemapExisting).toBe(true);
        expect(sitemap.count).toBe(8);
        expect(sitemap.items[0].url).toBe('https://www.example.com/de/some13/photo/path1');
        expect(sitemap.items[4].url).toBe('https://www.example.com/de/some15/photo/path5');
        expect(sitemap.items[0].lastmod).toBe('2022-06-26T19:35:36.290Z');
        expect(sitemap.items[4].lastmod).toBe('2022-06-26T19:35:36.290Z');
      }

      //
      // Check ShardState in DynamoDB
      //
      shardState = await ShardStateRecord.loadOne(dbManager, {
        Type: 'image',
        ShardId: 1,
      });
      expect(shardState).toBeDefined();
      expect(shardState.FileCount).toBe(1);
      expect(shardState.CurrentFileItemCount).toBe(8);
      expect(shardState.TotalItemCount).toBe(8);
      expect(shardState.CurrentFileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);

      //
      // Check FileState in DynamoDB
      //
      fileState = await FileRecord.loadOne(dbManager, {
        Type: 'image',
        FileName: `image-${shardIdPadded}-00001${sitemapExtension}`,
      });
      expect(fileState).toBeDefined();
      expect(fileState.FileStatus).toBe('written');
      expect(fileState.CountWritten).toBe(8);
      expect(fileState.FileName).toBe(`image-${shardIdPadded}-00001${sitemapExtension}`);
    });
  });
});
