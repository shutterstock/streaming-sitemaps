/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import path from 'path';
import https from 'https';
import zlib from 'zlib';
import { spawn } from 'child_process';
import cloneable from 'cloneable-readable';
// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';
import { finished, Readable } from 'stream';
import { promisify } from 'util';
import fetch, { HeadersInit } from 'node-fetch';
import * as s3 from '@aws-sdk/client-s3';
import { Args, Command, Flags } from '@oclif/core';
import { XMLToSitemapIndexStream } from 'sitemap';
import { Listr, ListrTask } from 'listr2';
import { ErrorLevel, IndexItem, ObjectStreamToJSON, XMLToSitemapItemStream } from 'sitemap';
import { CleanupSitemapItems } from '../../utils/cleanup-sitemap-items';

const { promises: fs, pathExists, createWriteStream } = fsExtra;

const keepAliveOptions = {
  keepAlive: true,
};
if (https !== undefined) {
  https.globalAgent = new https.Agent(keepAliveOptions);
}

const finishedAsync = promisify(finished);

const s3Client = new s3.S3Client({
  maxAttempts: 5,
});

interface IContextDownload {
  indexFileLocal: string;
  urls: string[];
  totalCount: number;
  completedCount: number;
}

const headers: HeadersInit = {
  'User-Agent': '@shutterstock/sitemaps-cli/1.0',
  'Accept-Encoding': 'gzip',
};

export default class Download extends Command {
  static description = `Download sitemap index and all sitemaps linked by a sitemap index
- Emphasis on not changing the source files at all (if they are gzipped, they will be saved gzipped)
- \`s3://\` URLs are supported if AWS credentials are available
- For indices downloaded from S3, the \`http[s]://hostname\` of the individual sitemaps will be replaced with the \`s3://[bucket_name]/\` of the sitemap index when computing the s3 source to download`;

  static examples = [
    `$ <%= config.bin %> <%= command.id %> --type=index https://www.example.com/sitemaps/widgets-sitemap-index.xml`,
    `$ <%= config.bin %> <%= command.id %> --type=index https://www.example.com/sitemaps/widgets-sitemap-index.xml.gz`,
    `$ <%= config.bin %> <%= command.id %> --type=index s3://doc-example-bucket/sitemaps/widgets-sitemap-index.xml`,
    `$ <%= config.bin %> <%= command.id %> --type=index s3://doc-example-bucket/sitemaps/widgets-sitemap-index.xml.gz`,
    `$ <%= config.bin %> <%= command.id %> --extra-output=jsonl https://www.example.com/sitemaps/widgets/sitemap.xml`,
    `$ <%= config.bin %> <%= command.id %> --extra-output=sort.jsonl s3://doc-example-bucket/sitemaps/widgets/sitemap.xml`,
  ];

  static args = {
    's3-or-http-url': Args.url({
      required: true,
      description:
        's3 or HTTP URL of sitemap or sitemap index file, gzipped or not (.xml or .xml.gz)',
    }),
  };

  static flags = {
    type: Flags.option({
      description: 'Is the file a sitemap or a sitemap index',
      options: ['sitemap', 'index'],
      default: 'sitemap',
      multiple: false,
    })(),
    'extra-format': Flags.option({
      options: ['jsonl', 'sort.jsonl'],
      multiple: false,
      description: 'Extra format to output - original file is saved unmodified',
    })(),
  };

  async run(): Promise<void> {
    const { args, flags: parsedFlags } = await this.parse(Download);

    const tasks = new Listr<IContextDownload>(
      [
        {
          enabled: () => parsedFlags.type == 'index' && args['s3-or-http-url'] !== undefined,
          title: 'Downloading Index File',
          task: async (ctx) => {
            // Fetch the index file and save it to the current directory
            const indexFilePath = args['s3-or-http-url']!.pathname;
            const indexFileLocal = path.join('.', indexFilePath);
            const indexFileLocalPath = path.parse(indexFileLocal);
            await fs.mkdir(indexFileLocalPath.dir, { recursive: true });
            const indexFileWS = createWriteStream(indexFileLocal);

            const indexResponse = await fetchS3OrHTTP({
              url: args['s3-or-http-url'] as URL,
            });

            if (indexResponse.statusCode !== 200) {
              return;
            }

            const inputReadable = cloneable(indexResponse.body! as Readable);

            // Save the index file to disk - unmodified
            inputReadable.pipe(indexFileWS);

            // Push file path to context
            ctx.indexFileLocal = indexFileLocal;
            ctx.urls = [];
            ctx.completedCount = 0;

            let uncompressedSource: Readable;
            // Also decode the items in the index file
            if (indexFileLocal.endsWith('.gz') || indexResponse.contentEncoding === 'gzip') {
              uncompressedSource = inputReadable.clone().pipe(zlib.createGunzip());
            } else {
              uncompressedSource = inputReadable.clone();
            }
            const itemStream = cloneable(
              uncompressedSource.pipe(
                new XMLToSitemapIndexStream({
                  // Optional: pass a logger of your own.
                  // by default it uses built in console.log/warn
                  logger: (level, ...message) => {
                    this.log(message.join(' '));
                  },
                  // Optional, passing SILENT overrides logger
                  level: ErrorLevel.WARN,
                  objectMode: true,
                }),
              ),
            );
            itemStream.on('data', (item: IndexItem) => {
              const { hostname, protocol } = args['s3-or-http-url']!;
              if (protocol === 's3:') {
                const itemURL = new URL(item.url);
                itemURL.hostname = hostname;
                ctx.urls.push(itemURL.toString().replace(/^https?:/, 's3:'));
              } else {
                ctx.urls.push(item.url);
              }
            });

            if (
              parsedFlags['extra-format'] === 'jsonl' ||
              parsedFlags['extra-format'] === 'sort.jsonl'
            ) {
              const jsonlFilename = indexFileLocal.replace('.xml', '.jsonl').replace('.gz', '');
              const jsonlFileStream = createWriteStream(jsonlFilename);
              itemStream
                .clone()
                .pipe(new CleanupSitemapItems())
                // convert the object stream to JSON
                .pipe(new ObjectStreamToJSON({ lineSeparated: true }))
                // write the library compatible options to disk
                .pipe(jsonlFileStream);

              await finishedAsync(jsonlFileStream);

              if (parsedFlags['extra-format'] === 'sort.jsonl') {
                // Sort the JSONL file
                const sortFile = createWriteStream(jsonlFilename.replace('.jsonl', '.sort.jsonl'));
                spawn('sort', [jsonlFilename]).stdout.pipe(sortFile);
                await finishedAsync(sortFile);
              }

              await finishedAsync(indexFileWS);
            } else {
              await finishedAsync(itemStream);
              await finishedAsync(indexFileWS);
            }

            ctx.totalCount = ctx.urls.length;
          },
        },
        {
          enabled: () => parsedFlags.type == 'sitemap' && args['s3-or-http-url'] !== undefined,
          title: 'Adding Single Sitemap to List',
          task: (ctx: IContextDownload, task) => {
            task.output = `Adding \`${args['s3-or-http-url']}\``;
            ctx.urls = [args['s3-or-http-url']!.toString()];
            ctx.totalCount = 1;
            ctx.completedCount = 0;
          },
          options: { persistentOutput: true },
        },
        {
          title: 'Downloading Sitemap Files',
          // options: { bottomBar: 16, showTimer: true, persistentOutput: true },
          task: (ctx: IContextDownload, task): Listr => {
            const sitemapTasks: ListrTask<IContextDownload>[] = ctx.urls.map((url) => ({
              //title: item.url.slice(Math.max(0, item.url.length - 50), item.url.length),
              task: async (ctx: IContextDownload, subtask) => {
                const itemURL = new URL(url);
                const titlePrefix = url.slice(Math.max(0, url.length - 50), url.length);

                // Compute file paths
                const filePath = itemURL.pathname;
                const fileLocal = path.join('.', filePath);
                const fileLocalPath = path.parse(fileLocal);
                if (fileLocalPath.dir != '') {
                  await fs.mkdir(fileLocalPath.dir, { recursive: true });
                }

                // Check if file exists on disk
                if (await pathExists(fileLocal)) {
                  // File already exists locally, check the size before fetching
                  task.output = `${titlePrefix} [existsCheckingSize]`;

                  const stats = await fs.stat(fileLocal);

                  const sitemapHeadResponse = await fetchS3OrHTTP({
                    url: itemURL,
                    method: 'HEAD',
                  });
                  if (sitemapHeadResponse.statusCode !== 200) {
                    task.output = `${titlePrefix} [failedhead]`;
                    subtask.title = `${titlePrefix} [failedhead]`;

                    if (args['s3-or-http-url'] !== undefined) {
                      this.error(
                        `sitemap failed HEAD request: ${sitemapHeadResponse.statusCode}, ${url}`,
                      );
                    }
                    return;
                  }
                  const length = sitemapHeadResponse.contentLength;
                  if (length === undefined) {
                    task.output = `${titlePrefix} [failedheadlength]`;
                    subtask.title = `${titlePrefix} [failedheadlength]`;

                    return;
                  }

                  if (stats.size === length) {
                    ctx.completedCount++;

                    // We already have this file locally, skip it
                    task.output = `${titlePrefix} [alreadydone] [${ctx.completedCount}/${ctx.totalCount}]`;
                    // subtask.title = `${titlePrefix} [alreadydone]`;
                    return;
                  }
                }

                task.output = `${titlePrefix} [downloading]`;

                const sitemapResponse = await fetchS3OrHTTP({ url: itemURL });

                if (sitemapResponse.statusCode !== 200) {
                  task.output = `${titlePrefix} [failed]`;
                  subtask.title = `${titlePrefix} [failedNon200]`;

                  if (args['s3-or-http-url'] !== undefined) {
                    this.error(`sitemap failed request: ${sitemapResponse.statusCode}, ${url}`);
                  }
                  return;
                }

                // Fetch the file and save it to the current directory
                const fileWS = createWriteStream(fileLocal);

                const sitemapStream = cloneable(sitemapResponse.body! as Readable);

                // Save the file to disk
                sitemapStream.pipe(fileWS);

                if (
                  parsedFlags['extra-format'] === 'jsonl' ||
                  parsedFlags['extra-format'] === 'sort.jsonl'
                ) {
                  let uncompressedSource: Readable;
                  // Also decode the items in the index file
                  if (fileLocal.endsWith('.gz') || sitemapResponse.contentEncoding === 'gzip') {
                    uncompressedSource = sitemapStream.clone().pipe(zlib.createGunzip());
                  } else {
                    uncompressedSource = sitemapStream.clone();
                  }

                  const jsonlFilename = fileLocal.replace('.xml', '.jsonl').replace('.gz', '');
                  const jsonlFileStream = createWriteStream(jsonlFilename);

                  uncompressedSource
                    .pipe(
                      new XMLToSitemapItemStream({
                        // Optional: pass a logger of your own.
                        // by default it uses built in console.log/warn
                        logger: (level, ...message) => {
                          this.log(message.join(' '));
                        },
                        // Optional, passing SILENT overrides logger
                        level: ErrorLevel.WARN,
                        objectMode: true,
                      }),
                    )
                    .pipe(new CleanupSitemapItems())
                    // convert the object stream to JSON
                    .pipe(new ObjectStreamToJSON({ lineSeparated: true }))
                    // write the library compatible options to disk
                    .pipe(jsonlFileStream);

                  await finishedAsync(jsonlFileStream);

                  if (parsedFlags['extra-format'] === 'sort.jsonl') {
                    // Sort the JSONL file
                    const sortFile = createWriteStream(
                      jsonlFilename.replace('.jsonl', '.sort.jsonl'),
                    );
                    spawn('sort', [jsonlFilename]).stdout.pipe(sortFile);
                    await finishedAsync(sortFile);
                  }
                }

                await finishedAsync(fileWS);

                // task.title = `${titlePrefix} [completed]`;

                ctx.completedCount++;

                task.output = `${titlePrefix} [completed] [${ctx.completedCount}/${ctx.totalCount}]`;
              },
            }));

            return task.newListr(sitemapTasks, {
              concurrent: 8,
              rendererOptions: {
                clearOutput: true,
                showErrorMessage: true,
                showTimer: true,
              },
            });
          },
        },
      ],
      {
        // @ts-expect-error this is present
        renderer: process.env.LISTR_RENDERER ?? 'default',
        rendererOptions: {
          showTimer: true,
        },
      },
    );

    await tasks.run();
  }
}

/**
 * Abstract away fetching a S3 or HTTP URL
 * @param opts
 * @returns
 */
async function fetchS3OrHTTP(opts: { method?: 'HEAD' | 'GET'; url: URL }): Promise<{
  statusCode: number;
  body?: Readable | NodeJS.ReadableStream;
  contentLength?: number;
  contentEncoding?: string;
}> {
  const { method = 'GET', url } = opts;

  if (url.protocol === 's3:') {
    if (method === 'HEAD') {
      try {
        const headResponse = await s3Client.send(
          new s3.HeadObjectCommand({
            Bucket: url.hostname,
            Key: url.pathname.slice(1),
          }),
        );

        return {
          statusCode: headResponse.$metadata.httpStatusCode!,
          contentLength: headResponse.ContentLength,
        };
      } catch (err) {
        if (err instanceof s3.NotFound) {
          return {
            statusCode: 404,
          };
        } else {
          return {
            statusCode: 500,
          };
        }
      }
    } else {
      try {
        const getResponse = await s3Client.send(
          new s3.GetObjectCommand({
            Bucket: url.hostname,
            Key: url.pathname.slice(1),
          }),
        );

        return {
          statusCode: getResponse.$metadata.httpStatusCode!,
          contentLength: getResponse.ContentLength,
          body: getResponse.Body as Readable,
          contentEncoding: getResponse.ContentEncoding,
        };
      } catch (err) {
        if (err instanceof s3.NoSuchKey) {
          return {
            statusCode: 404,
          };
        } else {
          return {
            statusCode: 500,
          };
        }
      }
    }
  } else {
    const result = await fetch(url, {
      method,
      headers,
      timeout: 240000,
      // Do not automagically decompress responses as we want
      // to save the unmodified files to disk
      // We also need consistency with S3, which does not auto decompress either
      compress: false,
    });

    return {
      statusCode: result.status,
      contentLength: result.headers.get('content-length')
        ? parseInt(result.headers.get('content-length')!, 10)
        : undefined,
      body: result.body!,
      contentEncoding: result.headers.get('content-encoding') ?? undefined,
    };
  }
}
