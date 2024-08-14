#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import path from 'path';
import https from 'https';
// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';
import { finished } from 'stream';
import { promisify } from 'util';
import fetch, { HeadersInit, Response } from 'node-fetch';
import { Args, Command, Flags } from '@oclif/core';
import { SitemapIndexWrapper, IndexItem } from '@shutterstock/sitemaps-wrapper-lib';
import { Listr, ListrErrorTypes, ListrTask } from 'listr2';
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const { promises: fs, createWriteStream, createReadStream } = fsExtra;

const keepAliveOptions = {
  keepAlive: true,
};
if (https !== undefined) {
  https.globalAgent = new https.Agent(keepAliveOptions);
}

const finishedAsync = promisify(finished);

interface IIndexItemPair {
  oldItem: IndexItem;
  newItem?: IndexItem;
  s3ItemPath?: string;
}

interface IContextMirrorToS3 {
  indexFileLocal: string;
  indexWasCompressed: boolean;
  items: IIndexItemPair[];
  totalCount: number;
  completedCount: number;
}

export default class MirrorToS3 extends Command {
  static description =
    'Download remote sitemap index, rewrite the URLs in the index, then upload the sitemaps and sitemap index to the s3 Bucket';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> https://www.example.com/sitemaps/sitemap-index.xml s3://doc-example-bucket`,
  ];

  static args = {
    'index-url': Args.url({
      description: 'URL of sitemap index file',
      required: true,
    }),
    's3-bucket-url': Args.url({
      description: 'S3 Bucket to mirror index file to (e.g. s3://doc-example-bucket)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MirrorToS3);
    const { 'index-url': indexURL, 's3-bucket-url': s3BucketURL } = args;
    const s3Bucket = s3BucketURL.host;
    const headers: HeadersInit = {
      'User-Agent': '@shutterstock/sitemaps-cli/1.0',
      'Accept-Encoding': 'gzip',
    };

    const s3Client = new S3Client({
      maxAttempts: 16,
    });

    /**
     * Example: 'https://www.example.com'
     */
    const indexOrigin = indexURL.origin;
    /**
     * Example: /sitemaps/widgets/sitemap/sitemap-widgets-index.xml
     */
    const indexFileAndPath = indexURL.pathname;
    const indexFilePathAndObj = path.parse(indexFileAndPath);
    /**
     * Example: /sitemaps/widgets/sitemap
     */
    const indexFilePathOnly = indexFilePathAndObj.dir;
    /**
     * Example: stock-widgets-00001.xml
     */
    const indexFileNameWithExt = indexFilePathAndObj.base;
    /**
     * Example: stock-widgets-00001
     */
    const indexFileNameRoot = indexFileNameWithExt.replace('.xml', '').replace('.gz', '');
    const indexFileLocal = path.join('.', indexFileAndPath);
    const indexFileLocalPathObj = path.parse(indexFileLocal);

    const tasks = new Listr<IContextMirrorToS3>(
      [
        {
          title: 'Downloading Index File',
          task: async (ctx: IContextMirrorToS3) => {
            // Fetch the index file and save it to the current directory
            await fs.mkdir(indexFileLocalPathObj.dir, { recursive: true });
            const indexFileWS = createWriteStream(indexFileLocal);

            const indexResponse = await fetch(indexURL.toString(), {
              headers,
              timeout: 120000,
            });

            if (indexResponse.status !== 200) {
              this.error(
                `Failed to download the index file (${indexURL.toString()}): ${indexResponse.status}`,
              );
            }

            // Save the index file to disk
            indexResponse.body!.pipe(indexFileWS);
            await finishedAsync(indexFileWS);

            // Push file path to context
            ctx.indexFileLocal = indexFileLocal;
            ctx.indexWasCompressed = indexFileLocal.endsWith('.gz');

            // this.log('finished downloading the index file');
          },
        },
        {
          title: 'Parse Index File',
          task: async (ctx: IContextMirrorToS3) => {
            // Load the Sitemap Index
            const { items } = await SitemapIndexWrapper.itemsFromFile({
              sourceFileAndPath: ctx.indexFileLocal,
            });

            if (items.length === 0) {
              this.error('No items found in the sitemap index');
            }

            const itemPairs = items.map((item) => {
              return {
                oldItem: item,
              };
            });

            ctx.items = itemPairs;
            ctx.totalCount = items.length;
            ctx.completedCount = 0;
          },
        },
        {
          title: 'ReWrite Index File',
          task: async (ctx: IContextMirrorToS3) => {
            const newIndex = new SitemapIndexWrapper({
              compress: ctx.indexWasCompressed,
              filenameRoot: indexFileNameRoot,
              localDirectory: indexFileLocalPathObj.dir,
            });

            for (const itemPair of ctx.items) {
              const { oldItem } = itemPair;

              // Rewrite the path and host
              const itemURL = new URL(oldItem.url);
              const itemFileNameObj = path.parse(itemURL.pathname);
              const itemFileNameWithExt = itemFileNameObj.base.replace('.gz', '');
              const itemFileNameRoot = itemFileNameObj.base.replace(itemFileNameObj.ext, '');

              const newItem = { ...oldItem };
              const sitemapPath = path.join(
                indexFilePathOnly,
                // FIXME: This is adding `sitemaps/` to the path, always
                'sitemaps/',
                `${itemFileNameWithExt}`,
              );
              newItem.url = new URL(sitemapPath, indexOrigin).toString();

              // Make the folder
              await fs.mkdir(path.join('.', indexFilePathOnly, 'sitemaps/'), { recursive: true });

              // Save the new item next to the old item
              itemPair.newItem = newItem;
              itemPair.s3ItemPath = path.relative('/', sitemapPath);

              await newIndex.write({ item: newItem });
            }

            await newIndex.end();

            ctx.completedCount = 0;
          },
        },
        {
          title: 'Upload Index File',
          task: async (ctx: IContextMirrorToS3) => {
            // Put the file to S3
            await s3Client.send(
              new PutObjectCommand({
                Bucket: s3Bucket,
                // FIXME: Use the s3 url as a base
                Key: path.relative('/', indexFileAndPath),
                Body: createReadStream(ctx.indexFileLocal),
                ContentType: 'application/xml',
                ...(indexFileAndPath.endsWith('.gz') ? { ContentEncoding: 'gzip' } : {}),
                // TODO: Make the cache-control header configurable for the index
                CacheControl: `max-age=${4 * 60 * 60}; public`,
              }),
            );

            // Remove the local file
            await fs.unlink(ctx.indexFileLocal);
          },
        },
        {
          title: 'Mirroring Sitemap Files',
          options: { bottomBar: 16, showTimer: true },
          task: (ctx: IContextMirrorToS3, task): Listr => {
            const sitemapTasks: ListrTask<IContextMirrorToS3>[] = ctx.items.map((itemPair) => ({
              task: async (ctx: IContextMirrorToS3, subtask) => {
                const { oldItem } = itemPair;
                const titlePrefix = oldItem.url.slice(
                  Math.max(0, oldItem.url.length - 50),
                  oldItem.url.length,
                );

                task.output = `${titlePrefix} [downloading]`;

                if (itemPair.s3ItemPath === undefined) {
                  this.error(`s3ItemPath was not specified for ${oldItem.url}`);
                }

                const sitemapHeadResponse: Response = await fetch(oldItem.url, {
                  headers,
                  timeout: 240000,
                  method: 'HEAD',
                });
                if (sitemapHeadResponse.status !== 200) {
                  task.output = `${titlePrefix} [failedhead]`;
                  subtask.title = `${titlePrefix} [failedhead]`;

                  task.report(
                    new Error(
                      `sitemap failed HEAD request: ${sitemapHeadResponse.status}, ${oldItem.url}`,
                    ),
                    ListrErrorTypes.HAS_FAILED,
                  );

                  return;
                }
                const lengthStr = sitemapHeadResponse.headers.get('content-length');
                if (lengthStr === null) {
                  task.output = `${titlePrefix} [failedheadlength]`;
                  subtask.title = `${titlePrefix} [failedheadlength]`;

                  task.report(
                    new Error(`sitemap head content-length was null: ${oldItem.url}`),
                    ListrErrorTypes.HAS_FAILED,
                  );

                  return;
                }
                const length = parseInt(lengthStr, 10);

                // Check if item is on S3 and has the correct content length already
                try {
                  const headResponse = await s3Client.send(
                    new HeadObjectCommand({
                      // FIXME: Use the s3 url as a base
                      Bucket: s3Bucket,
                      Key: itemPair.s3ItemPath,
                    }),
                  );

                  if (
                    headResponse.ContentLength !== undefined &&
                    headResponse.ContentLength === length
                  ) {
                    ctx.completedCount++;

                    // We already have this file uploaded to S3, skip it
                    task.output = `${titlePrefix} [alreadydone] [${ctx.completedCount}/${ctx.totalCount}]`;
                    // subtask.title = `${titlePrefix} [alreadydone]`;
                    return;
                  }
                } catch (error: any) {
                  task.output = `${titlePrefix} [faileds3head] - ${error.name}, ${error.message}`;

                  // This is ok, fall through
                }

                const sitemapResponse: Response = await fetch(oldItem.url, {
                  headers,
                  timeout: 240000,
                });

                if (sitemapResponse.status !== 200) {
                  task.output = `${titlePrefix} [failedget]`;
                  subtask.title = `${titlePrefix} [failedget]`;

                  task.report(
                    new Error(
                      `sitemap failed to download: ${sitemapResponse.status}, ${oldItem.url}`,
                    ),
                    ListrErrorTypes.HAS_FAILED,
                  );

                  return;
                }

                // Fetch the file and save it to the current directory
                const filePath = itemPair.s3ItemPath;
                const fileLocal = path.join('.', filePath);
                const fileWS = createWriteStream(fileLocal);

                try {
                  // Save the file to disk
                  sitemapResponse.body!.pipe(fileWS);
                  await finishedAsync(fileWS);
                } catch (error: any) {
                  task.output = `${titlePrefix} [failedstream]`;
                  subtask.title = `${titlePrefix} [failedstream]`;

                  task.report(error, ListrErrorTypes.HAS_FAILED);

                  return;
                }

                const metadata: { [key: string]: string } = {};
                // This gets saved as: x-amz-meta-last-modified
                if (sitemapResponse.headers.has('last-modified')) {
                  metadata['Last-Modified'] = sitemapResponse.headers.get(
                    'last-modified',
                  ) as string;
                }
                // if (sitemapResponse.headers.has('etag')) {
                //   metadata['ETag'] = sitemapResponse.headers.get('etag') as string;
                // }

                const extraInput: Partial<PutObjectCommandInput> = {};
                if (sitemapResponse.headers.has('cache-control')) {
                  extraInput.CacheControl = sitemapResponse.headers.get('cache-control') as string;
                } else {
                  // Default to 30 days of caching
                  extraInput.CacheControl = `max-age=${30 * 24 * 60 * 60}; public`;
                }
                extraInput.ContentType = 'application/xml';
                extraInput.ContentEncoding = indexFileAndPath.endsWith('.gz') ? 'gzip' : undefined;

                // Put the file to S3
                try {
                  await s3Client.send(
                    new PutObjectCommand({
                      // FIXME: Use the s3 url as a base
                      Bucket: s3Bucket,
                      Key: itemPair.s3ItemPath,
                      Body: createReadStream(fileLocal),
                      Metadata: {
                        ...metadata,
                      },
                      ...extraInput,
                    }),
                  );
                } catch (error: any) {
                  task.output = `${titlePrefix} [faileds3] - ${error.name}, ${error.message}`;
                  subtask.title = `${titlePrefix} [faileds3] - ${error.name}, ${error.message}`;

                  task.report(error, ListrErrorTypes.HAS_FAILED);

                  return;
                } finally {
                  // Remove the local file
                  await fs.unlink(fileLocal);
                }

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
                showSubtasks: false,
              },
            });
          },
        },
      ],
      {
        // @ts-expect-error this is present
        renderer: process.env.LISTR_RENDERER ?? 'default',
        rendererOptions: {
          // showSubtasks: false,
        },
      },
    );

    await tasks.run();
  }
}
