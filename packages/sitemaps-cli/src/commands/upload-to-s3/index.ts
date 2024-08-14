/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import path from 'path';
import https from 'https';
// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';
import { Args, Command, Flags } from '@oclif/core';
import {
  SitemapIndexWrapper,
  IndexItem,
  SitemapFileWrapper,
} from '@shutterstock/sitemaps-wrapper-lib';
import { Listr, ListrErrorTypes, ListrTask } from 'listr2';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SitemapType, getSitemapType } from '../../utils/index-or-sitemap';

type PromiseType<T> = T extends Promise<infer U> ? U : T;

const { promises: fs, pathExists, createReadStream } = fsExtra;

const keepAliveOptions = {
  keepAlive: true,
};
if (https !== undefined) {
  https.globalAgent = new https.Agent(keepAliveOptions);
}

interface IIndexItemPair {
  oldItem: IndexItem;
  s3ItemPath?: string;
}

interface IContext {
  indexWasCompressed: boolean;
  items: IIndexItemPair[];
  totalCount: number;
  completedCount: number;
  type: 'index' | 'sitemap';
}

export default class UploadToS3 extends Command {
  static description =
    'Upload local sitemap index and its sitemaps, or a single sitemap, to S3, without modifying the files at all';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> --root-path=./ ./sitemaps/sitemap-index.xml s3://doc-example-bucket`,
    `$ <%= config.bin %> <%= command.id %> ./sitemaps/sitemap1.xml s3://doc-example-bucket`,
  ];

  static args = {
    file: Args.file({
      required: true,
      exists: true,
      description: 'file path of sitemap or sitemap index',
    }),
    's3-bucket': Args.url({
      required: true,
      description: 'S3 Bucket to upload to',
    }),
  };

  static flags = {
    overwrite: Flags.boolean({
      char: 'o',
      description: 'Overwrite existing files',
      default: false,
    }),
    'root-path': Flags.directory({
      char: 'r',
      description:
        'Local path at which the sitemaps can be found using their path in the index file (e.g. `https://www.example.com/sitemaps/widget/sitemap-00001.xml` in the index file would need `rootPath` to point to a local directory containing `sitemaps/widget/` folders',
      multiple: false,
      exists: true,
      default: './',
    }),
  };

  async run(): Promise<void> {
    let parseResult: PromiseType<ReturnType<typeof this.parse>>;
    try {
      parseResult = await this.parse(UploadToS3);
    } catch (error: any) {
      this.error(error.message);
    }
    const { args, flags: parsedFlags } = parseResult;

    const s3Client = new S3Client({
      maxAttempts: 16,
    });

    /**
     * Example: ./sitemaps/sitemap1.xml
     * Example: /Users/someuser/sitemaps/sitemap1.xml
     */
    const fileAndPath = args.file;
    if (fileAndPath === undefined) {
      this.error('No file specified');
    }
    const basePath = path.dirname(fileAndPath);

    const tasks = new Listr<IContext>(
      [
        {
          title: 'Confirm Local Index / Sitemap File Exists, Determine Type',
          task: async (ctx: IContext, task) => {
            const type = await getSitemapType(fileAndPath);
            if (type === undefined) {
              this.error(`file was not a valid sitemap or index file`);
            }

            if (type === SitemapType.Index) {
              ctx.type = 'index';
            } else if (type === SitemapType.Sitemap) {
              ctx.type = 'sitemap';
            }

            task.output = `Detected '${ctx.type}' file at ${args.file}`;
          },
          options: { persistentOutput: true },
        },
        {
          title: 'Validate Index Options',
          enabled: (ctx: IContext) => ctx.type === 'index',
          task: (ctx: IContext, task) => {
            if (!parsedFlags['root-path']) {
              task.output = 'Root path is required for index files';
              task.report(
                new Error('Root path is required for index files'),
                ListrErrorTypes.HAS_FAILED,
              );
            }
          },
        },
        {
          enabled: (ctx: IContext) => ctx.type === 'index',
          title: 'Parse Index File / Discover Linked Sitemaps',
          task: async (ctx: IContext) => {
            // Load the Sitemap Index
            const { items } = await SitemapIndexWrapper.itemsFromFile({
              sourceFileAndPath: fileAndPath,
            });

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
          enabled: (ctx: IContext) => ctx.type === 'sitemap',
          title: 'Parse Sitemap File - Validate',
          task: async (ctx: IContext, task) => {
            // Load the Sitemap
            await SitemapFileWrapper.fromFile({
              sourceFileAndPath: fileAndPath,
              bucketName: '',
              siteBaseURL: 'https://www.example.com/',
            });

            task.output = `Confirmed sitemap file parses: ${args.file}`;
          },
          options: { persistentOutput: true },
        },
        // {
        //   title: 'Confirm Upload',
        //   task: async (ctx: IContext, task) => {
        //     task.output = `Uploading to ${args['s3-bucket'].hostname}`;
        //     // Confirm with user
        //     const message = `Upload the file \`${fileAndPath}\` to the S3 bucket \`${args['s3-bucket'].hostname}\``;

        //     // Confirm with user if the test URL was provided and captured a value
        //     const confirm = await task.prompt({
        //       choices: ['y', 'n'],
        //       correctChoice: 'y',
        //       message,
        //       type: 'confirm',
        //     });
        //     if (!confirm) {
        //       task.output = `Cancelled upload to ${args['s3-bucket'].hostname}`;
        //       this.error('user cancelled');
        //     }
        //   },
        // },
        {
          title: 'Upload Index / Sitemap File',
          task: async (ctx: IContext, task) => {
            task.output = `${fileAndPath}`;
            // Put the file to S3
            await s3Client.send(
              new PutObjectCommand({
                Bucket: args['s3-bucket'].hostname,
                // FIXME: If the path to the index is absolute or includes `..`
                // then we must remove the path from the root path
                Key: fileAndPath,
                Body: createReadStream(fileAndPath),
                ContentType: 'application/xml',
                ...(fileAndPath.endsWith('.gz') ? { ContentEncoding: 'gzip' } : {}),
                // TODO: Make the cache-control header configurable for the index
                CacheControl: `max-age=${4 * 60 * 60}; public`,
              }),
            );
          },
          options: { persistentOutput: true },
        },
        {
          enabled: (ctx: IContext) => ctx.type === 'index',
          title: 'Uploading Sitemap Files',
          options: { bottomBar: 16, persistentOutput: true, showTimer: true },
          task: (ctx: IContext, task): Listr => {
            const sitemapTasks: ListrTask<IContext>[] = ctx.items.map((itemPair) => ({
              task: async (ctx: IContext, subtask) => {
                const { oldItem } = itemPair;
                const titlePrefix = oldItem.url.slice(
                  Math.max(0, oldItem.url.length - 50),
                  oldItem.url.length,
                );

                task.output = `${titlePrefix} [uploading]`;

                const url = new URL(oldItem.url);
                const pathToSitemap = path.join(parsedFlags['root-path'] as string, url.pathname);

                itemPair.s3ItemPath = pathToSitemap;

                // Stat the file to get the length
                if (!(await pathExists(pathToSitemap))) {
                  task.output = `${titlePrefix} [failedexists]`;
                  subtask.title = `${titlePrefix} [failedexists]`;

                  task.report(
                    new Error(`sitemap does not exist: ${pathToSitemap}`),
                    ListrErrorTypes.HAS_FAILED,
                  );
                }
                const stats = await fs.stat(pathToSitemap);
                const length = stats.size;

                // Check if item is on S3 and has the correct content length already
                try {
                  const headResponse = await s3Client.send(
                    new HeadObjectCommand({
                      Bucket: args['s3-bucket'].hostname,
                      Key: itemPair.s3ItemPath,
                    }),
                  );

                  if (
                    headResponse.ContentLength !== undefined &&
                    headResponse.ContentLength === length &&
                    parsedFlags['overwrite'] !== true
                  ) {
                    ctx.completedCount++;

                    // We already have this file uploaded to S3, skip it
                    task.output = `${titlePrefix} [alreadydone] [${ctx.completedCount}/${ctx.totalCount}]`;
                    return;
                  }
                } catch (error: any) {
                  task.output = `${titlePrefix} [faileds3head] - ${error.name}, ${error.message}`;

                  // This is ok, fall through
                }

                // Fetch the file and save it to the current directory
                const filePath = itemPair.s3ItemPath;
                const fileLocal = path.join('.', filePath);

                // Put the file to S3
                try {
                  await s3Client.send(
                    new PutObjectCommand({
                      Bucket: args['s3-bucket'].hostname,
                      Key: itemPair.s3ItemPath,
                      Body: createReadStream(fileLocal),
                      // FIXME: Make the cache-control header configurable for the sitemaps
                      CacheControl: `max-age=${30 * 24 * 60 * 60}; public`,
                      ContentType: 'application/xml',
                      ...(itemPair.s3ItemPath.endsWith('.gz') ? { ContentEncoding: 'gzip' } : {}),
                    }),
                  );
                } catch (error: any) {
                  task.output = `${titlePrefix} [faileds3] - ${error.name}, ${error.message}`;
                  subtask.title = `${titlePrefix} [faileds3] - ${error.name}, ${error.message}`;

                  task.report(error, ListrErrorTypes.HAS_FAILED);

                  return;
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
