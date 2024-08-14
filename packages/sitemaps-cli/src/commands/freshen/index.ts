/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */

import * as kinesis from '@aws-sdk/client-kinesis';
import * as lambda from '@aws-sdk/client-lambda';
import { Command, Flags } from '@oclif/core';
import {
  ISitemapFreshenerStartMessage,
  ISitemapFreshenerFreshenFileMessage,
  ISitemapFreshenerLambdaEvent,
  ISitemapFreshenerStartResult,
  ISitemapFreshenerMessageBase,
} from '@shutterstock/sitemaps-models-lib';
import { Listr } from 'listr2';

const kinesisClient = new kinesis.KinesisClient({
  maxAttempts: 16, // maxAttempts defaults to 3
  // Throttling base delay is 500 ms
  // Other error base delay is 100 ms
  // Default strategy is exponential backoff with a max delay of 20 seconds per try
  // regardless of which attempt count it is (exponential backoff up to 20 seocnds, then constant 20 seconds)
});

const lambdaClient = new lambda.LambdaClient({
  maxAttempts: 3,
});

interface IContext {
  itemIDRegex?: string;
  message: ISitemapFreshenerMessageBase;
}

export default class Freshen extends Command {
  static description =
    'Initiate rewriting a sitemap or all sitemaps in a sitemap index from DynamoDB, optionally repairing missing items in the DB from the XML files';

  static examples = [
    `$ <%= config.bin %> <%= command.id %> --repair-db --no-dry-run --no-dry-run-db --table-item-type image --function-name some-deploy-sitemap-freshener-lambda-dev --s3-directory-override some-sitemap-dir/ --itemid-regex "^https:\\/\\/www\\.example\\.com\\/widgets\\/(.*-)?(?<ItemID>[0-9]+)$" --itemid-regex-test-url "https://www.example.com/widgets/widget-123451" --itemid-regex-test-url "https://www.example.com/widgets/widget-123452" --itemid-regex-test-url "https://www.example.com/widgets/widget-123453"`,
    `$ <%= config.bin %> <%= command.id %> --repair-db --no-dry-run --no-dry-run-db --table-item-type image --stream-name some-deploy-sitemap-freshener-stream-dev --s3-directory-override some-sitemap-dir/ --itemid-regex "^https:\\/\\/www\\.example\\.com\\/widgets\\/(.*-)?(?<ItemID>[0-9]+)$" --itemid-regex-test-url "https://www.example.com/widgets/widget-123451" --itemid-regex-test-url "https://www.example.com/widgets/widget-123452" --itemid-regex-test-url "https://www.example.com/widgets/widget-123453"`,
  ];

  static flags = {
    'dry-run': Flags.boolean({
      description: 'Dry run - Do not write anything to S3 or DynamoDB',
      default: true,
      allowNo: true,
    }),
    'dry-run-db': Flags.boolean({
      description: 'Dry run DB - Do not write anything to DyanmoDB even if writing to S3',
      default: true,
      allowNo: true,
    }),
    's3-directory-override': Flags.string({
      description: `S3 directory to override the default upload directory of sitemaps
                    This allows you to write to a different directory than the default,
                    enabling evaluation of the results before overwriting the existing
                    sitemaps by moving the files with, for example, the AWS CLI or Console`,
      required: false,
      multiple: false,
    }),
    'stream-name': Flags.string({
      description:
        'Asynchronously starts a freshen by writing a message to the Kinesis stream of the sitemap freshener',
      multiple: false,
      exactlyOne: ['stream-name', 'function-name'],
    }),
    'function-name': Flags.string({
      description: 'Synchronously invokes the named Lambda function to start a sitemap freshen',
      multiple: false,
    }),
    'table-item-type': Flags.string({
      description: '`type` value of the DynamoDB table items',
      required: false,
      multiple: false,
    }),
    'repair-db': Flags.boolean({
      description: `Repair the DynamoDB table data, taking the following actions:
                    - Parses the \`ItemID\` from the S3 sitemap file \`url\` field using the \`itemid-regex\`
                    - Adding ItemRecord's for items in the S3 sitemap file that are not present in the DB
                    - For items in the S3 sitemap file owned by another file, removing them from the S3 file`,
      default: false,
    }),
    'itemid-regex': Flags.string({
      description: `Only needed when \`repair-db\` is enabled
                    Regular expression to parse the \`ItemID\` out of the URL in the S3 sitemaps
                    Returned as named match \`(?<ItemID>...)\`
                    MUST match the \`ItemID\` field in DynamoDB
                    EXAMPLE: "^https:\\/\\/www\\.example\\.com\\/widget-(?<ItemID>[0-9]+)"`,
      required: false,
      dependsOn: ['repair-db'],
    }),
    'itemid-regex-test-url': Flags.url({
      description: `Only needed when \`repair-db\` is enabled
                    URL to test the \`itemid-regex\`
                    
                    User will be prompted to confirm that the extracted ID is correct
                    EXAMPLE: "https://www.example.com/widget-123456789-super-sale-50%25-off"`,
      required: false,
      multiple: true,
      dependsOn: ['itemid-regex'],
    }),
    filename: Flags.string({
      description: 'Single file to process',
      required: false,
      multiple: false,
    }),
    yes: Flags.boolean({
      description: 'Skip confirmation prompts',
      char: 'y',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags: parsedFlags } = await this.parse(Freshen);

    const { 'itemid-regex': itemIDRegexStr, 'itemid-regex-test-url': itemIDRegexTestURL } =
      parsedFlags;

    // Custom validation
    if (parsedFlags['repair-db'] && !parsedFlags['itemid-regex']) {
      this.error('`itemid-regex` must be specified when `repair-db` is enabled');
    }
    if (!parsedFlags['repair-db'] && parsedFlags['itemid-regex']) {
      this.error('`itemid-regex` should not be specified when `repair-db` is not enabled');
    }

    const tasks = new Listr<IContext>(
      [
        {
          enabled: () => parsedFlags['itemid-regex'] !== undefined,
          title: 'Parsing itemIDRegex',
          task: async (ctx: IContext, task) => {
            const itemIDRegex = itemIDRegexStr ? new RegExp(itemIDRegexStr) : undefined;
            if (itemIDRegexStr !== undefined && !itemIDRegexStr.includes('(?<ItemID>')) {
              this.error('`itemid-regex` must contain the `(?<ItemID>...)` placeholder');
            }

            // Save the string for the regex
            ctx.itemIDRegex = itemIDRegexStr;

            let taskOutput = '';
            if (itemIDRegex !== undefined && itemIDRegexTestURL !== undefined) {
              // Validate all of the test URLs
              for (const url of itemIDRegexTestURL) {
                const itemIDRegexTestURLStr = url.toString();
                const matches = itemIDRegexTestURLStr.match(itemIDRegex);
                if (matches === null) {
                  this.error(`\`${itemIDRegexStr}\`
did not match
\`${itemIDRegexTestURLStr}\``);
                }
                if (matches.groups === undefined) {
                  this.error(
                    `\`${itemIDRegexStr}\`
did not capture any groups at all from
\`${itemIDRegexTestURLStr}\``,
                  );
                }
                if (matches.groups.ItemID === undefined) {
                  this.error(
                    `\`${itemIDRegexStr}\`
did not capture \`ItemID\` group from
\`${itemIDRegexTestURLStr}\``,
                  );
                }

                const message = `The regex captured \`(?<ItemID>...)\` from the test URL \`${itemIDRegexTestURLStr}\`: ${matches.groups.ItemID}`;
                const shortMessage = `${itemIDRegexTestURLStr}
-> ${matches.groups.ItemID}`;

                // Confirm with user if the test URL was provided and captured a value
                const confirm =
                  parsedFlags.yes ||
                  (await task.prompt({
                    choices: ['y', 'n'],
                    correctChoice: 'y',
                    message,
                    type: 'confirm',
                  }));
                if (!confirm) {
                  task.output = shortMessage;
                  this.error('user cancelled');
                }
                if (parsedFlags.yes) {
                  task.output = message;
                }
                // Persist in log
                taskOutput += `${shortMessage}\n`;
                task.output = taskOutput.trimEnd();
              }
            }
          },
          options: { persistentOutput: true },
        },
        {
          enabled: parsedFlags['filename'] === undefined,
          title: 'Preparing payload - Start',
          task: (ctx: IContext, task) => {
            const message: ISitemapFreshenerStartMessage = {
              operation: 'start',
              repairDB: parsedFlags['repair-db'],
              type: parsedFlags['table-item-type'],
              s3DirectoryOverride: parsedFlags['s3-directory-override'],
              itemIDRegex: ctx.itemIDRegex,
              dryRun: parsedFlags['dry-run'],
              dryRunDB: parsedFlags['dry-run-db'],
            };
            ctx.message = message;
          },
        },
        {
          enabled: parsedFlags['filename'] !== undefined,
          title: 'Preparing payload - FreshenFile',
          task: (ctx: IContext, task) => {
            const message: ISitemapFreshenerFreshenFileMessage = {
              operation: 'freshenFile',
              repairDB: parsedFlags['repair-db'],
              type: parsedFlags['table-item-type'],
              s3DirectoryOverride: parsedFlags['s3-directory-override'],
              itemIDRegex: ctx.itemIDRegex,
              dryRun: parsedFlags['dry-run'],
              dryRunDB: parsedFlags['dry-run-db'],
              filename: parsedFlags['filename'],
            };
            ctx.message = message;
          },
        },
        {
          enabled: () => parsedFlags['stream-name'] !== undefined,
          title: 'Posting `start` message to Kinesis',
          task: async (ctx: IContext, task) => {
            const confirm =
              parsedFlags.yes ||
              (await task.prompt({
                choices: ['y', 'n'],
                correctChoice: 'y',
                message: `Are you sure you want to start a freshen of sitemap files with parameters?
${JSON.stringify({ 'stream-name': parsedFlags['stream-name'], ...ctx.message }, undefined, 2)}?`,
                type: 'confirm',
              }));
            if (!confirm) {
              this.error('user cancelled');
            }
            if (parsedFlags.yes) {
              task.output = `Starting a freshen of sitemap files with parameters:
              ${JSON.stringify(
                { 'stream-name': parsedFlags['stream-name'], ...ctx.message },
                undefined,
                2,
              )}`;
            }

            await kinesisClient.send(
              new kinesis.PutRecordCommand({
                PartitionKey: `operation#start#type#${parsedFlags['table-item-type']}#`,
                StreamName: parsedFlags['stream-name'],
                Data: Buffer.from(JSON.stringify(ctx.message), 'utf-8'),
              }),
            );
          },
          options: {
            persistentOutput: true,
          },
        },
        {
          enabled: () => parsedFlags['function-name'] !== undefined,
          title: 'Directly invoking Lambda function with message',
          task: async (ctx: IContext, task) => {
            // TODO: Call the Lambda to get the sitemap bucket name and to count the number of sitemap files
            // This info will be very useful to the user in determining if they want to proceed
            const confirm =
              parsedFlags.yes ||
              (await task.prompt({
                choices: ['y', 'n'],
                correctChoice: 'y',
                message: `Are you sure you want to start a freshen of sitemap files with parameters?
${JSON.stringify(
  { 'function-name': parsedFlags['function-name'], ...ctx.message },
  undefined,
  2,
)}?`,
                type: 'confirm',
              }));
            if (!confirm) {
              this.error('user cancelled');
            }
            if (parsedFlags.yes) {
              task.output = `Starting a freshen of sitemap files with parameters:
${JSON.stringify(ctx.message, undefined, 2)}`;
            }

            const event: ISitemapFreshenerLambdaEvent = {
              Records: [ctx.message],
            };

            const response = await lambdaClient.send(
              new lambda.InvokeCommand({
                FunctionName: parsedFlags['function-name'],
                Payload: Buffer.from(JSON.stringify(event, undefined, 2), 'utf-8'),
              }),
            );

            if (response.$metadata.httpStatusCode === 200 && response.Payload !== undefined) {
              const responseBuff = Buffer.from(response.Payload);
              const responseStr = responseBuff.toString('utf-8');
              const responseArray = JSON.parse(responseStr) as ISitemapFreshenerStartResult[];
              if (
                responseArray === null ||
                !Array.isArray(responseArray) ||
                responseArray.length === 0
              ) {
                this.error(
                  `Lambda function returned invalid JSON: ${JSON.stringify({
                    ...response,
                    Payload: responseStr,
                  })}`,
                );
              } else {
                const responseObj = responseArray[0];

                if (responseObj.error !== undefined) {
                  this.error(`Lambda function returned an error: ${responseObj.error}`);
                }

                task.output = JSON.stringify(responseObj, undefined, 2);
              }
            } else {
              this.error(`Lambda function invoke failed: ${response.$metadata.httpStatusCode}`);
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
          // showSubtasks: false,
        },
      },
    );

    await tasks.run();
  }
}
