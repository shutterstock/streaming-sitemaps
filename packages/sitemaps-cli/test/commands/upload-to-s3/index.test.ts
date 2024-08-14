import { test } from '@oclif/test';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { promisify } from 'util';
import { finished, pipeline, Writable } from 'stream';
import * as zlib from 'zlib';
import fs from 'fs';

const finishedAsync = promisify(finished);
const pipelineAsync = promisify(pipeline);

describe('upload-to-s3', () => {
  const originalCwd: string = process.cwd();
  let s3Client: AwsClientStub<s3.S3Client>;

  beforeEach(() => {
    s3Client = mockClient(s3.S3Client);

    process.chdir(__dirname);

    fs.rmSync(`${__dirname}/data/s3/`, { recursive: true, force: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // fs.rmSync(`${__dirname}/data/`, { recursive: true, force: true });
  });

  test
    .stdout()
    .stderr()
    .command(['upload-to-s3', '--type=guess'])
    .exit(2)
    .it('fails if type is invalid', (ctx) => {
      expect(ctx.stdout).toEqual('');
    });

  test
    .stdout()
    .stderr()
    .command(['upload-to-s3', `${__dirname}/../../data/dummy.xml`, 's3://doc-example-bucket'])
    .exit(2)
    .it('fails if file does not exist', (ctx) => {
      expect(ctx.stdout).toEqual('');
    });

  test
    .stdout()
    .stderr()
    .do(() => {
      // Create file write stream for the sitemap files
      fs.mkdirSync(`${__dirname}/data/s3/`, { recursive: true });
      const indexStream = fs.createWriteStream(`${__dirname}/data/s3/index.xml`);
      const sitemap1Stream = fs.createWriteStream(`${__dirname}/data/s3/sitemap1.xml.gz`);
      const sitemap2Stream = fs.createWriteStream(`${__dirname}/data/s3/sitemap2.xml.gz`);

      s3Client
        .onAnyCommand()
        .callsFake((command) => {
          throw new Error(
            `Unmocked command: ${command.constructor.name}:\n${JSON.stringify(command)}`,
          );
        })
        .on(
          s3.PutObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/index.xml',
            CacheControl: 'max-age=14400; public',
            ContentType: 'application/xml',
          },
          false,
        )
        .callsFake(async (input) => {
          input.Body.pipe(indexStream);
          await finishedAsync(indexStream);

          return Promise.resolve({
            $metadata: {
              httpStatusCode: 200,
            },
          });
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/sitemap1.xml.gz',
          },
          false,
        )
        .resolves({
          $metadata: {
            httpStatusCode: 404,
          },
        })
        .on(
          s3.PutObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/sitemap1.xml.gz',
            CacheControl: 'max-age=2592000; public',
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          },
          false,
        )
        .callsFake(async (input) => {
          input.Body.pipe(sitemap1Stream);
          await finishedAsync(sitemap1Stream);

          return Promise.resolve({
            $metadata: {
              httpStatusCode: 200,
            },
          });
        })
        .on(
          s3.HeadObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/sitemap2.xml.gz',
          },
          false,
        )
        .resolves({
          $metadata: {
            httpStatusCode: 200,
          },
        })
        .on(
          s3.PutObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/sitemap2.xml.gz',
            CacheControl: 'max-age=2592000; public',
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          },
          false,
        )
        .callsFake(async (input) => {
          input.Body.pipe(sitemap2Stream);
          await finishedAsync(sitemap2Stream);
          return Promise.resolve({
            $metadata: {
              httpStatusCode: 200,
            },
          });
        });
    })
    .command(['upload-to-s3', `data/index.xml`, 's3://doc-example-bucket'])
    .it('uploads locale files without modification', async (ctx) => {
      expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
      expect(ctx.stdout).toContain('✔ Parse Index File / Discover Linked Sitemaps');
      expect(ctx.stdout).toContain('✔ Upload Index / Sitemap File');

      // Validate the index file
      const output = fs.readFileSync(`${__dirname}/data/s3/index.xml`, 'utf-8');
      expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
      expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');
      expect(output).toMatchSnapshot();

      // Validate a decompressed sitemap file
      const gunzip = zlib.createGunzip();
      const reader = fs.createReadStream(`${__dirname}/data/s3/sitemap1.xml.gz`);
      let sitemap1 = '';
      await pipelineAsync(
        reader,
        gunzip,
        new Writable({
          write(chunk, encoding, callback) {
            sitemap1 += chunk.toString();
            callback();
          },
        }),
      );
      expect(sitemap1).toContain('http://www.example.com/foo1.html');
      expect(sitemap1).toContain('http://www.example.com/bar1.html');
      expect(sitemap1).toMatchSnapshot();
    });

  test
    .stdout()
    .stderr()
    .do(() => {
      // Create file write stream for the sitemap files
      fs.mkdirSync(`${__dirname}/data/s3/`, { recursive: true });
      const sitemapStream = fs.createWriteStream(`${__dirname}/data/s3/sitemap.xml.gz`);

      s3Client
        .onAnyCommand()
        .callsFake((command) => {
          throw new Error(
            `Unmocked command: ${command.constructor.name}:\n${JSON.stringify(command)}`,
          );
        })
        .on(
          s3.PutObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/sitemap1.xml.gz',
            CacheControl: 'max-age=14400; public',
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          },
          false,
        )
        .callsFake(async (input) => {
          input.Body.pipe(sitemapStream);
          await finishedAsync(sitemapStream);

          return Promise.resolve({
            $metadata: {
              httpStatusCode: 200,
            },
          });
        });
    })
    .command(['upload-to-s3', 'data/sitemap1.xml.gz', 's3://doc-example-bucket'])
    .it('uploads a single sitemap file', (ctx) => {
      expect(ctx.stdout).toContain("› Detected 'sitemap' file at data/sitemap1.xml.gz");
      expect(ctx.stdout).toContain('✔ Confirm Local Index / Sitemap File Exists, Determine Type');
      expect(ctx.stdout).toContain('✔ Upload Index / Sitemap File');
    });
});
