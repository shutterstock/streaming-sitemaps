/// <reference types="jest" />
import fs from 'fs/promises';
import nativeFS from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import nock from 'nock';
import fetch, { Response } from 'node-fetch';
import { Readable } from 'stream';
import * as lambda from '@aws-sdk/client-lambda';
import * as kinesis from '@aws-sdk/client-kinesis';
import { mockClient } from 'aws-sdk-client-mock';
import Convert from '../../src/commands/convert';
import CSV from '../../src/commands/create/from-csv';
import Freshen from '../../src/commands/freshen';

jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return { ...actual, __esModule: true, default: jest.fn(actual) };
});

const cliRoot = path.resolve(__dirname, '../..');
const sitemapXML =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a?a=1&amp;b=2</loc></url></urlset>';

function payload(text: string) {
  return Object.assign(Buffer.from(text), { transformToString: () => text });
}

describe('source CLI behavior without cloud calls', () => {
  let directory: string;
  const cwd = process.cwd();
  const renderer = process.env.LISTR_RENDERER;
  let exitCode: typeof process.exitCode;
  beforeEach(async () => {
    exitCode = process.exitCode;
    process.env.LISTR_RENDERER = 'silent';
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sitemap-cli-behavior-'));
    process.chdir(directory);
    nock.disableNetConnect();
  });
  afterEach(async () => {
    process.exitCode = exitCode;
    process.chdir(cwd);
    if (renderer === undefined) delete process.env.LISTR_RENDERER;
    else process.env.LISTR_RENDERER = renderer;
    nock.cleanAll();
    nock.enableNetConnect();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each([false, true])(
    'converts local XML to escaped JSON lines offline (gzip=%s)',
    async (compressed) => {
      const filename = path.join(directory, compressed ? 'input.xml.gz' : 'input.xml');
      await fs.writeFile(filename, compressed ? zlib.gzipSync(sitemapXML) : sitemapXML);
      await Convert.run([filename], cliRoot);
      const output = await fs.readFile(path.join(directory, 'input.jsonl'), 'utf8');
      expect(
        output
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toEqual([{ url: 'https://example.com/a?a=1&b=2' }]);
      expect(nock.pendingMocks()).toEqual([]);
    },
  );

  it('preserves a local input without an XML suffix and writes a separate JSONL file', async () => {
    await fs.writeFile('source.data', sitemapXML);
    await Convert.run(['source.data'], cliRoot);
    expect(await fs.readFile('source.data', 'utf8')).toBe(sitemapXML);
    const output = await fs.readFile('source.data.jsonl', 'utf8');
    expect(JSON.parse(output.trim())).toEqual({ url: 'https://example.com/a?a=1&b=2' });
  });

  it('rejects a missing input before creating output', async () => {
    await expect(Convert.run(['missing.xml'], cliRoot)).rejects.toThrow('ENOTFOUND');
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rejects invalid type parsing before opening an input', async () => {
    await expect(Convert.run(['--type=guess', 'missing.xml'], cliRoot)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rejects corrupt gzip and removes its partial output', async () => {
    await fs.writeFile('bad.xml.gz', 'not gzip');
    await expect(Convert.run(['bad.xml.gz'], cliRoot)).rejects.toThrow('incorrect header');
    expect(await fs.readdir(directory)).toEqual(['bad.xml.gz']);
  });

  it('preserves an existing destination when opening it fails', async () => {
    const previousOutput = 'previous conversion\n';
    await fs.writeFile('input.xml', sitemapXML);
    await fs.writeFile('input.jsonl', previousOutput);
    await fs.chmod('input.jsonl', 0o444);
    const failure = Object.assign(new Error('EACCES: permission denied, open input.jsonl'), {
      code: 'EACCES',
    });
    const originalOpen = nativeFS.open;
    // Inject the OS error at the actual output-open boundary so this is
    // deterministic even when the tests run with elevated filesystem access.
    const opening = jest.spyOn(nativeFS, 'open').mockImplementation((filename, flags, ...rest) => {
      if (filename === 'input.jsonl') {
        const callback = rest[rest.length - 1] as (
          error: NodeJS.ErrnoException | null,
          fd: number,
        ) => void;
        queueMicrotask(() => callback(failure, -1));
      } else originalOpen(filename, flags, ...rest);
    });
    try {
      await expect(Convert.run(['input.xml'], cliRoot)).rejects.toThrow('EACCES');
    } finally {
      opening.mockRestore();
    }
    expect(await fs.readFile('input.jsonl', 'utf8')).toBe(previousOutput);
    expect(await fs.readdir(directory)).toEqual(['input.jsonl', 'input.xml']);
  });

  it('rejects the wrong XML type and removes misleading output', async () => {
    await fs.writeFile(
      'index.xml',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/one.xml</loc></sitemap></sitemapindex>',
    );
    await expect(Convert.run(['index.xml'], cliRoot)).rejects.toThrow(
      'unhandled attr sitemapindex',
    );
    expect(await fs.readdir(directory)).toEqual(['index.xml']);
  });

  it('reports the HTTP status before attempting conversion', async () => {
    const request = nock('https://example.com').get('/failed.xml').reply(503, 'unavailable');
    await expect(Convert.run(['https://example.com/failed.xml'], cliRoot)).rejects.toThrow(
      'sitemap download failed: 503',
    );
    expect(request.isDone()).toBe(true);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('propagates a response-body failure and closes the conversion pipeline', async () => {
    const response = new Readable({
      read() {
        this.destroy(new Error('body interrupted'));
      },
    });
    jest.mocked(fetch).mockResolvedValueOnce(new Response(response, { status: 200 }));
    await expect(Convert.run(['https://example.com/interrupted.xml'], cliRoot)).rejects.toThrow(
      'body interrupted',
    );
    expect(response.destroyed).toBe(true);
    await expect(fs.stat(path.join(directory, 'interrupted.jsonl'))).rejects.toThrow('ENOENT');
  });

  it('creates UTF-8 CSV sitemap files offline with a BOM and percent escaping', async () => {
    await fs.writeFile('data.csv', '\uFEFFkeywords\n"café & cats"\n"50% off"\n');
    await CSV.run(
      [
        '--column=keywords',
        '--escape-percent',
        'data.csv',
        'https://example.com/sitemaps/',
        'https://example.com/search/',
        './output',
        'index.xml.gz',
      ],
      cliRoot,
    );
    const index = zlib.gunzipSync(await fs.readFile('output/index.xml.gz')).toString();
    const sitemap = zlib
      .gunzipSync(await fs.readFile('output/sitemaps/sitemap-00001.xml.gz'))
      .toString();
    expect(index).toContain('https://example.com/sitemaps/sitemap-00001.xml.gz');
    expect(sitemap).toContain('caf%C3%A9%20&amp;%20cats');
    expect(sitemap).toContain('50%25%20off');
  });

  it('keeps dry-run defaults in an explicit Lambda request', async () => {
    const client = mockClient(lambda.LambdaClient);
    client.on(lambda.InvokeCommand).resolves({
      $metadata: { httpStatusCode: 200 },
      Payload: payload('[{"filesWritten":0}]'),
    });
    try {
      await Freshen.run(['--function-name=unused', '--yes'], cliRoot);
      const input = client.commandCalls(lambda.InvokeCommand)[0].args[0].input;
      expect(JSON.parse(Buffer.from(input.Payload as Uint8Array).toString())).toEqual({
        Records: [{ operation: 'start', repairDB: false, dryRun: true, dryRunDB: true }],
      });
    } finally {
      client.restore();
    }
  });

  it('rejects invalid repair regex before making a Lambda request', async () => {
    const client = mockClient(lambda.LambdaClient);
    try {
      await expect(
        Freshen.run(
          ['--function-name=unused', '--yes', '--repair-db', '--itemid-regex=bogus'],
          cliRoot,
        ),
      ).rejects.toThrow('placeholder');
      expect(client.calls()).toHaveLength(0);
    } finally {
      client.restore();
    }
  });

  it('rejects Lambda function errors even when the invocation has HTTP 200', async () => {
    const client = mockClient(lambda.LambdaClient);
    client.on(lambda.InvokeCommand).resolves({
      $metadata: { httpStatusCode: 200 },
      FunctionError: 'Unhandled',
      Payload: payload('[{"filesWritten":0}]'),
    });
    try {
      await expect(Freshen.run(['--function-name=unused', '--yes'], cliRoot)).rejects.toThrow(
        'Lambda function returned an error (Unhandled)',
      );
    } finally {
      client.restore();
    }
  });

  it('sends explicit write permissions with a freshenFile Kinesis request', async () => {
    const client = mockClient(kinesis.KinesisClient);
    client.on(kinesis.PutRecordCommand).resolves({});
    try {
      await Freshen.run(
        [
          '--stream-name=unused',
          '--filename=one.xml',
          '--table-item-type=widget',
          '--no-dry-run',
          '--no-dry-run-db',
          '--yes',
        ],
        cliRoot,
      );
      const input = client.commandCalls(kinesis.PutRecordCommand)[0].args[0].input;
      expect(JSON.parse(Buffer.from(input.Data!).toString())).toEqual({
        operation: 'freshenFile',
        repairDB: false,
        type: 'widget',
        dryRun: false,
        dryRunDB: false,
        filename: 'one.xml',
      });
    } finally {
      client.restore();
    }
  });
});
