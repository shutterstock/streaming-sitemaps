import { test } from '@oclif/test';
import * as kinesis from '@aws-sdk/client-kinesis';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { FileRecord, IFileRecord, ItemRecord, IItemRecord } from '@shutterstock/sitemaps-db-lib';
import { ISitemapWriterItem } from '@shutterstock/sitemaps-models-lib';

jest.mock('@shutterstock/sitemaps-db-lib');

describe('sitemap-writer-stream', () => {
  const kinesisClient: AwsClientStub<kinesis.KinesisClient> = mockClient(kinesis.KinesisClient);
  const dynamoDBClient: AwsClientStub<dynamodb.DynamoDBClient> = mockClient(
    dynamodb.DynamoDBClient,
  );

  beforeEach(() => {
    dynamoDBClient.reset();
    dynamoDBClient.onAnyCommand().callsFake((command) => {
      console.error('DynamoDB request leaked through to mock client:', command);
      throw new Error('DynamoDB request leaked through to mock client');
    });
    kinesisClient.reset();
  });

  test
    .stdout()
    .stderr()
    .command(['test:sitemap-writer-stream'])
    .exit(2)
    .it('fails if arg is missing', (ctx) => {
      expect(ctx.stderr).toEqual('');
      expect(ctx.stdout).toEqual('');
    });

  test
    .stdin('y\n', 1500)
    .stdout()
    .stderr()
    .do(() => {
      kinesisClient.onAnyCommand().callsFake(() => {
        throw new Error('Region is missing');
      });
    })
    .command(['test:sitemap-writer-stream', '--number', '1000', 'test-stream'])
    .exit(2)
    .it('exits if KinesisClient.send throws', (ctx) => {
      expect(ctx.stderr).toContain(
        '✔ Are you sure you want to start pushing sitemap-writer test data to the Kinesis',
      );
    });

  test
    .stdin('y\n', 1500)
    .stdout()
    .stderr()
    .do(() => {
      kinesisClient
        .onAnyCommand()
        .callsFake(() => {
          throw new Error('Region is missing');
        })
        .on(kinesis.PutRecordsCommand)
        .resolvesOnce({
          Records: [],
        })
        .resolvesOnce({
          Records: [],
        });
    })
    .command(['test:sitemap-writer-stream', '--number', '1000', 'test-stream'])
    .it('runs successfully', (ctx) => {
      expect(ctx.stderr).toContain(
        `✔ Are you sure you want to start pushing sitemap-writer test data to the Kinesis`,
      );
      expect(ctx.stderr).toContain(`"stream-name": "test-stream"`);
      expect(ctx.stderr).toContain(`"number": 1000`);
      expect(ctx.stdout).toContain('✔ Setup Kinesis helpers');
      expect(ctx.stdout).toContain('✔ Confirm parameters');
      // expect(ctx.stdout).toContain('✔ Write test messages to the Kinesis stream');
      expect(ctx.stdout).toContain('✔ Wait for the helpers to finish');

      expect(kinesisClient.calls()).toHaveLength(2);
      expect(kinesisClient.calls()[0].args[0].input).toBeDefined();

      const input = kinesisClient.calls()[0].args[0].input as kinesis.PutRecordsCommandInput;
      expect(input.Records).toBeDefined();
      expect(input.Records?.length).toBe(500);
      expect(input).toMatchSnapshot();

      const input2 = kinesisClient.calls()[0].args[0].input as kinesis.PutRecordsCommandInput;
      expect(input2.Records).toBeDefined();
      expect(input2.Records?.length).toBe(500);
      expect(input2).toMatchSnapshot();
    });

  test
    .only()
    .stdin('y\n', 1500)
    .stdout()
    .stderr()
    .do(() => {
      kinesisClient
        .onAnyCommand()
        .callsFake(() => {
          throw new Error('Region is missing');
        })
        .on(kinesis.PutRecordsCommand)
        .resolvesOnce({
          Records: [],
        })
        .resolvesOnce({
          Records: [],
        });

      const mockFileRecords: IFileRecord[] = Array.from({ length: 5 }, (_, i) => ({
        FileName: `widget-0000${i + 1}.xml`,
        FileStatus: 'written',
        PK: 'filelist#type#foo',
        SK: 'foo',
        Type: 'blue-widgets',
        CountWritten: 12 + i + 1,
        TimeFirstSeenISO: '2021-01-01T00:00:00Z',
        TimeLastWrittenISO: '2021-01-01T00:00:00Z',
      }));

      const mockItemRecords: IItemRecord[][] = mockFileRecords.map((fileRecord, i) =>
        Array.from({ length: fileRecord.CountWritten }, (_, j) => ({
          PK: `item#${1000 * (i + 1) + j}`,
          SK: '',
          SitemapItem: {
            url: `https://www.example.com/widgets/widget-for-sale-${1000 * (i + 1) + j}.html`,
            lastmod: '2021-01-01T00:00:00Z',
          },
          TimeFirstSeenISO: '2021-01-01T00:00:00Z',
          TimeLastWrittenISO: '2021-01-01T00:00:00Z',
          FileName: fileRecord.FileName,
          ItemID: `${1000 * (i + 1) + j}`,
          ItemStatus: 'written',
          Type: 'blue-widgets',
        })),
      );

      (FileRecord.loadType as jest.Mock).mockResolvedValue(mockFileRecords);
      mockItemRecords.forEach((itemRecords) => {
        (ItemRecord.loadFile as jest.Mock).mockResolvedValueOnce(itemRecords);
      });
    })
    .command([
      'test:sitemap-writer-stream',
      '--table-name',
      'my-table',
      '--item-type',
      'blue-widgets',
      '--number',
      '1000',
      'test-stream',
    ])
    .it('reads records from table', (ctx) => {
      expect(ctx.stderr).toContain(
        `✔ Are you sure you want to start pushing sitemap-writer test data to the Kinesis`,
      );
      expect(ctx.stderr).toContain(`"stream-name": "test-stream"`);
      expect(ctx.stderr).toContain(`"number": 1000`);
      expect(ctx.stdout).toContain('✔ Setup Kinesis helpers');
      expect(ctx.stdout).toContain('✔ Confirm parameters');
      expect(ctx.stdout).toContain('✔ Wait for the helpers to finish');

      expect(kinesisClient.calls()).toHaveLength(1);
      expect(kinesisClient.calls()[0].args[0].input).toBeDefined();

      const input = kinesisClient.calls()[0].args[0].input as kinesis.PutRecordsCommandInput;
      expect(input.Records).toBeDefined();
      expect(input.Records?.length).toBe(75);
      expect(input).toMatchSnapshot();
      expect(input.Records?.[0].Data).toBeDefined();
      // De-encode the base64 encoded data
      const data = JSON.parse(
        Buffer.from(input.Records![0].Data!).toString('utf-8'),
      ) as ISitemapWriterItem;
      expect(data.type).toBe('blue-widgets');
    });
});
