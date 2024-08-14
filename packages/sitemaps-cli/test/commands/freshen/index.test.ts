import { test } from '@oclif/test';
import * as lambda from '@aws-sdk/client-lambda';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import {
  ISitemapFreshenerStartMessage,
  ISitemapFreshenerStartResult,
} from '@shutterstock/sitemaps-models-lib';

describe('freshen', () => {
  let lambdaClient: AwsClientStub<lambda.LambdaClient>;

  beforeEach(() => {
    lambdaClient = mockClient(lambda.LambdaClient);
  });

  test
    .stdout()
    .stderr()
    .command(['freshen', '--function-name=dummy', '--repair-db', '--itemid-regex=bogus'])
    .exit(2)
    .it('fails if itemid-regex is invalid', (ctx) => {
      expect(ctx.stdout).toContain('`itemid-regex` must contain the `(?<ItemID>...)` placeholder');
    });

  test
    .stdout()
    .stderr()
    .command(['freshen', '--filename=dummy'])
    .exit(2)
    .it('fails if function-name and stream-name are both not passed', (ctx) => {
      expect(ctx.stdout).toEqual('');
      expect(ctx.stderr).toEqual('');
    });

  test
    .stdout()
    .stderr()
    .command(['freshen', '--function-name=dummy', '--stream-name=dummy'])
    .exit(2)
    .it('fails if function-name and stream-name are both passed', (ctx) => {
      expect(ctx.stdout).toEqual('');
      expect(ctx.stderr).toEqual('');
    });

  test
    .stdout()
    .stderr()
    .stdin('y\n', 1000)
    .do(() => {
      const message: ISitemapFreshenerStartMessage = {
        operation: 'start',
        s3DirectoryOverride: 'sitemaps-freshen-test/',
        itemIDRegex: '(?<ItemID>\\d+)',
        repairDB: true,
      };
      const results: ISitemapFreshenerStartResult[] = [
        {
          computedDryRun: false,
          computedDryRunDB: false,
          urlRegexValid: true,
          filesSkippedActive: 2,
          filesWritten: 3,
          filesOfType: 5,
          incomingDryRun: false,
          itemIDsSample: [
            { itemID: '123', url: 'https://www.example.com/123' },
            { itemID: '456', url: 'https://www.example.com/456' },
          ],
          message,
        },
      ];

      lambdaClient
        .onAnyCommand()
        .callsFake((command) => {
          throw new Error(
            `Unmocked command: ${command.constructor.name}:\n${JSON.stringify(command)}`,
          );
        })
        .on(
          lambda.InvokeCommand,
          {
            FunctionName: 'my-test-function',
          },
          false,
        )
        .resolves({
          $metadata: {
            httpStatusCode: 200,
          },
          // @ts-expect-error this works
          Payload: new Uint8Array(Buffer.from(JSON.stringify(results), 'utf-8')),
        });
    })
    .command(['freshen', '--function-name=my-test-function'])
    .it('invokes the lambda function', (ctx) => {
      expect(ctx.stdout).toContain('✔ Directly invoking Lambda function with message');
      expect(lambdaClient.calls().length).toEqual(1);
      expect(lambdaClient.commandCalls(lambda.InvokeCommand)[0].args[0].input.FunctionName).toEqual(
        'my-test-function',
      );
      expect(ctx.stderr).toContain(
        '? Are you sure you want to start a freshen of sitemap files with parameters?',
      );
      expect(ctx.stderr).toContain('"function-name": "my-test-function",');
      expect(ctx.stderr).toContain('"operation": "start",');
      expect(ctx.stderr).toContain('"repairDB": false,');
      expect(ctx.stderr).not.toContain('"itemIDRegex":');
      expect(ctx.stderr).toContain('"dryRun": true,');
      expect(ctx.stderr).toContain('"dryRunDB": true');
    });

  test
    .stdout()
    .stderr()
    .stdin('y\n', 1000)
    .do(() => {
      const message: ISitemapFreshenerStartMessage = {
        operation: 'start',
        repairDB: true,
        itemIDRegex: '"^https:\\/\\/www\\.example\\.com\\/widgets\\/(.*-)?(?<ItemID>[0-9]+)$"',
        dryRun: true,
        dryRunDB: true,
      };
      const results: ISitemapFreshenerStartResult[] = [
        {
          computedDryRun: false,
          computedDryRunDB: false,
          urlRegexValid: true,
          filesSkippedActive: 2,
          filesWritten: 3,
          filesOfType: 5,
          incomingDryRun: false,
          itemIDsSample: [
            { itemID: '123', url: 'https://www.example.com/123' },
            { itemID: '456', url: 'https://www.example.com/456' },
          ],
          message,
        },
      ];

      lambdaClient
        .onAnyCommand()
        .callsFake((command) => {
          const payloadBuffer = command.Payload;
          const encodedMessage = Buffer.from(
            JSON.stringify({ Records: [message] }),
            'utf-8',
          ).toString('base64');
          const Payload = JSON.parse(Buffer.from(command.Payload, 'base64').toString('utf-8'));
          throw new Error(
            `Unmocked command: ${command.constructor.name}:\n${JSON.stringify({ ...command, Payload })}\nencodedMessage: ${encodedMessage}\npayloadBuffer: ${payloadBuffer}`,
          );
        })
        .on(
          lambda.InvokeCommand,
          {
            FunctionName: 'my-test-function',
          },
          false,
        )
        .resolves({
          $metadata: {
            httpStatusCode: 200,
          },
          // @ts-expect-error this works
          Payload: new Uint8Array(Buffer.from(JSON.stringify(results), 'utf-8')),
        });
    })
    .command([
      'freshen',
      '--function-name=my-test-function',
      '--repair-db',
      '--itemid-regex="^https:\\/\\/www\\.example\\.com\\/widgets\\/(.*-)?(?<ItemID>[0-9]+)$"',
    ])
    .it('invokes the lambda function with repair enabled', (ctx) => {
      expect(ctx.stdout).toContain('✔ Directly invoking Lambda function with message');
      expect(ctx.stderr).toContain(
        '? Are you sure you want to start a freshen of sitemap files with parameters?',
      );
      expect(ctx.stderr).toContain('"function-name": "my-test-function",');
      expect(ctx.stderr).toContain('"operation": "start",');
      expect(ctx.stderr).toContain('"repairDB": true,');
      expect(ctx.stderr.replace(/\n/g, '')).toContain(
        `"itemIDRegex": "\\"^https:\\\\/\\\\/www\\\\.example\\\\.com\\\\/widgets\\\\/(.*-)?(?<ItemID>[0-9]+)$\\""`,
      );
      expect(ctx.stderr).toContain('"dryRun": true,');
      expect(ctx.stderr).toContain('"dryRunDB": true');
      expect(lambdaClient.calls().length).toEqual(1);
      expect(lambdaClient.commandCalls(lambda.InvokeCommand)[0].args[0].input.FunctionName).toEqual(
        'my-test-function',
      );
      // Base64 decode the sent payload
      const payload = Buffer.from(
        lambdaClient.commandCalls(lambda.InvokeCommand)[0].args[0].input.Payload as Uint8Array,
      ).toString();
      expect(JSON.parse(payload)).toEqual({
        Records: [
          {
            operation: 'start',
            repairDB: true,
            itemIDRegex: '"^https:\\/\\/www\\.example\\.com\\/widgets\\/(.*-)?(?<ItemID>[0-9]+)$"',
            dryRun: true,
            dryRunDB: true,
          },
        ],
      });
    });

  test
    .stdout()
    .command([
      'freshen',
      '--itemid-regex="^https:\\/\\/www\\.example\\.com\\/widgets\\/(.*-)?(?<ItemID>[0-9]+)$"',
    ])
    .exit(2)
    .it('throws if itemid-regex is specified but repair-db is not enabled', (ctx) => {
      expect(ctx.stdout).toEqual('');
      expect(lambdaClient.calls().length).toEqual(0);
    });
});
