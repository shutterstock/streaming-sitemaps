//index.test.ts
/// <reference types="jest" />
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
  s3SitemapsBucketName: 'doc-example-bucket',
  compressSitemapFiles: false,
  emitMetrics: false,
  logSilent: true,
  localDirectory: '/tmp/sitemaps',
  s3Directory: 'sitemaps/',
  tableName: 'sitemaps',
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
import { handler } from './index';
import type * as lambda from 'aws-lambda';
import type { IIndexWriterMessage } from '@shutterstock/sitemaps-models-lib';
import * as s3 from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { SitemapIndexWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';

describe('Index Writer index.ts', () => {
  let s3Client: AwsClientStub<s3.S3Client>;
  const siteBaseURL = 'https://www.example.com';
  const s3SitemapsBucketName = 'doc-example-bucket';
  let sitemapExtension: string;

  beforeEach(() => {
    // Reset the config that's visible to the handler back to defaults
    Object.keys(origConfig).map((key) => {
      // @ts-expect-error we know the fields match
      theConfig[key] = origConfig[key];
    });
    s3Client = mockClient(s3.S3Client);
    sitemapExtension = theConfig.compressSitemapFiles ? '.xml.gz' : '.xml';
  });

  describe('lambda handler', () => {
    it('empty state initialization', async () => {
      s3Client
        .onAnyCommand()
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image-index${sitemapExtension}`,
        })
        .resolves({})
        // Handle the sitemap index put
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      const payload: IIndexWriterMessage = {
        type: 'image',
        indexItem: { url: `${siteBaseURL}/sitemaps/image/image-1-00001${sitemapExtension}` },
        action: 'add',
      };
      await handler(
        {
          Records: [
            {
              awsRegion: 'us-east-1',
              eventID: 'x',
              eventName: 'cat',
              eventSource: 'dog',
              eventSourceARN: 'arn:aws:something',
              eventVersion: 'v1',
              invokeIdentityArn: 'arn:aws:something',
              kinesis: {
                data: Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64'),
                sequenceNumber: '1',
                partitionKey: 'something',
                kinesisSchemaVersion: 'x',
                approximateArrivalTimestamp: 1,
              },
            },
          ],
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(2);

      expect(s3Client.call(1).args[0]).toBeInstanceOf(s3.PutObjectCommand);
      const s3SitemapIndexPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
      const s3SitemapIndexStream = Readable.from(s3SitemapIndexPutCommand.input.Body as string);
      expect(s3SitemapIndexPutCommand.input.Key).toBe(`sitemaps/image-index${sitemapExtension}`);

      //
      // Read the index back and make sure it has 1 item
      //
      s3Client
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image-index${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes,
        });

      // Read the index back from S3
      const { index, existing: indexExisting } = await SitemapIndexWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        s3Directory: 'sitemaps/',
        filenameRoot: 'image-index',
        compress: theConfig.compressSitemapFiles,
      });
      expect(indexExisting).toBe(true);
      expect(index.count).toBe(1);
      expect(index.lastFilename).toBe(`image-1-00001${sitemapExtension}`);
    });

    it('existing index', async () => {
      // Create the initial index to use in the subsequent test
      s3Client
        .onAnyCommand()
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image-index${sitemapExtension}`,
        })
        .resolves({})
        // Handle the sitemap index put
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      const payload: IIndexWriterMessage = {
        type: 'image',
        indexItem: { url: `${siteBaseURL}/sitemaps/image/image-1-00001${sitemapExtension}` },
        action: 'add',
      };
      await handler(
        {
          Records: [
            {
              awsRegion: 'us-east-1',
              eventID: 'x',
              eventName: 'cat',
              eventSource: 'dog',
              eventSourceARN: 'arn:aws:something',
              eventVersion: 'v1',
              invokeIdentityArn: 'arn:aws:something',
              kinesis: {
                data: Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64'),
                sequenceNumber: '1',
                partitionKey: 'something',
                kinesisSchemaVersion: 'x',
                approximateArrivalTimestamp: 1,
              },
            },
          ],
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(2);

      let s3SitemapIndexPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
      expect(s3SitemapIndexPutCommand).toBeInstanceOf(s3.PutObjectCommand);
      expect(s3SitemapIndexPutCommand.input.Key).toBe(`sitemaps/image-index${sitemapExtension}`);
      let s3SitemapIndexStream = Readable.from(s3SitemapIndexPutCommand.input.Body as string);

      //
      // Now test that adding more items to the existing index works
      //
      s3Client
        .reset()
        .onAnyCommand()
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image-index${sitemapExtension}`,
        })
        .resolves({ Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes })
        // Handle the sitemap index put
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index${sitemapExtension}`,
          },
          false,
        )
        .resolves({});

      const payload2: IIndexWriterMessage = {
        type: 'image',
        action: 'add',
        indexItem: {
          url: `${siteBaseURL}/sitemaps/image/image-1-00002${sitemapExtension}`,
        },
      };
      await handler(
        {
          Records: [
            {
              awsRegion: 'us-east-1',
              eventID: 'x',
              eventName: 'cat',
              eventSource: 'dog',
              eventSourceARN: 'arn:aws:something',
              eventVersion: 'v1',
              invokeIdentityArn: 'arn:aws:something',
              kinesis: {
                data: Buffer.from(JSON.stringify(payload2), 'utf-8').toString('base64'),
                sequenceNumber: '1',
                partitionKey: 'something',
                kinesisSchemaVersion: 'x',
                approximateArrivalTimestamp: 1,
              },
            },
          ],
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(2);

      s3SitemapIndexPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
      expect(s3SitemapIndexPutCommand).toBeInstanceOf(s3.PutObjectCommand);
      expect(s3SitemapIndexPutCommand.input.Key).toBe(`sitemaps/image-index${sitemapExtension}`);
      s3SitemapIndexStream = Readable.from(s3SitemapIndexPutCommand.input.Body as string);

      //
      // Read the index back and make sure it has 1 item
      //
      s3Client
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image-index${sitemapExtension}`,
        })
        .resolves({
          Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes,
        });

      // Read the index back from S3
      const { index, existing: indexExisting } = await SitemapIndexWrapper.fromS3({
        bucketName: s3SitemapsBucketName,
        s3Directory: 'sitemaps/',
        filenameRoot: 'image-index',
        compress: theConfig.compressSitemapFiles,
      });
      expect(indexExisting).toBe(true);
      expect(index.count).toBe(2);
      expect(index.lastFilename).toBe(`image-1-00002${sitemapExtension}`);
    });

    // Shows that multiple types of records
    // get split into the the right number of files
    it('mixed types get split into distinct index files', async () => {
      const types = ['type1', 'type2'];
      const typesCount = types.length;

      // Reject any command we don't configure
      s3Client.onAnyCommand().rejects();

      const itemCount = 50;
      const shardId = 1;
      const payload: lambda.KinesisStreamEvent = {
        Records: [],
      };
      const records = payload.Records;

      for (const type of types) {
        for (let i = 0; i < itemCount; i++) {
          const itemID = i + 1;

          const item: IIndexWriterMessage = {
            indexItem: {
              url: `${siteBaseURL}/sitemaps/${type}/${type}-${shardId}-${itemID
                .toString()
                .padStart(5, '0')}${sitemapExtension}`,
            },
            action: 'add',
            type,
          };

          records.push({
            awsRegion: 'us-east-1',
            eventID: 'x',
            eventName: 'cat',
            eventSource: 'dog',
            eventSourceARN: 'arn:aws:something',
            eventVersion: 'v1',
            invokeIdentityArn: 'arn:aws:something',
            kinesis: {
              data: Buffer.from(JSON.stringify(item), 'utf-8').toString('base64'),
              sequenceNumber: `${i}`,
              partitionKey: 'something',
              kinesisSchemaVersion: 'x',
              approximateArrivalTimestamp: 1,
            },
          });
        }

        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/${type}-index${sitemapExtension}`,
          })
          .resolves({})
          // Handle the sitemap index put
          .on(
            s3.PutObjectCommand,
            {
              Bucket: s3SitemapsBucketName,
              Key: `sitemaps/${type}-index${sitemapExtension}`,
            },
            false,
          )
          .resolves({});
      }

      await handler(payload, {
        awsRequestId: 'local-testing',
      } as lambda.Context);

      const s3CallsPerType = 2;
      let s3CallsOffset = 0;
      const s3CallsFromHandler = s3Client.calls();
      expect(s3CallsFromHandler.length).toBe(s3CallsPerType * typesCount);

      for (const type of types) {
        const s3SitemapIndexStream = Readable.from(
          (s3CallsFromHandler[s3CallsOffset + 1].args[0] as s3.PutObjectCommand).input
            .Body as string,
        );

        //
        // Read the index back and make sure it has 1 item
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/${type}-index${sitemapExtension}`,
          })
          .resolves({
            Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes,
          });

        // Read the index back from S3
        const {
          index,
          existing: indexExisting,
          items,
        } = await SitemapIndexWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          s3Directory: 'sitemaps/',
          filenameRoot: `${type}-index`,
          compress: theConfig.compressSitemapFiles,
        });
        expect(indexExisting).toBe(true);
        expect(index.count).toBe(itemCount);
        expect(index.lastFilename).toBe(
          `${type}-${shardId}-${itemCount.toString().padStart(5, '0')}${sitemapExtension}`,
        );

        // Check that the url to an individual sitemap includes the type
        expect(items[0].url).toBe(
          `${siteBaseURL}/sitemaps/${type}/${type}-${shardId}-00001${sitemapExtension}`,
        );
        expect(items[1].url).toBe(
          `${siteBaseURL}/sitemaps/${type}/${type}-${shardId}-00002${sitemapExtension}`,
        );

        s3CallsOffset += s3CallsPerType;
      }
    }, 240000);
  });

  describe('infix indices', () => {
    it("should write two indices if infix is ['de']", async () => {
      theConfig.infixDirs = ['de'];

      // Create the initial index to use in the subsequent test
      s3Client
        .onAnyCommand()
        .callsFake(() => {
          // eslint-disable-next-line no-console
          console.error('unexpected s3 call');
        })
        .rejects()
        .on(s3.GetObjectCommand, {
          Bucket: s3SitemapsBucketName,
          Key: `sitemaps/image-index${sitemapExtension}`,
        })
        .resolvesOnce({})
        // Handle the sitemap index put
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({
          VersionId: '',
        })
        // Handle the de index put
        .on(
          s3.PutObjectCommand,
          {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index-de${sitemapExtension}`,
          },
          false,
        )
        .resolvesOnce({
          VersionId: 'de',
        });

      const payload: IIndexWriterMessage = {
        type: 'image',
        indexItem: { url: `${siteBaseURL}/sitemaps/image/image-1-00001${sitemapExtension}` },
        action: 'add',
      };
      await handler(
        {
          Records: [
            {
              awsRegion: 'us-east-1',
              eventID: 'x',
              eventName: 'cat',
              eventSource: 'dog',
              eventSourceARN: 'arn:aws:something',
              eventVersion: 'v1',
              invokeIdentityArn: 'arn:aws:something',
              kinesis: {
                data: Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64'),
                sequenceNumber: '1',
                partitionKey: 'something',
                kinesisSchemaVersion: 'x',
                approximateArrivalTimestamp: 1,
              },
            },
          ],
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(3);

      {
        const s3SitemapIndexPutCommand = s3Client.call(2).args[0] as s3.PutObjectCommand;
        await expect(s3Client.call(2).returnValue).resolves.toEqual({ VersionId: 'de' });
        expect(s3SitemapIndexPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        expect(s3SitemapIndexPutCommand.input.Key).toBe(
          `sitemaps/image-index-de${sitemapExtension}`,
        );
      }

      {
        const s3SitemapIndexPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
        await expect(s3Client.call(1).returnValue).resolves.toEqual({ VersionId: '' });
        expect(s3SitemapIndexPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        expect(s3SitemapIndexPutCommand.input.Key).toBe(`sitemaps/image-index${sitemapExtension}`);
        const s3SitemapIndexStream = Readable.from(s3SitemapIndexPutCommand.input.Body as string);
        //
        // Now test that adding more items to the existing index works
        //
        s3Client
          .reset()
          .onAnyCommand()
          .callsFake(() => {
            // eslint-disable-next-line no-console
            console.error('unexpected s3 call');
          })
          .rejects()
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index${sitemapExtension}`,
          })
          .resolvesOnce({
            Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes,
          })
          // Handle the sitemap index put
          .on(
            s3.PutObjectCommand,
            {
              Bucket: s3SitemapsBucketName,
              Key: `sitemaps/image-index${sitemapExtension}`,
            },
            false,
          )
          .resolvesOnce({})
          // Handle the de index put
          .on(
            s3.PutObjectCommand,
            {
              Bucket: s3SitemapsBucketName,
              Key: `sitemaps/image-index-de${sitemapExtension}`,
            },
            false,
          )
          .resolvesOnce({});
      }

      const payload2: IIndexWriterMessage = {
        type: 'image',
        action: 'add',
        indexItem: {
          url: `${siteBaseURL}/sitemaps/image/image-1-00002${sitemapExtension}`,
        },
      };
      await handler(
        {
          Records: [
            {
              awsRegion: 'us-east-1',
              eventID: 'x',
              eventName: 'cat',
              eventSource: 'dog',
              eventSourceARN: 'arn:aws:something',
              eventVersion: 'v1',
              invokeIdentityArn: 'arn:aws:something',
              kinesis: {
                data: Buffer.from(JSON.stringify(payload2), 'utf-8').toString('base64'),
                sequenceNumber: '1',
                partitionKey: 'something',
                kinesisSchemaVersion: 'x',
                approximateArrivalTimestamp: 1,
              },
            },
          ],
        },
        {
          awsRequestId: 'local-testing',
        } as lambda.Context,
      );

      expect(s3Client.calls().length).toBe(3);

      {
        const s3SitemapIndexPutCommand = s3Client.call(1).args[0] as s3.PutObjectCommand;
        expect(s3SitemapIndexPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        expect(s3SitemapIndexPutCommand.input.Key).toBe(`sitemaps/image-index${sitemapExtension}`);
        const s3SitemapIndexStream = Readable.from(s3SitemapIndexPutCommand.input.Body as string);

        //
        // Read the index back and make sure it has 1 item
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index${sitemapExtension}`,
          })
          .resolves({
            Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes,
          });

        // Read the index back from S3
        const { index, existing: indexExisting } = await SitemapIndexWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          s3Directory: 'sitemaps/',
          filenameRoot: 'image-index',
          compress: theConfig.compressSitemapFiles,
        });
        expect(indexExisting).toBe(true);
        expect(index.count).toBe(2);
        expect(index.lastFilename).toBe(`image-1-00002${sitemapExtension}`);
      }

      // Check that de index was updated
      {
        const s3SitemapIndexPutCommand = s3Client.call(2).args[0] as s3.PutObjectCommand;
        expect(s3SitemapIndexPutCommand).toBeInstanceOf(s3.PutObjectCommand);
        expect(s3SitemapIndexPutCommand.input.Key).toBe(
          `sitemaps/image-index-de${sitemapExtension}`,
        );
        const s3SitemapIndexStream = Readable.from(s3SitemapIndexPutCommand.input.Body as string);

        //
        // Read the index back and make sure it has 1 item
        //
        s3Client
          .on(s3.GetObjectCommand, {
            Bucket: s3SitemapsBucketName,
            Key: `sitemaps/image-index-de${sitemapExtension}`,
          })
          .resolves({
            Body: s3SitemapIndexStream as unknown as StreamingBlobPayloadOutputTypes,
          });

        // Read the index back from S3
        const { index, existing: indexExisting } = await SitemapIndexWrapper.fromS3({
          bucketName: s3SitemapsBucketName,
          s3Directory: 'sitemaps/',
          filenameRoot: 'image-index-de',
          compress: theConfig.compressSitemapFiles,
        });
        expect(indexExisting).toBe(true);
        expect(index.count).toBe(2);
        expect(index.items[0].url).toBe(
          `${siteBaseURL}/sitemaps/image/de/de-image-1-00001${sitemapExtension}`,
        );
        expect(index.lastFilename).toBe(`de-image-1-00002${sitemapExtension}`);
      }
    });
  });
});
