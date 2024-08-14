/* eslint-disable no-console */
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
import { createReadStream } from 'graceful-fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { ShardStateRecord, DBManager, FileRecord } from '@shutterstock/sitemaps-db-lib';
import { loadInitialSitemapFile } from './sitemap-load-initial';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { resolve } from 'path';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';

describe('sitemap-load-initial', () => {
  let s3Client: AwsClientStub<s3.S3Client>;
  let flatMetricsTyped: FlatCountMetrics;
  let config: IConfig;
  let sitemapExtension: string;
  let dynamoClient: DynamoDBClient;
  let dbManager: DBManager;

  beforeAll(() => {
    config = { ...Config.instance };

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
    s3Client = mockClient(s3.S3Client);
    sitemapExtension = config.compressSitemapFiles ? '.xml.gz' : '.xml';
    flatMetricsTyped = new FlatCountMetrics();
  });

  describe('loadInitialSitemapFile', () => {
    const type = 'widget';
    const shardId = 1;
    const shardIdPadded = shardId.toString().padStart(3, '0');

    it('no shard state, on file state, no s3 file', async () => {
      s3Client
        .onAnyCommand()
        .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }));

      const shardStateInit = new ShardStateRecord({
        ShardId: shardId,
        Type: type,
      });

      const initialSitemap = await loadInitialSitemapFile({
        config,
        dbManager,
        flatMetricsTyped,
        shardState: shardStateInit,
      });

      expect(initialSitemap).toBeDefined();
      expect(initialSitemap.sitemap).toBeDefined();
      expect(initialSitemap.existing).toBe(false);
      expect(initialSitemap.stats.FileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(initialSitemap.sitemap.count).toBe(0);

      // Check that Shard State was updated correctly in the DB
      const shardStateAfter = await ShardStateRecord.loadOne(dbManager, {
        ShardId: shardId,
        Type: type,
      });
      expect(shardStateAfter).toBeDefined();
      expect(shardStateAfter.CurrentFileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(shardStateAfter.FileCount).toBe(1);

      // Check that File State was updated correctly in the DB
      const fileStateAfter = await FileRecord.loadOne(dbManager, {
        FileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        Type: type,
      });
      expect(fileStateAfter).toBeDefined();
      expect(fileStateAfter.FileName).toBe(`widget-${shardIdPadded}-00001${sitemapExtension}`);
      expect(fileStateAfter.FileStatus).toBe('empty');
      expect(fileStateAfter.Type).toBe(type);
    });

    it('existing and correct shard state / file state / s3 file', async () => {
      const sitemapStream = createReadStream(resolve(__dirname, 'mocks', 'video-small.xml'));
      s3Client
        .onAnyCommand()
        .callsFake((command) => {
          console.error('Unmocked command', command);
          throw new Error('Unmocked command');
        })
        .on(s3.GetObjectCommand, {
          Bucket: config.s3SitemapsBucketName,
          Key: `${config.s3Directory}widget/widget-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: sitemapStream as unknown as StreamingBlobPayloadOutputTypes,
        });

      // Init the Shard State in the DB
      const shardStateInit = new ShardStateRecord({
        ShardId: shardId,
        Type: type,
        FileCount: 1,
        CurrentFileItemCount: 8,
        CurrentFileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        TotalItemCount: 8,
      });
      await shardStateInit.save(dbManager);

      // Init the File State in the DB
      const fileStateInit = new FileRecord({
        FileName: shardStateInit.CurrentFileName,
        CountWritten: 8,
        Type: type,
      });
      await fileStateInit.save(dbManager);
      expect(fileStateInit.FileStatus).toBe('written');

      const initialSitemap = await loadInitialSitemapFile({
        config,
        dbManager,
        flatMetricsTyped,
        shardState: shardStateInit,
      });

      expect(initialSitemap).toBeDefined();
      expect(initialSitemap.sitemap).toBeDefined();
      expect(initialSitemap.existing).toBe(true);
      expect(initialSitemap.stats.FileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(initialSitemap.sitemap.count).toBe(shardStateInit.TotalItemCount);

      // Check that Shard State was updated correctly in the DB
      const shardStateAfter = await ShardStateRecord.loadOne(dbManager, {
        ShardId: shardId,
        Type: type,
      });
      expect(shardStateAfter).toBeDefined();
      expect(shardStateAfter.CurrentFileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(shardStateAfter.FileCount).toBe(1);

      // Check that File State was updated correctly in the DB
      const fileStateAfter = await FileRecord.loadOne(dbManager, {
        FileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        Type: type,
      });
      expect(fileStateAfter).toBeDefined();
      expect(fileStateAfter.FileName).toBe(`widget-${shardIdPadded}-00001${sitemapExtension}`);
      expect(fileStateAfter.FileStatus).toBe('written');
      expect(fileStateAfter.Type).toBe(type);
    });

    it('existing shard state record, existing file state record, missing s3 file', async () => {
      s3Client
        .onAnyCommand()
        .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }));

      // Init the Shard State in the DB
      const shardStateInit = new ShardStateRecord({
        ShardId: shardId,
        Type: type,
        FileCount: 1,
        CurrentFileItemCount: 8,
        CurrentFileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        TotalItemCount: 8,
      });
      await shardStateInit.save(dbManager);

      // Init the File State in the DB
      const fileStateInit = new FileRecord({
        FileName: shardStateInit.CurrentFileName,
        CountWritten: 8,
        Type: type,
      });
      await fileStateInit.save(dbManager);
      expect(fileStateInit.FileStatus).toBe('written');

      const initialSitemap = await loadInitialSitemapFile({
        config,
        dbManager,
        flatMetricsTyped,
        shardState: shardStateInit,
      });

      // This needs to skip the file that cannot be retrieved
      // The file that cannot be retrieved will eventually be reconstructed by contents from DynamoDB

      expect(initialSitemap).toBeDefined();
      expect(initialSitemap.sitemap).toBeDefined();
      expect(initialSitemap.existing).toBe(false);
      expect(initialSitemap.stats.FileName).toBe(
        `widget-${shardIdPadded}-00002${sitemapExtension}`,
      );
      expect(initialSitemap.sitemap.count).toBe(0);

      // Check that Shard State was updated correctly in the DB
      const shardStateAfter = await ShardStateRecord.loadOne(dbManager, {
        ShardId: shardId,
        Type: type,
      });
      expect(shardStateAfter).toBeDefined();
      expect(shardStateAfter.CurrentFileName).toBe(
        `widget-${shardIdPadded}-00002${sitemapExtension}`,
      );
      expect(shardStateAfter.FileCount).toBe(2);

      // Check that File State was updated correctly in the DB
      const fileStateAfter = await FileRecord.loadOne(dbManager, {
        FileName: `widget-${shardIdPadded}-00002${sitemapExtension}`,
        Type: type,
      });
      expect(fileStateAfter).toBeDefined();
      expect(fileStateAfter.FileName).toBe(`widget-${shardIdPadded}-00002${sitemapExtension}`);
      expect(fileStateAfter.FileStatus).toBe('empty');
      expect(fileStateAfter.Type).toBe(type);
      expect(fileStateAfter.CountWritten).toBe(0);
    });

    it('existing and correct shard state / file state, corrupt s3 file', async () => {
      const sitemapStream = createReadStream(resolve(__dirname, 'mocks', 'malformed-small.xml'));
      s3Client
        .onAnyCommand()
        .callsFake((command) => {
          console.error('Unmocked command', command);
          throw new Error('Unmocked command');
        })
        .on(s3.GetObjectCommand, {
          Bucket: config.s3SitemapsBucketName,
          Key: `${config.s3Directory}widget/widget-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: sitemapStream as unknown as StreamingBlobPayloadOutputTypes,
        });

      // Init the Shard State in the DB
      const shardStateInit = new ShardStateRecord({
        ShardId: shardId,
        Type: type,
        FileCount: 1,
        CurrentFileItemCount: 8,
        CurrentFileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        TotalItemCount: 8,
      });
      await shardStateInit.save(dbManager);

      // Init the File State in the DB
      const fileStateInit = new FileRecord({
        FileName: shardStateInit.CurrentFileName,
        CountWritten: 8,
        Type: type,
      });
      await fileStateInit.save(dbManager);
      expect(fileStateInit.FileStatus).toBe('written');

      const initialSitemap = await loadInitialSitemapFile({
        config,
        dbManager,
        flatMetricsTyped,
        shardState: shardStateInit,
      });

      expect(initialSitemap).toBeDefined();
      expect(initialSitemap.sitemap).toBeDefined();
      expect(initialSitemap.existing).toBe(false);
      expect(initialSitemap.stats.FileName).toBe(
        `widget-${shardIdPadded}-00002${sitemapExtension}`,
      );
      expect(initialSitemap.sitemap.count).toBe(0);

      // Check that Shard State was updated correctly in the DB
      const shardStateAfter = await ShardStateRecord.loadOne(dbManager, {
        ShardId: shardId,
        Type: type,
      });
      expect(shardStateAfter).toBeDefined();
      expect(shardStateAfter.CurrentFileName).toBe(
        `widget-${shardIdPadded}-00002${sitemapExtension}`,
      );
      expect(shardStateAfter.FileCount).toBe(2);
      expect(shardStateAfter.TotalItemCount).toBe(shardStateInit.TotalItemCount);

      // Check that the malformed File State was updated correctly in the DB
      const fileStateAfterMalformed = await FileRecord.loadOne(dbManager, {
        FileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        Type: type,
      });
      expect(fileStateAfterMalformed).toBeDefined();
      expect(fileStateAfterMalformed.FileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(fileStateAfterMalformed.FileStatus).toBe('malformed');
      expect(fileStateAfterMalformed.Type).toBe(type);

      // Check that the new File State was updated correctly in the DB
      const fileStateAfter = await FileRecord.loadOne(dbManager, {
        FileName: `widget-${shardIdPadded}-00002${sitemapExtension}`,
        Type: type,
      });
      expect(fileStateAfter).toBeDefined();
      expect(fileStateAfter.FileName).toBe(`widget-${shardIdPadded}-00002${sitemapExtension}`);
      expect(fileStateAfter.FileStatus).toBe('empty');
      expect(fileStateAfter.Type).toBe(type);
    });

    it('existing and correct shard state, file state has status of `empty`, s3 file will be missing', async () => {
      s3Client.onAnyCommand().rejects();

      // Init the Shard State in the DB
      const shardStateInit = new ShardStateRecord({
        ShardId: shardId,
        Type: type,
        FileCount: 1,
        CurrentFileItemCount: 0,
        CurrentFileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        TotalItemCount: 0,
      });
      await shardStateInit.save(dbManager);

      // Init the File State in the DB
      const fileStateInit = new FileRecord({
        FileName: shardStateInit.CurrentFileName,
        CountWritten: 0,
        Type: type,
        FileStatus: 'empty',
      });
      await fileStateInit.save(dbManager);
      expect(fileStateInit.FileStatus).toBe('empty');

      const initialSitemap = await loadInitialSitemapFile({
        config,
        dbManager,
        flatMetricsTyped,
        shardState: shardStateInit,
      });

      expect(initialSitemap).toBeDefined();
      expect(initialSitemap.sitemap).toBeDefined();
      expect(initialSitemap.existing).toBe(false);
      expect(initialSitemap.stats.FileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(initialSitemap.sitemap.count).toBe(0);

      // Check that Shard State was updated correctly in the DB
      const shardStateAfter = await ShardStateRecord.loadOne(dbManager, {
        ShardId: shardId,
        Type: type,
      });
      expect(shardStateAfter).toBeDefined();
      expect(shardStateAfter.CurrentFileName).toBe(
        `widget-${shardIdPadded}-00001${sitemapExtension}`,
      );
      expect(shardStateAfter.FileCount).toBe(1);
      expect(shardStateAfter.TotalItemCount).toBe(shardStateInit.TotalItemCount);

      // Check that the 1st File State was updated correctly in the DB
      const fileStateAfter = await FileRecord.loadOne(dbManager, {
        FileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        Type: type,
      });
      fileStateAfter.AddFileItem();
      await fileStateAfter.save(dbManager);
      expect(fileStateAfter).toBeDefined();
      expect(fileStateAfter.FileName).toBe(`widget-${shardIdPadded}-00001${sitemapExtension}`);
      expect(fileStateAfter.FileStatus).toBe('written');
      expect(fileStateAfter.Type).toBe(type);
    });

    it.skip('existing shard state record, existing s3 file, missing file state record', async () => {
      const sitemapStream = createReadStream(resolve(__dirname, 'mocks', 'video-small.xml'));
      s3Client
        .onAnyCommand()
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: config.s3SitemapsBucketName,
          Key: `${config.s3Directory}widget/widget-${shardIdPadded}-00001${sitemapExtension}`,
        })
        .resolves({
          Body: sitemapStream as unknown as StreamingBlobPayloadOutputTypes,
        });

      // Init the Shard State in the DB
      const shardStateInit = new ShardStateRecord({
        ShardId: shardId,
        Type: type,
        FileCount: 1,
        CurrentFileItemCount: 8,
        CurrentFileName: `widget-${shardIdPadded}-00001${sitemapExtension}`,
        TotalItemCount: 8,
      });
      await shardStateInit.save(dbManager);

      const initialSitemap = await loadInitialSitemapFile({
        config,
        dbManager,
        flatMetricsTyped,
        shardState: shardStateInit,
      });

      // TODO: This should not throw but should instead update the file record state in the DB and return the file

      expect(initialSitemap).toBeDefined();
    });
  });
});
