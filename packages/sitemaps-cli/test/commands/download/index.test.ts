import { test } from '@oclif/test';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import fs from 'fs';
import nock from 'nock';
import zlib from 'zlib';

describe('download', () => {
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

  describe('http source', () => {
    test
      .stdout()
      .stderr()
      .command(['download', '--type=guess'])
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
      .command(['download', 'http://www.example.com/data/dummy.xml'])
      .exit(2)
      .it('fails if url gives a', (ctx) => {
        expect(ctx.stdout).toContain(
          '✖ Downloading Sitemap Files: sitemap failed request: 404, http://www.example.com/data/dummy.xml',
        );
      });

    test
      .stdout()
      .stderr()
      .do(() => {
        // Mock the network request
        nock('http://www.example.com')
          .get('/data/index.xml')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/index.xml`));
      })
      .command(['download', `http://www.example.com/data/index.xml`])
      .it(
        'reads file but fails to get sitemap files if file is index but type flag is sitemap',
        (ctx) => {
          // We don't get error messages because we do not parse unless
          // we are transforming to JSONL
          // expect(ctx.stdout).toContain('unhandled attr sitemapindex xmlns');
          expect(ctx.stdout).toContain('✔ Downloading Sitemap Files');

          // Confirm sitemap files do not exist
          expect(fs.existsSync(`${__dirname}/data/sitemap1.xml`)).toBe(false);
          expect(fs.existsSync(`${__dirname}/data/sitemap2.xml`)).toBe(false);
        },
      );

    test
      .stdout()
      .stderr()
      .do(() => {
        // Mock the network request
        nock('http://www.example.com')
          .get('/data/index.xml')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/index.xml`));
      })
      .command(['download', '--extra-format=jsonl', 'http://www.example.com/data/index.xml'])
      .it(
        'reads file but gives error when adding jsonl output, file is index but type flag is sitemap',
        (ctx) => {
          // We don't get error messages because we do not parse unless
          // we are transforming to JSONL
          expect(ctx.stdout).toContain('unhandled attr sitemapindex xmlns');
          expect(ctx.stdout).toContain('✔ Downloading Sitemap Files');

          // Confirm sitemap files do not exist
          expect(fs.existsSync(`${__dirname}/data/sitemap1.xml`)).toBe(false);
          expect(fs.existsSync(`${__dirname}/data/sitemap2.xml`)).toBe(false);
        },
      );

    test
      .stdout()
      .stderr()
      .do(() => {
        // Mock the network request
        nock('http://www.example.com')
          .get('/data/index.xml')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/index.xml`))
          .get('/data/sitemap1.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          })
          .get('/data/sitemap2.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          });
      })
      .command(['download', '--type=index', `http://www.example.com/data/index.xml`])
      .it('succeeds downloading index file', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading Index File');
        expect(ctx.stdout).toContain('✔ Downloading Sitemap Files');

        // Validate the index file
        const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
        expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();

        // Validate a compressed sitemap file
        const sitemap1 = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/sitemap1.xml.gz`))
          .toString('utf-8');
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
          .get('/data/index.xml')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/index.xml`), {
            'content-type': 'application/xml',
          })
          .get('/data/sitemap1.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          })
          .get('/data/sitemap2.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          });
      })
      .command([
        'download',
        '--type=index',
        '--extra-format=jsonl',
        `http://www.example.com/data/index.xml`,
      ])
      .it('succeeds downloading uncompressed index file and converting to jsonl', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading Index File');
        expect(ctx.stdout).toContain('✔ Downloading Sitemap Files');

        // Validate the index file
        const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
        expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();

        // Validate a compressed sitemap file
        const sitemap1 = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/sitemap1.xml.gz`))
          .toString('utf-8');
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
          .get('/data/index.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/index.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          })
          .get('/data/sitemap1.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          })
          .get('/data/sitemap2.xml.gz')
          .reply(200, () => fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`), {
            'content-encoding': 'gzip',
            'content-type': 'application/xml',
          });
      })
      .command([
        'download',
        '--type=index',
        '--extra-format=jsonl',
        `http://www.example.com/data/index.xml.gz`,
      ])
      .it('succeeds downloading index gzip file and converting to jsonl', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading Index File');
        expect(ctx.stdout).toContain('✔ Downloading Sitemap Files');

        // Validate the index file
        const output = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/index.xml.gz`))
          .toString('utf-8');
        expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();

        // Validate the index jsonl file
        const index = fs.readFileSync(`${__dirname}/data/index.jsonl`, 'utf-8');
        expect(index).toContain('http://www.example.com/data/sitemap1.xml.gz');
        expect(index).toContain('http://www.example.com/data/sitemap2.xml.gz');
        expect(index).toMatchSnapshot();

        // Validate a decompressed sitemap file
        const sitemap1 = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/sitemap1.xml.gz`))
          .toString('utf-8');
        expect(sitemap1).toContain('http://www.example.com/foo1.html');
        expect(sitemap1).toContain('http://www.example.com/bar1.html');
        expect(sitemap1).toMatchSnapshot();

        // Validate a jsonl sitemap file
        const sitemap1Jsonl = fs.readFileSync(`${__dirname}/data/sitemap1.jsonl`, 'utf-8');
        expect(sitemap1Jsonl).toContain('http://www.example.com/foo1.html');
        expect(sitemap1Jsonl).toContain('http://www.example.com/bar1.html');
        expect(sitemap1Jsonl).toMatchSnapshot();
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
      .command(['download', '--type=index', `http://www.example.com/data/sitemap.xml`])
      .it('reads file but has errors if file is sitemap but type flag is index', (ctx) => {
        expect(ctx.stdout).toContain('unhandled attr urlset xmlns');
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
      .command(['download', '--type=sitemap', `http://www.example.com/data/sitemap.xml`])
      .it('succeeds downloading sitemap file', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr urlset xmlns');
        expect(ctx.stdout).toContain('✔ Downloading Sitemap Files');

        // Validate the output file
        const output = fs.readFileSync(`${__dirname}/data/sitemap.xml`, 'utf-8');
        expect(output).toContain('http://www.example.com/foo.html');
        expect(output).toContain('http://www.example.com/bar.html');
        expect(output).toMatchSnapshot();
      });
  });

  describe('s3 source', () => {
    test
      .stdout()
      .stderr()
      .do(() => {
        s3Client
          .onAnyCommand()
          .callsFake((command) => {
            throw new Error(
              `Unmocked command: ${command.constructor.name}:\n${JSON.stringify(command)}`,
            );
          })
          .on(
            s3.GetObjectCommand,
            {
              Bucket: 'doc-example-bucket',
              Key: 'data/index.xml',
            },
            false,
          )
          .resolves({
            $metadata: {
              httpStatusCode: 200,
            },
            // @ts-expect-error this works
            Body: fs.createReadStream(`${__dirname}/../../data/index.xml`),
            ContentType: 'application/xml',
          })
          .on(
            s3.GetObjectCommand,
            {
              Bucket: 'doc-example-bucket',
              Key: 'data/sitemap1.xml.gz',
            },
            false,
          )
          .resolves({
            $metadata: {
              httpStatusCode: 200,
            },
            // @ts-expect-error this works
            Body: fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`),
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          })
          .on(
            s3.GetObjectCommand,
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
            // @ts-expect-error this works
            Body: fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`),
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          });
      })
      .command(['download', '--type=index', 's3://doc-example-bucket/data/index.xml'])
      .it('succeeds downloading uncompressed index from s3', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading Index File');

        // Validate the output file
        const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
        expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();

        // Validate the compressed sitemap file
        const sitemap1 = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/sitemap1.xml.gz`))
          .toString('utf-8');
        expect(sitemap1).toContain('http://www.example.com/foo1.html');
        expect(sitemap1).toContain('http://www.example.com/bar1.html');
        expect(sitemap1).toMatchSnapshot();
      });

    test
      .stdout()
      .stderr()
      .do(() => {
        s3Client
          .onAnyCommand()
          .callsFake((command) => {
            throw new Error(
              `Unmocked command: ${command.constructor.name}:\n${JSON.stringify(command)}`,
            );
          })
          .on(
            s3.GetObjectCommand,
            {
              Bucket: 'doc-example-bucket',
              Key: 'data/index.xml.gz',
            },
            false,
          )
          .resolves({
            $metadata: {
              httpStatusCode: 200,
            },
            // @ts-expect-error this works
            Body: fs.createReadStream(`${__dirname}/../../data/index.xml.gz`),
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          })
          .on(
            s3.GetObjectCommand,
            {
              Bucket: 'doc-example-bucket',
              Key: 'data/sitemap1.xml.gz',
            },
            false,
          )
          .resolves({
            $metadata: {
              httpStatusCode: 200,
            },
            // @ts-expect-error this works
            Body: fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`),
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          })
          .on(
            s3.GetObjectCommand,
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
            // @ts-expect-error this works
            Body: fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`),
            ContentType: 'application/xml',
            ContentEncoding: 'gzip',
          });
      })
      .command(['download', '--type=index', 's3://doc-example-bucket/data/index.xml.gz'])
      .it('succeeds downloading compressed index from s3', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading Index File');

        // Validate the compressed index file
        const output = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/index.xml.gz`))
          .toString('utf-8');
        expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();

        // Validate a compressed sitemap file
        const sitemap1 = zlib
          .gunzipSync(fs.readFileSync(`${__dirname}/data/sitemap1.xml.gz`))
          .toString('utf-8');
        expect(sitemap1).toContain('http://www.example.com/foo1.html');
        expect(sitemap1).toContain('http://www.example.com/bar1.html');
        expect(sitemap1).toMatchSnapshot();
      });
  });

  test
    .stdout()
    .stderr()
    .do(() => {
      s3Client
        .onAnyCommand()
        .callsFake((command) => {
          throw new Error(
            `Unmocked command: ${command.constructor.name}:\n${JSON.stringify(command)}`,
          );
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/index.xml.gz',
          },
          false,
        )
        .resolves({
          $metadata: {
            httpStatusCode: 200,
          },
          // @ts-expect-error this works
          Body: fs.createReadStream(`${__dirname}/../../data/index.xml.gz`),
          ContentType: 'application/xml',
        })
        .on(
          s3.GetObjectCommand,
          {
            Bucket: 'doc-example-bucket',
            Key: 'data/sitemap1.xml.gz',
          },
          false,
        )
        .resolves({
          $metadata: {
            httpStatusCode: 200,
          },
          // @ts-expect-error this works
          Body: fs.createReadStream(`${__dirname}/../../data/sitemap1.xml.gz`),
          ContentType: 'application/xml',
        })
        .on(
          s3.GetObjectCommand,
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
          // @ts-expect-error this works
          Body: fs.createReadStream(`${__dirname}/../../data/sitemap2.xml.gz`),
          ContentType: 'application/xml',
        });
    })
    .command([
      'download',
      '--type=index',
      '--extra-format=jsonl',
      's3://doc-example-bucket/data/index.xml.gz',
    ])
    .it('succeeds downloading compressed index from s3 without content-encoding header', (ctx) => {
      expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
      expect(ctx.stdout).toContain('✔ Downloading Index File');

      // Validate the compressed index file
      const output = zlib
        .gunzipSync(fs.readFileSync(`${__dirname}/data/index.xml.gz`))
        .toString('utf-8');
      expect(output).toContain('http://www.example.com/data/sitemap1.xml.gz');
      expect(output).toContain('http://www.example.com/data/sitemap2.xml.gz');

      expect(output).toMatchSnapshot();
      // Validate the index jsonl file
      const index = fs.readFileSync(`${__dirname}/data/index.jsonl`, 'utf-8');
      expect(index).toContain('http://www.example.com/data/sitemap1.xml.gz');
      expect(index).toContain('http://www.example.com/data/sitemap2.xml.gz');
      expect(index).toMatchSnapshot();

      // Validate a decompressed sitemap file
      const sitemap1 = zlib
        .gunzipSync(fs.readFileSync(`${__dirname}/data/sitemap1.xml.gz`))
        .toString('utf-8');
      expect(sitemap1).toContain('http://www.example.com/foo1.html');
      expect(sitemap1).toContain('http://www.example.com/bar1.html');
      expect(sitemap1).toMatchSnapshot();

      // Validate a jsonl sitemap file
      const sitemap1Jsonl = fs.readFileSync(`${__dirname}/data/sitemap1.jsonl`, 'utf-8');
      expect(sitemap1Jsonl).toContain('http://www.example.com/foo1.html');
      expect(sitemap1Jsonl).toContain('http://www.example.com/bar1.html');
      expect(sitemap1Jsonl).toMatchSnapshot();
    });
});
