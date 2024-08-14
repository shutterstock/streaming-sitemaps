/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import zlib from 'zlib';
import path from 'path';
import https from 'https';
// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';
import { finished } from 'stream';
import { promisify } from 'util';
import fetch, { HeadersInit } from 'node-fetch';
import { Args, Command, Flags } from '@oclif/core';
import { Listr, ListrErrorTypes } from 'listr2';
import {
  ErrorLevel,
  ObjectStreamToJSON,
  XMLToSitemapItemStream,
  XMLToSitemapIndexStream,
} from 'sitemap';
import { CleanupSitemapItems } from '../../utils/cleanup-sitemap-items';
import { getUrlOrFilePath } from '../../utils/file-or-url';

const { promises: fs, createWriteStream, createReadStream } = fsExtra;

const keepAliveOptions = {
  keepAlive: true,
};
if (https !== undefined) {
  https.globalAgent = new https.Agent(keepAliveOptions);
}

const finishedAsync = promisify(finished);

interface IContextConvert {
  inputStream: NodeJS.ReadableStream;
  filePath: string;
}

export default class Convert extends Command {
  static description =
    'Convert a sitemap or sitemap index to JSON lines to make it easier to process with tools and editors';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> --type index https://www.example.com/sitemaps/sitemap-index.xml`,
    `$ <%= config.bin %> <%= command.id %> --type index https://www.example.com/sitemaps/sitemap-index.xml.gz`,
    `$ <%= config.bin %> <%= command.id %> --type index sitemaps/sitemap-index.xml`,
    `$ <%= config.bin %> <%= command.id %> --type sitemap https://www.example.com/sitemaps/sitemap.xml`,
    `$ <%= config.bin %> <%= command.id %> --type sitemap sitemaps/sitemap.xml`,
    `$ <%= config.bin %> <%= command.id %> --type sitemap sitemaps/sitemap.xml.gz`,
  ];

  static args = {
    'url-or-file': Args.string({
      required: true,
      description: 'URL or file path of sitemap or sitemap index, gzipped or not (.xml or .xml.gz)',
    }),
  };

  static flags = {
    type: Flags.option({
      description: 'Is the file a sitemap or a sitemap index',
      options: ['sitemap', 'index'],
      default: 'sitemap',
      multiple: false,
    })(),
  };

  async run(): Promise<void> {
    const { flags: parsedFlags, args } = await this.parse(Convert);
    const headers: HeadersInit = {
      'User-Agent': '@shutterstock/sitemaps-cli/1.0',
      'Accept-Encoding': 'gzip',
    };

    // Validate the args
    const urlOrFile = getUrlOrFilePath(args['url-or-file']);

    const tasks = new Listr<IContextConvert>(
      [
        {
          enabled: () => urlOrFile.url !== undefined,
          title: 'Starting File Download',
          task: async (ctx, task) => {
            const indexResponse = await fetch(urlOrFile.url!.toString(), {
              headers,
              timeout: 240000,
            });

            if (indexResponse.status !== 200) {
              task.report(
                new Error(`sitemap failed HEAD request: ${indexResponse.status}, ${urlOrFile.url}`),
                ListrErrorTypes.HAS_FAILED,
              );

              return;
            }

            // Push file path to context
            ctx.filePath = `.${urlOrFile.url!.pathname}`;
            ctx.inputStream = indexResponse.body!;
          },
        },
        {
          enabled: () => urlOrFile.file !== undefined,
          title: 'Opening File',
          task: (ctx, task) => {
            let fileStream: fsExtra.ReadStream | undefined = undefined;
            if (urlOrFile.file !== undefined) {
              fileStream = createReadStream(urlOrFile.file);
            }
            if (fileStream === undefined) {
              this.error(`${urlOrFile.file} was not a valid file`);
            }

            // Push file path to context
            ctx.filePath = urlOrFile.file!;
            ctx.inputStream = fileStream;
          },
        },
        {
          title: 'Downloading File / Converting Items',
          task: async (ctx, task) => {
            // Save the json version of the file to the same path
            const indexFilePath = ctx.filePath;
            const indexFileLocal = indexFilePath.replace('.gz', '').replace('.xml', '.jsonl');
            const indexFileLocalPath = path.parse(indexFileLocal);
            if (indexFileLocalPath.dir !== '') {
              await fs.mkdir(indexFileLocalPath.dir, { recursive: true });
            }

            task.output = `Output file: ${indexFileLocal}`;

            // Turn the XML into JSON items
            const outputFile = createWriteStream(indexFileLocal);

            // Decompress the incoming file if it's a .gz
            let uncompressedReadable: NodeJS.ReadableStream;
            if (indexFilePath.endsWith('.gz')) {
              uncompressedReadable = ctx.inputStream.pipe(zlib.createGunzip());
            } else {
              uncompressedReadable = ctx.inputStream;
            }

            // Save the index file to disk
            const errors: string[] = [];
            uncompressedReadable
              .pipe(
                parsedFlags.type === 'sitemap'
                  ? new XMLToSitemapItemStream({
                      logger: (level, ...message) => {
                        errors.push(message.join(' '));
                      },
                      // Optional, passing SILENT overrides logger
                      level: ErrorLevel.WARN,
                    })
                  : new XMLToSitemapIndexStream({
                      logger: (level, ...message) => {
                        errors.push(message.join(' '));
                      },
                      // Optional, passing SILENT overrides logger
                      level: ErrorLevel.WARN,
                    }),
              )
              .pipe(new CleanupSitemapItems())
              // convert the object stream to JSON
              .pipe(new ObjectStreamToJSON({ lineSeparated: true }))
              // write the library compatible options to disk
              .pipe(outputFile);
            await finishedAsync(outputFile);

            if (errors.length > 0) {
              this.error(errors.join('\n'));
            }
          },
          options: {
            persistentOutput: true,
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
