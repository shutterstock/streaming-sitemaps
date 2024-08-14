/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import path from 'path';
import { parse, Parser } from 'csv-parse';
// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';
import { Args, Command, Flags } from '@oclif/core';
import { SitemapIndexWrapper, SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import {
  escapePercentInPathInput,
  escapeProhibitedPathChars,
  utf8EncodePath,
} from '@shutterstock/sitemaps-utils-lib';
import { Listr } from 'listr2';
import { ISitemapState, writeOrRotateAndWrite } from '../../utils/rotate';
import { EnumChangefreq } from 'sitemap';

const { promises: fs, createReadStream } = fsExtra;

interface IContext {
  csvRecords: Parser;
  indexFile: SitemapIndexWrapper;
  dynamoClient: DynamoDBClient;
}

export default class CreateFromCSV extends Command {
  static description = 'Create a sitemap index and sitemap files from CSV file';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> --base-sitemap-file-name=widget data.csv https://www.example.com/sitemaps/ https://www.example.com/search/ data/ widgets-index.xml`,
    `$ <%= config.bin %> <%= command.id %> --column MY_KEYWORD_COLUMN --base-sitemap-file-name=widget data.csv https://www.example.com/sitemaps/ https://www.example.com/search/ ./ widgets-index.xml`,
  ];

  static args = {
    'data-file': Args.file({
      description: 'Path to the local data file used to generate the URLs',
      required: true,
      exists: true,
    }),
    'sitemap-dir-url': Args.url({
      description:
        'Sitemap directory URL for the sitemap files, used to write links in the sitemap-index file (e.g. `https://www.example.com/sitemaps/`)',
      required: true,
    }),
    'base-url': Args.url({
      description:
        'Base URL to prefix in front of each keyword (e.g. https://www.example.com/search/)',
      required: true,
    }),
    'output-directory': Args.directory({
      description:
        'Directory to contain all output, the entire sitemap-dir-url structure will be created here, with the index file one directory up from the sitemap files',
      default: './',
      required: false,
    }),
    'index-file-name': Args.file({
      description: 'Filename for the sitemap index file - will gzip if .gz extension is present',
      default: 'index.xml',
      required: false,
    }),
  };

  static flags = {
    compress: Flags.boolean({
      char: 'c',
      description: 'Create .xml.gz files if true',
      required: false,
      default: false,
    }),
    column: Flags.string({
      description: 'Name of the column to use in the CSV file',
      multiple: false,
      required: false,
      default: 'Keywords',
    }),
    'escape-percent': Flags.boolean({
      description: 'Escape % in the path input',
      required: false,
      default: false,
    }),
    'base-sitemap-file-name': Flags.string({
      char: 'f',
      description: 'Base filename of each sitemap file, such as `item-sitemap`',
      default: 'sitemap',
      multiple: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags: parsedFlags } = await this.parse(CreateFromCSV);

    /**
     * Example: ./
     */
    const outputDirectory = args['output-directory'];

    /**
     * Example: /some/sitemaps (absolute)
     */
    const sitemapFilesPathOnly = args['sitemap-dir-url'].pathname;
    /**
     * Example: ./some/sitemaps (relative)
     * Example: ../../some/other/directory/sitemaps (relative)
     */
    const sitemapFilesLocalDirectory = path.join(outputDirectory, sitemapFilesPathOnly);

    /**
     * Example: index.xml or index.xml.gz
     */
    const indexFileNameWithExt = args['index-file-name'];

    /**
     * Example: index
     */
    const indexFileNameOnly = args['index-file-name'].replace('.xml', '').replace('.gz', '');

    const shouldCompress = parsedFlags.compress || indexFileNameWithExt.endsWith('.gz');

    const tasks = new Listr<IContext>(
      [
        {
          title: 'Creating local directory for sitemap files',
          task: async (ctx: IContext, task) => {
            task.output = `${sitemapFilesLocalDirectory}`;
            await fs.mkdir(sitemapFilesLocalDirectory, { recursive: true });
          },
          options: {
            persistentOutput: true,
          },
        },
        {
          title: 'Parsing local data file',
          task: (ctx: IContext) => {
            ctx.csvRecords = createReadStream(args['data-file'] as string).pipe(
              parse({
                columns: true,
                // Make sure we do not mis-parse the field field name
                // if a byte order marking is present
                bom: true,
                // CSV options if any
              }),
            );
          },
        },
        {
          title: 'Creating sitemap index file',
          task: (ctx: IContext, task) => {
            const indexPath = path.resolve(path.join(sitemapFilesLocalDirectory, '..'));
            task.output = `${indexPath}`;
            // Let the wrapper create a new index stream
            ctx.indexFile = new SitemapIndexWrapper({
              compress: shouldCompress,
              filenameRoot: indexFileNameOnly,
              localDirectory: path.join(sitemapFilesLocalDirectory, '..'),
            });
          },
          options: {
            persistentOutput: true,
          },
        },
        {
          title: 'Creating sitemaps from CSV records',
          task: async (ctx: IContext, task) => {
            const state: ISitemapState = { count: 1 };
            let currentSitemap: SitemapFileWrapper | undefined;
            let itemCount = 0;

            if (parsedFlags['column'] === undefined) {
              this.error('data-file-column is required');
            }

            for await (const record of ctx.csvRecords) {
              const unescapedColumnValue = record[parsedFlags['column']];

              if (unescapedColumnValue === undefined) {
                this.error(
                  `Column ${parsedFlags['column']} not found in CSV file, on row: ${JSON.stringify(record)}`,
                );
              }

              const origPathText = parsedFlags['escape-percent']
                ? escapePercentInPathInput(unescapedColumnValue)
                : unescapedColumnValue;

              const utf8EncodedPath = utf8EncodePath(origPathText);

              const url = escapeProhibitedPathChars(
                new URL(utf8EncodedPath, args['base-url'].toString()),
              );
              const item = {
                url: url.toString(),
                changefreq: EnumChangefreq.WEEKLY,
              };

              currentSitemap = await writeOrRotateAndWrite({
                compress: shouldCompress,
                fileNameRoot: parsedFlags['base-sitemap-file-name']
                  .replace('.xml', '')
                  .replace('.gz', ''),
                index: ctx.indexFile,
                item,
                siteBaseURL: args['sitemap-dir-url'].toString(),
                state,
                currentSitemap,
                localDirectory: sitemapFilesLocalDirectory,
              });

              // This output works but it takes ~20 seconds to iterate 50k items
              // Without this output it takes < 1 second to iterage 50k items
              // task.output = record.Keywords;
              //task.output = url;

              itemCount++;
            }

            if (itemCount === 0) {
              this.error('No items found in CSV file');
            }

            task.output = `Wrote ${itemCount} sitemap items to ${state.count} sitemap files`;

            await currentSitemap?.end();
          },
        },
        {
          title: 'Saving sitemap index file',
          task: async (ctx: IContext, task) => {
            // Let the wrapper create a new index stream
            await ctx.indexFile.end();
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
