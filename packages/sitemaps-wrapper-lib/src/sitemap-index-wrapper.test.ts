//sitemap-index-wrapper.test.ts
/// <reference types="jest" />

import { promisify } from 'util';
import fs from 'fs-extra';
import zlib from 'zlib';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import { SitemapIndexWrapper } from './sitemap-index-wrapper';
import { v4 as uuidv4 } from 'uuid';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';

const gunzipAsync = promisify(zlib.gunzip);

describe('SitemapIndexWrapper', () => {
  const filenameRoot = 'sitemap-index-tests';
  const filenameBase = `/tmp/${filenameRoot}.xml`;
  const filenameGz = `/tmp/${filenameRoot}.xml.gz`;
  let s3Client: AwsClientStub<s3.S3Client>;

  // afterEach(() => {
  //   s3Client.restore();
  //   try {
  //     if (fs.existsSync(filenameBase)) {
  //       fs.unlinkSync(filenameBase);
  //     }
  //     if (fs.existsSync(filenameGz)) {
  //       fs.unlinkSync(filenameGz);
  //     }
  //   } catch {
  //     // Ignore
  //   }
  // });
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

  it('writes correctly - new index', async () => {
    const sitemapIndex = new SitemapIndexWrapper({
      filenameRoot,
      compress: true,
    });
    for (let i = 1; i <= 50000; i++) {
      await sitemapIndex.write({
        item: { url: `https://www.example.com/some/path/index-${i}.xml.gz` },
      });
    }
    await sitemapIndex.end();

    // At this point the file should be saved

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const fileStr = (await gunzipAsync(gzBuff)).toString('utf-8');

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 5000)).toMatchSnapshot('start of file');
    expect(
      fileStr.slice(fileStr.length > 5000 ? fileStr.length - 5000 : 0, fileStr.length),
    ).toMatchSnapshot('end of file');
  });

  it('writes correctly - existing index from s3 - compressed', async () => {
    const sitemapIndex = new SitemapIndexWrapper({
      filenameRoot,
      compress: true,
    });
    for (let i = 1; i <= 10000; i++) {
      await sitemapIndex.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndex.end();
    expect(sitemapIndex.items.length).toBe(10000);

    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    // Push the index to S3
    await sitemapIndex.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });

    // Setup the S3 command to echo the uploaded stream contents right back
    const s3PutObjectCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
    const uploadKey = s3PutObjectCommand.input.Key;
    const s3UploadStream = Readable.from(s3PutObjectCommand.input.Body as string);
    s3Client
      .on(s3.GetObjectCommand, {
        Bucket: 'doc-example-bucket',
        Key: uploadKey,
      })
      .resolves({
        Body: s3UploadStream as StreamingBlobPayloadOutputTypes,
      });

    // Read the index back from S3
    const { index: sitemapIndexDeux, existing: existingDeux } = await SitemapIndexWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
    });

    expect(sitemapIndex.items.length).toBe(10000);
    expect(existingDeux).toBe(true);
    expect(sitemapIndexDeux.lastFilename).toBe('sitemap-10000.xml.gz');

    // Write more items to the index
    for (let i = 10001; i <= 12000; i++) {
      await sitemapIndexDeux.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndexDeux.end();
    expect(sitemapIndexDeux.items.length).toBe(12000);

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const fileStr = (await gunzipAsync(gzBuff)).toString('utf-8');

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 5000)).toMatchSnapshot('start of file');
    expect(
      fileStr.slice(fileStr.length > 5000 ? fileStr.length - 5000 : 0, fileStr.length),
    ).toMatchSnapshot('end of file');
  });

  it('writes correctly - existing index from s3 - uncompressed', async () => {
    const sitemapIndex = new SitemapIndexWrapper({
      filenameRoot,
      compress: false,
    });
    for (let i = 1; i <= 10000; i++) {
      await sitemapIndex.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndex.end();

    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    // Push the index to S3
    await sitemapIndex.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });

    // Setup the S3 command to echo the uploaded stream contents right back
    const s3PutObjectCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
    const uploadKey = s3PutObjectCommand.input.Key;
    const s3UploadStream = Readable.from(s3PutObjectCommand.input.Body as string);
    s3Client
      .on(s3.GetObjectCommand, {
        Bucket: 'doc-example-bucket',
        Key: uploadKey,
      })
      .resolves({
        Body: s3UploadStream as StreamingBlobPayloadOutputTypes,
      });

    // Read the index back from S3
    const { index: sitemapIndexDeux, existing: existingDeux } = await SitemapIndexWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: false,
    });

    expect(existingDeux).toBe(true);
    expect(sitemapIndexDeux.lastFilename).toBe('sitemap-10000.xml.gz');

    // Write more items to the index
    for (let i = 10001; i <= 12000; i++) {
      await sitemapIndexDeux.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndexDeux.end();

    // Decompress the file manually and check if it's parsable
    const fileBuff = Buffer.from(await fs.readFile(filenameBase));
    const fileStr = fileBuff.toString('utf-8');

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 5000)).toMatchSnapshot('start of file');
    expect(
      fileStr.slice(fileStr.length > 5000 ? fileStr.length - 5000 : 0, fileStr.length),
    ).toMatchSnapshot('end of file');
  });

  it('writes correctly - new empty fetch from s3', async () => {
    s3Client
      .onAnyCommand()
      .rejects()
      .on(s3.GetObjectCommand)
      .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }));

    const { index: sitemapIndex, existing } = await SitemapIndexWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
    });

    expect(existing).toBe(false);
    expect(sitemapIndex.lastFilename).toBeUndefined();

    for (let i = 1; i <= 10000; i++) {
      await sitemapIndex.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndex.end();

    s3Client.reset().onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    // Push the index to S3
    await sitemapIndex.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });

    // Setup the S3 command to echo the uploaded stream contents right back
    const s3PutObjectCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
    const uploadKey = s3PutObjectCommand.input.Key;
    const s3UploadStream = Readable.from(s3PutObjectCommand.input.Body as string);
    s3Client
      .on(s3.GetObjectCommand, {
        Bucket: 'doc-example-bucket',
        Key: uploadKey,
      })
      .resolves({
        Body: s3UploadStream as StreamingBlobPayloadOutputTypes,
      });

    // Read the index back from S3
    const { index: sitemapIndexDeux, existing: existingDeux } = await SitemapIndexWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
    });

    expect(existingDeux).toBe(true);
    expect(sitemapIndexDeux.lastFilename).toBe('sitemap-10000.xml.gz');

    // Write more items to the index
    for (let i = 10001; i <= 12000; i++) {
      await sitemapIndexDeux.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndexDeux.end();

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const fileStr = (await gunzipAsync(gzBuff)).toString('utf-8');

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 5000)).toMatchSnapshot('start of file');
    expect(
      fileStr.slice(fileStr.length > 5000 ? fileStr.length - 5000 : 0, fileStr.length),
    ).toMatchSnapshot('end of file');

    // TODO: Push the file back to S3
  });

  it('fromS3 - Correctly detects non existing after first failure', async () => {
    s3Client
      .onAnyCommand()
      .rejects()
      .on(s3.GetObjectCommand)
      .rejects()
      .on(s3.GetObjectCommand)
      .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }));

    const { index: sitemapIndex, existing } = await SitemapIndexWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
    });

    expect(existing).toBe(false);
    expect(sitemapIndex.lastFilename).toBeUndefined();
  }, 60000);

  it('fromS3 - Correctly throws if s3 consistently fails reads', async () => {
    s3Client
      .onAnyCommand()
      .rejects()
      .on(s3.GetObjectCommand)
      .rejects({ message: 'some weird s3 failure' });

    await expect(async () =>
      SitemapIndexWrapper.fromS3({
        bucketName: 'doc-example-bucket',
        s3Directory: 'sitemaps/',
        filenameRoot,
        compress: true,
      }),
    ).rejects.toThrowError('some weird s3 failure');
  }, 60000);

  it('stable ordering on load', async () => {
    const sitemapIndex = new SitemapIndexWrapper({
      filenameRoot,
      compress: true,
    });
    for (let i = 1; i <= 10000; i++) {
      await sitemapIndex.write({
        item: { url: `https://www.example.com/some/path/sitemap-${uuidv4()}-${i}.xml.gz` },
      });
    }
    await sitemapIndex.end();

    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    // Push the index to S3
    await sitemapIndex.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });

    // Setup the S3 command to echo the uploaded stream contents right back
    const s3PutObjectCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
    const uploadKey = s3PutObjectCommand.input.Key;
    const s3UploadStream = Readable.from(s3PutObjectCommand.input.Body as string);
    s3Client
      .on(s3.GetObjectCommand, {
        Bucket: 'doc-example-bucket',
        Key: uploadKey,
      })
      .resolves({
        Body: s3UploadStream as StreamingBlobPayloadOutputTypes,
      });

    // Read the index back from S3
    const { index: sitemapIndexDeux, existing: existingDeux } = await SitemapIndexWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
    });

    expect(existingDeux).toBe(true);
    expect(sitemapIndexDeux.lastFilename).toContain('sitemap-');
    expect(sitemapIndexDeux.lastFilename).toContain('-10000.xml.gz');

    // Write more items to the index
    for (let i = 10001; i <= 12000; i++) {
      await sitemapIndexDeux.write({
        item: { url: `https://www.example.com/some/path/sitemap-${i}.xml.gz` },
      });
    }
    await sitemapIndexDeux.end();

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const fileStr = (await gunzipAsync(gzBuff)).toString('utf-8');

    expect(fileStr).toBeDefined();
  });
});
