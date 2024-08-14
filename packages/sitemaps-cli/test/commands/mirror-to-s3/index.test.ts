import { test } from '@oclif/test';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { promisify } from 'util';
import { finished } from 'stream';
import fs from 'fs';
import nock from 'nock';

const finishedAsync = promisify(finished);

describe('mirror-to-s3', () => {
  const originalCwd: string = process.cwd();
  let s3Client: AwsClientStub<s3.S3Client>;

  beforeEach(() => {
    s3Client = mockClient(s3.S3Client);

    process.chdir(__dirname);

    fs.rmSync(`${__dirname}/data/`, { recursive: true, force: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // fs.rmSync(`${__dirname}/data/`, { recursive: true, force: true });
  });

  test
    .stdout()
    .stderr()
    .command(['mirror-to-s3', '--type=guess'])
    .exit(2)
    .it('fails if type is invalid', (ctx) => {
      expect(ctx.stdout).toEqual('');
    });

  test
    .stdout()
    .stderr()
    .do(() => {
      // Mock the network request
      nock('http://www.example.com').get('/data/dummy.xml').reply(404);
    })
    .command(['mirror-to-s3', 'http://www.example.com/data/dummy.xml', 's3://doc-example-bucket'])
    .exit(2)
    .it('fails if url gives a 404', (ctx) => {
      expect(ctx.stdout).toContain(
        '✖ Downloading Index File: Failed to download the index file (http://www.example.com/data/dummy.xml): 404',
      );
    });

  test
    .stdout()
    .stderr()
    .do(() => {
      // Mock the network request
      nock('http://www.example.com')
        .get('/data/index.xml')
        .reply(200, () => fs.createReadStream(`${__dirname}/../../data/index.xml`))
        .head('/data/sitemap1.xml.gz')
        .reply(200, '', {
          'content-encoding': 'gzip',
          'content-type': 'application/xml',
          'content-length': '1234',
        })
        .get('/data/sitemap1.xml.gz')
        .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`), {
          'content-encoding': 'gzip',
          'content-type': 'application/xml',
        })
        .head('/data/sitemap2.xml.gz')
        .reply(200, '', {
          'content-encoding': 'gzip',
          'content-type': 'application/xml',
          'content-length': '1234',
        })
        .get('/data/sitemap2.xml.gz')
        .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`), {
          'content-encoding': 'gzip',
          'content-type': 'application/xml',
        });

      // Create file write stream for the sitemap files
      fs.mkdirSync(`${__dirname}/data/s3/sitemaps/`, { recursive: true });
      const indexStream = fs.createWriteStream(`${__dirname}/data/s3/index.xml`);
      const sitemap1Stream = fs.createWriteStream(`${__dirname}/data/s3/sitemaps/sitemap1.xml`);
      const sitemap2Stream = fs.createWriteStream(`${__dirname}/data/s3/sitemaps/sitemap2.xml`);

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
            Key: 'data/sitemaps/sitemap1.xml',
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
            Key: 'data/sitemaps/sitemap1.xml',
            CacheControl: 'max-age=2592000; public',
            ContentType: 'application/xml',
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
            Key: 'data/sitemaps/sitemap2.xml',
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
            Key: 'data/sitemaps/sitemap2.xml',
            CacheControl: 'max-age=2592000; public',
            ContentType: 'application/xml',
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
    .command(['mirror-to-s3', 'http://www.example.com/data/index.xml', 's3://doc-example-bucket'])
    .it('mirrors file while decompressing and breaking file links', (ctx) => {
      expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
      expect(ctx.stdout).toContain('✔ Downloading Index File');
      expect(ctx.stdout).toContain('✔ Mirroring Sitemap Files');

      // Validate the index file
      const output = fs.readFileSync(`${__dirname}/data/s3/index.xml`, 'utf-8');
      expect(output).toContain('http://www.example.com/data/sitemaps/sitemap1.xml');
      expect(output).not.toContain('http://www.example.com/data/sitemaps/sitemap1.xml.gz');
      expect(output).toContain('http://www.example.com/data/sitemaps/sitemap2.xml');
      expect(output).toMatchSnapshot();

      // Validate a decompressed sitemap file
      const sitemap1 = fs.readFileSync(`${__dirname}/data/s3/sitemaps/sitemap1.xml`, 'utf-8');
      expect(sitemap1).toContain('http://www.example.com/foo1.html');
      expect(sitemap1).toContain('http://www.example.com/bar1.html');
      expect(sitemap1).toMatchSnapshot();
    });

  test
    .stdout()
    .stderr()
    .do(() => {
      // Mock the network request
      nock('http://www.example.com')
        .get('/data/sitemap.xml')
        .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap.xml`));
    })
    .command(['mirror-to-s3', 'http://www.example.com/data/sitemap.xml', 's3://doc-example-bucket'])
    .exit(2)
    .it('reads file but has errors if the URL contains no links to sitemaps', (ctx) => {
      expect(ctx.stdout).toContain('unhandled attr urlset xmlns');
    });
});
