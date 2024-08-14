//sitemap-wrapper.test.ts
/// <reference types="jest" />

import { promisify } from 'util';
import fs from 'fs-extra';
import { SitemapFileWrapper } from './sitemap-wrapper';
import zlib from 'zlib';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import type { StreamingBlobPayloadOutputTypes } from '@smithy/types';

const gunzipAsync = promisify(zlib.gunzip);

describe('SitemapFileWrapper', () => {
  const filenameRoot = 'sitemap-tests';
  const filenameBase = `/tmp/${filenameRoot}.xml`;
  const filenameGz = `/tmp/${filenameRoot}.xml.gz`;
  let s3Client: AwsClientStub<s3.S3Client>;
  const siteBaseURL = 'https://www.example.com';

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

  it('initializes filename correctly', () => {
    const sitemap = new SitemapFileWrapper({
      compress: false,
      filenameRoot: 'sitemap-1-0001',
      siteBaseURL: siteBaseURL,
      localDirectory: '/tmp',
      limitCount: 100,
    });

    expect(sitemap).toBeDefined();
    expect(sitemap.filename).toBe('sitemap-1-0001.xml');
    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(0);
  });

  it('writes correctly', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: true,
      siteBaseURL: 'https://www.example.com',
    });
    for (let i = 1; i <= 50000; i++) {
      await sitemap.write({ item: { url: `/some/path/${i}` } });
    }
    await sitemap.end();

    // At this point the file should be saved

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const fileStr = (await gunzipAsync(gzBuff)).toString('utf-8');

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 1000)).toMatchSnapshot();
    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(50000);
    expect(sitemap.items.slice(0, 10)).toMatchSnapshot();
  }, 40000);

  it('uploads to s3', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: true,
      siteBaseURL: 'https://www.example.com',
    });
    for (let i = 1; i <= 50000; i++) {
      await sitemap.write({ item: { url: `/some/path/${i}` } });
    }
    await sitemap.end();

    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    await sitemap.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });

    expect(s3Client.calls().length).toBe(1);

    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(50000);

    // At this point the file should be saved
  });

  it('writes correctly - existing file from s3', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: true,
      siteBaseURL,
    });
    for (let i = 1; i <= 10000; i++) {
      await sitemap.write({ item: { url: `/some/path/first-${i}` } });
    }
    await sitemap.end();

    expect(sitemap.full).toBe(false);
    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(10000);
    const sizeUncompressed = sitemap.sizeUncompressed;

    // Accept the S3 upload request so the body bytes can be echo'd back
    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    // Push the map to S3
    await sitemap.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });
    // Size should not change after S3 push
    expect(sitemap.sizeUncompressed).toBe(sizeUncompressed);

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
        Body: s3UploadStream as unknown as StreamingBlobPayloadOutputTypes,
      });

    // Read the index back from S3
    const { sitemap: sitemapDeux } = await SitemapFileWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
      siteBaseURL,
    });

    // Check that the returned size is equal to what was put to S3
    expect(sitemapDeux.sizeUncompressed).toBe(sizeUncompressed);

    // Write more items to the index
    for (let i = 10001; i <= 12000; i++) {
      await sitemapDeux.write({
        item: { url: `/some/path/second-${i}` },
      });
    }
    await sitemapDeux.end();

    expect(sitemapDeux.full).toBe(false);
    expect(sitemapDeux.sizeUncompressed).toBeGreaterThan(sizeUncompressed);

    expect(sitemapDeux.items).toBeDefined();
    expect(sitemapDeux.items.length).toBe(12000);

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const fileStr = (await gunzipAsync(gzBuff)).toString('utf-8');

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 5000)).toMatchSnapshot('start of file');
    expect(
      fileStr.slice(fileStr.length > 5000 ? fileStr.length - 5000 : 0, fileStr.length),
    ).toMatchSnapshot('end of file');
  });

  it('writes correctly - new empty file fetch from s3', async () => {
    s3Client
      .onAnyCommand()
      .rejects()
      .on(s3.GetObjectCommand)
      .rejects(new s3.NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }));

    const { sitemap: sitemap, existing } = await SitemapFileWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
      siteBaseURL,
    });

    expect(existing).toBe(false);
    expect(sitemap.sizeUncompressed).toBeGreaterThan(300);

    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(0);

    for (let i = 1; i <= 10000; i++) {
      await sitemap.write({
        item: { url: `https://www.example.com/some/path/first-${i}` },
      });
    }
    await sitemap.end();

    s3Client.reset().onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(10000);

    // Push the index to S3
    await sitemap.pushToS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
    });
    // Setup the S3 command to echo the uploaded stream contents right back
    const s3PutCommand = s3Client.call(0).args[0] as s3.PutObjectCommand;
    const uploadKey = s3PutCommand.input.Key;
    const s3UploadStream = Readable.from(s3PutCommand.input.Body as string);
    s3Client
      .on(s3.GetObjectCommand, {
        Bucket: 'doc-example-bucket',
        Key: uploadKey,
      })
      .resolves({
        Body: s3UploadStream as unknown as StreamingBlobPayloadOutputTypes,
      });

    // Read the index back from S3
    const { sitemap: sitemapDeux } = await SitemapFileWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
      siteBaseURL,
    });

    expect(sitemapDeux.items).toBeDefined();
    expect(sitemapDeux.items.length).toBe(10000);

    // Write more items to the index
    for (let i = 10001; i <= 12000; i++) {
      await sitemapDeux.write({
        item: { url: `https://www.example.com/some/path/second-${i}` },
      });
    }
    await sitemapDeux.end();

    expect(sitemapDeux.items).toBeDefined();
    expect(sitemapDeux.items.length).toBe(12000);

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

    const { sitemap, existing } = await SitemapFileWrapper.fromS3({
      bucketName: 'doc-example-bucket',
      s3Directory: 'sitemaps/',
      filenameRoot,
      compress: true,
      siteBaseURL,
    });

    expect(existing).toBe(false);
    expect(sitemap.count).toBe(0);
    expect(sitemap.items).toBeDefined();
    expect(sitemap.items.length).toBe(0);
  });

  it('fromS3 - Correctly throws if s3 consistently fails reads', async () => {
    s3Client
      .onAnyCommand()
      .rejects()
      .on(s3.GetObjectCommand)
      .rejects({ message: 'some weird s3 failure' });

    await expect(async () =>
      SitemapFileWrapper.fromS3({
        bucketName: 'doc-example-bucket',
        s3Directory: 'sitemaps/',
        filenameRoot,
        compress: true,
        siteBaseURL,
      }),
    ).rejects.toThrowError('some weird s3 failure');
  });

  it('counts size correctly - uncompressed', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: false,
      limitBytes: 2418,
      limitCount: 12,
      siteBaseURL: 'https://www.example.com',
    });
    expect(sitemap.full).toBe(false);
    let itemsToWrite = 10;
    for (let i = 1; i <= itemsToWrite; i++) {
      await sitemap.write({
        item: {
          url: `/some/path/${i}`,
          img: [
            {
              url: `/some/img/path${i}`,
              caption: 'some str with multi-byte utf-8 codepoint \u00C1',
            },
          ],
        },
      });
    }
    expect(sitemap.sizeUncompressed).toBe(2349);
    expect(sitemap.full).toBe(false);
    expect(sitemap.items.length).toBe(10);

    // Write another item to make the map full
    await sitemap.write({ item: { url: `/some/path/${++itemsToWrite}` } });
    expect(sitemap.sizeUncompressed).toBe(2418);
    expect(sitemap.full).toBe(true);
    expect(sitemap.items.length).toBe(11);

    // Writing another item should throw due to byte limit
    await expect(async () =>
      sitemap.write({ item: { url: `/some/path/${++itemsToWrite}` } }),
    ).rejects.toThrowError(
      'Cannot write to already full sitemap: 11 of 12 item limit, 2418 bytes of 2418 bytes limit',
    );
    expect(sitemap.sizeUncompressed).toBe(2418);
    expect(sitemap.items.length).toBe(11);

    // Write another item with byte limit disregarded
    await sitemap.write({
      item: { url: `/some/path/${++itemsToWrite}` },
      disregardByteLimit: true,
    });
    expect(sitemap.sizeUncompressed).toBe(2487);
    expect(sitemap.full).toBe(true);
    expect(sitemap.items.length).toBe(12);

    // Writing another item should throw due to count limit
    await expect(async () =>
      sitemap.write({ item: { url: `/some/path/${++itemsToWrite}` }, disregardByteLimit: true }),
    ).rejects.toThrowError(
      'Cannot write to already full sitemap: 12 of 12 item limit, 2487 bytes of 2418 bytes limit',
    );
    expect(sitemap.sizeUncompressed).toBe(2487);
    expect(sitemap.items.length).toBe(12);

    // Write another item with byte limit and count limit disregarded
    await sitemap.write({
      item: { url: `/some/path/${++itemsToWrite}` },
      disregardByteLimit: true,
      disregardCountLimit: true,
    });
    expect(sitemap.sizeUncompressed).toBe(2556);
    expect(sitemap.full).toBe(true);
    expect(sitemap.items.length).toBe(13);

    expect(() => sitemap.sizeUncompressedBytesEmitted).toThrowError(
      'cannot get size of dest stream until closed',
    );
    await sitemap.end();
    expect(sitemap.sizeUncompressedBytesEmitted).toBe(2700);
    expect(sitemap.items.length).toBe(13);

    // At this point the file should be saved

    const fileSize = await fs.stat(filenameBase).then((stat) => stat.size);
    const fileBuff = await fs.readFile(filenameBase);
    const fileStr = fileBuff.toString();

    // The real size field should be exactly correct
    expect(sitemap.sizeUncompressedBytesEmitted).toBe(fileSize);

    // Our length approximation should be approximately correct
    expect(sitemap.sizeUncompressed).toBeGreaterThan(fileStr.length * 0.75);
    expect(sitemap.sizeUncompressed).toBeLessThan(fileStr.length * 1.25);

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 1000)).toMatchSnapshot();
  });

  it('counts size correctly - compressed', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: true,
      limitBytes: 2418,
      siteBaseURL: 'https://www.example.com',
    });
    expect(sitemap.full).toBe(false);
    let itemsToWrite = 10;
    for (let i = 1; i <= itemsToWrite; i++) {
      await sitemap.write({
        item: {
          url: `/some/path/${i}`,
          img: [
            {
              url: `/some/img/path${i}`,
              caption: 'some str with multi-byte utf-8 codepoint \u00C1',
            },
          ],
        },
      });
    }
    expect(sitemap.sizeUncompressed).toBe(2349);
    expect(sitemap.full).toBe(false);

    // Write another item to make the map full
    await sitemap.write({ item: { url: `/some/path/${++itemsToWrite}` } });
    expect(sitemap.sizeUncompressed).toBe(2418);
    expect(sitemap.full).toBe(true);
    expect(() => sitemap.sizeUncompressedBytesEmitted).toThrowError(
      'cannot get size of dest stream until closed',
    );
    await sitemap.end();
    expect(sitemap.sizeUncompressedBytesEmitted).toBe(2584);

    // At this point the file should be saved

    // Decompress the file manually and check if it's parsable
    const gzBuff = Buffer.from(await fs.readFile(filenameGz));
    const ungzBuff = await gunzipAsync(gzBuff);
    const fileStr = ungzBuff.toString('utf-8');

    // The real size field should be exactly correct
    expect(sitemap.sizeUncompressedBytesEmitted).toBe(ungzBuff.length);

    // Our length approximation should be approximately correct
    expect(sitemap.sizeUncompressed).toBeGreaterThan(fileStr.length * 0.75);
    expect(sitemap.sizeUncompressed).toBeLessThan(fileStr.length * 1.25);

    expect(fileStr).toBeDefined();
    expect(fileStr.slice(0, 1000)).toMatchSnapshot();
  });

  it('full indication - item count', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: true,
      limitCount: 10,
      siteBaseURL: 'https://www.example.com',
    });
    expect(sitemap.full).toBe(false);
    let itemsToWrite = 10;
    for (let i = 1; i <= itemsToWrite - 1; i++) {
      await sitemap.write({ item: { url: `/some/path/${i}` } });
      expect(sitemap.full).toBe(false);
    }
    await sitemap.write({ item: { url: `/some/path/${itemsToWrite}` } });
    expect(sitemap.sizeUncompressed).toBe(1017);
    expect(sitemap.full).toBe(true);

    // Confirm that writing another item throws after full
    await expect(async () => {
      return sitemap.write({ item: { url: `/some/path/${++itemsToWrite}` } });
    }).rejects.toThrowError(
      'Cannot write to already full sitemap: 10 of 10 item limit, 1017 bytes of 47185920 bytes limit',
    );
    expect(sitemap.sizeUncompressed).toBe(1017);
    expect(sitemap.full).toBe(true);
    await sitemap.end();
  });

  it('full indication - bytes count', async () => {
    const sitemap = new SitemapFileWrapper({
      filenameRoot,
      compress: true,
      limitBytes: 1017,
      siteBaseURL: 'https://www.example.com',
    });
    expect(sitemap.full).toBe(false);
    let itemsToWrite = 10;
    for (let i = 1; i <= itemsToWrite - 1; i++) {
      await sitemap.write({ item: { url: `/some/path/${i}` } });
      expect(sitemap.full).toBe(false);
    }
    await sitemap.write({ item: { url: `/some/path/${itemsToWrite}` } });
    expect(sitemap.sizeUncompressed).toBe(1017);
    expect(sitemap.full).toBe(true);

    // Confirm that writing another item throws after full
    await expect(async () => {
      return sitemap.write({ item: { url: `/some/path/${++itemsToWrite}` } });
    }).rejects.toThrowError(
      'Cannot write to already full sitemap: 10 of 50000 item limit, 1017 bytes of 1017 bytes limit',
    );
    expect(sitemap.sizeUncompressed).toBe(1017);
    expect(sitemap.full).toBe(true);
    await sitemap.end();
  });
});
