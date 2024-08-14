//sitemap-wrapper.test.ts
/// <reference types="jest" />
import 'jest-dynalite/withDb';
import fs from 'fs-extra';
import { SitemapFileAndStats } from './sitemap-file-stats';
import * as s3 from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DBManager } from '@shutterstock/sitemaps-db-lib';

import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';

describe('SitemapFileAndStats', () => {
  const filenameRoot = 'sitemap-tests2';
  const filenameBase = `/tmp/${filenameRoot}.xml`;
  const filenameGz = `/tmp/${filenameRoot}.xml.gz`;
  let s3Client: AwsClientStub<s3.S3Client>;
  const siteBaseURL = 'https://www.example.com';
  const type = 'image';
  let dynamoClient: DynamoDBClient;
  let dbManager: DBManager;

  beforeAll(() => {
    dynamoClient = new DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
    dbManager = new DBManager({ client: dynamoClient, tableName: 'sitemaps' });
  });
  afterAll(() => {
    dynamoClient.destroy();
  });

  beforeEach(() => {
    s3Client = mockClient(s3.S3Client);
    try {
      if (fs.existsSync(filenameBase)) {
        fs.unlinkSync(filenameBase);
      }
      if (fs.existsSync(filenameGz)) {
        fs.unlinkSync(filenameGz);
      }
    } catch {
      // Ignore
    }
  });

  it('fromS3 - throws on S3 generic failure', async () => {
    s3Client.onAnyCommand().rejects({ message: 'some weird s3 failure' });

    // Fetch the last sitemap file
    await expect(async () =>
      SitemapFileAndStats.fromS3(
        {
          bucketName: 'sitemaps',
          compress: false,
          s3Directory: 'sitemaps/',
          filenameRoot,
          siteBaseURL,
          localDirectory: '/tmp',
        },
        { dbManager, key: { Type: type } },
      ),
    ).rejects.toThrowError('some weird s3 failure');
  });

  it('fromS3 - throws on S3 NoSuchKey', async () => {
    s3Client
      .onAnyCommand()
      .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }));

    // Fetch the last sitemap file
    await expect(async () =>
      SitemapFileAndStats.fromS3(
        {
          bucketName: 'sitemaps',
          compress: false,
          s3Directory: 'sitemaps/',
          filenameRoot,
          siteBaseURL,
          localDirectory: '/tmp',
        },
        { dbManager, key: { Type: type } },
      ),
    ).rejects.toThrowError(
      'SitemapFileAndStats.fromS3 - File not found on S3 - This function cannot be called on non-existing files',
    );
  });

  it('fromS3 - throws on DynamoDB fails', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: false,
      siteBaseURL,
    });
    for (let i = 1; i <= 100; i++) {
      await sitemap.write({ item: { url: `/some/path/first-${i}` } });
    }
    await sitemap.end();

    expect(sitemap.full).toBe(false);
    const sizeUncompressed = sitemap.sizeUncompressed;

    // Accept the S3 upload request so the body bytes can be echo'd back
    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    // Push the map to S3
    await sitemap.pushToS3({
      bucketName: 'sitemaps',
      s3Directory: 'sitemaps/',
    });
    // Size should not change after S3 push
    expect(sitemap.sizeUncompressed).toBe(sizeUncompressed);

    // Setup the S3 command to echo the uploaded stream contents right back
    const s3PutObjectCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
    const s3UploadStream = Readable.from(s3PutObjectCommand.input.Body as string);
    s3Client
      .on(
        s3.GetObjectCommand,
        {
          Bucket: 'sitemaps',
        },
        false,
      )
      .resolves({
        Body: s3UploadStream as unknown as StreamingBlobPayloadOutputTypes,
      });

    // Fetch the last sitemap file
    await expect(async () =>
      SitemapFileAndStats.fromS3(
        {
          bucketName: 'sitemaps',
          compress: false,
          s3Directory: 'sitemaps/',
          filenameRoot,
          siteBaseURL,
          localDirectory: '/tmp',
        },
        { dbManager, key: { Type: type } },
      ),
    ).rejects.toThrowError('FileRecord.loadOne failed for image, sitemap-tests2.xml');
  });
});
