/* eslint-disable no-console */
import { test } from '@oclif/test';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { FileRecord, IFileRecord, ItemRecord, IItemRecord } from '@shutterstock/sitemaps-db-lib';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

jest.mock('@shutterstock/sitemaps-db-lib');

describe('create:from-dynamodb', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let dynamoDBClient: AwsClientStub<dynamodb.DynamoDBClient>;
  const outputDir = path.join(__dirname, 'data');
  const originalCwd: string = process.cwd();
  const mockFileRecords: IFileRecord[] = [
    {
      FileName: 'widget-00001.xml',
      FileStatus: 'written',
      PK: 'filelist#type#foo',
      SK: 'foo',
      Type: 'widget',
      CountWritten: 1,
      TimeFirstSeenISO: '2021-01-01T00:00:00Z',
      TimeLastWrittenISO: '2021-01-01T00:00:00Z',
    },
  ];
  const mockItemRecords: IItemRecord[] = [
    {
      PK: 'item#1234567',
      SK: '',
      SitemapItem: {
        url: 'https://www.example.com/widgets/widget-for-sale-00001.html',
        lastmod: '2021-01-01T00:00:00Z',
      },
      TimeFirstSeenISO: '2021-01-01T00:00:00Z',
      TimeLastWrittenISO: '2021-01-01T00:00:00Z',
      FileName: 'widget-00001.xml',
      ItemID: '1234567',
      ItemStatus: 'written',
      Type: 'widget',
    },
  ];

  beforeEach(() => {
    dynamoDBClient = mockClient(dynamodb.DynamoDBClient);
    dynamoDBClient.onAnyCommand().callsFake((command) => {
      console.error('DynamoDB request leaked through to mock client:', command);
      throw new Error('DynamoDB request leaked through to mock client');
    });

    process.chdir(__dirname);

    // Clean up any previous test outputs
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // fs.rmSync(`${__dirname}/data/`, { recursive: true, force: true });
  });

  test
    .stdin('y\n', 2500)
    .stdout()
    .do(() => {
      (FileRecord.loadOne as jest.Mock).mockResolvedValueOnce(mockFileRecords[0]);
      (ItemRecord.loadFile as jest.Mock).mockResolvedValueOnce(mockItemRecords);
    })
    .command([
      'create:from-dynamodb',
      '--table-item-type',
      'widget',
      '--table-file-name',
      'widget-00001.xml',
      'myTable',
      'https://www.example.com/sitemaps/',
      'data/some/deep/dir/',
    ])
    .it(
      'creates an uncompressed index and file for specified sitemap file in deep output directory',
      (ctx) => {
        // Add your assertions here
        expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
        expect(ctx.stdout).toContain('✔ Setting up DynamoDB client for table: myTable');
        expect(ctx.stdout).toContain('✔ Getting single file to read from DynamoDB');
        expect(ctx.stdout).toContain('› Loaded records: 1');
        expect(ctx.stdout).toContain('✔ Creating sitemap index file');
        expect(ctx.stdout).toContain('› Wrote 1 sitemap items, skipped 0');
        expect(ctx.stdout).toContain('✔ Creating sitemaps from DB records');
        expect(ctx.stdout).toContain('✔ Saving sitemap index file');

        // Validate the index file
        expect(fs.existsSync(`${__dirname}/data/some/deep/dir/index.xml`)).toBe(true);
        const output = fs.readFileSync(`${__dirname}/data/some/deep/dir/index.xml`, 'utf-8');
        expect(output).toContain('https://www.example.com/sitemaps/widget-00001.xml');
        expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.gz');
        expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.xml');

        // Validate the sitemap file
        expect(fs.existsSync(`${__dirname}/data/some/deep/dir/sitemaps/widget-00001.xml`)).toBe(
          true,
        );
        const sitemap = fs.readFileSync(
          `${__dirname}/data/some/deep/dir/sitemaps/widget-00001.xml`,
          'utf-8',
        );
        expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-00001.html');
      },
    );

  test
    .stdin('y\n', 1000)
    .stdout()
    .do(() => {
      (FileRecord.loadOne as jest.Mock).mockResolvedValueOnce(mockFileRecords[0]);
      (ItemRecord.loadFile as jest.Mock).mockResolvedValueOnce(mockItemRecords);
    })
    .command([
      'create:from-dynamodb',
      '--table-item-type',
      'widget',
      '--table-file-name',
      'widget-00001.xml',
      'myTable',
      'https://www.example.com/sitemaps/',
      'data/',
      'index.xml',
    ])
    .it('creates an uncompressed index and file for specified sitemap file', (ctx) => {
      // Add your assertions here
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Setting up DynamoDB client for table: myTable');
      expect(ctx.stdout).toContain('✔ Getting single file to read from DynamoDB');
      expect(ctx.stdout).toContain('› Loaded records: 1');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('› Wrote 1 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('✔ Creating sitemaps from DB records');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      // Validate the index file
      expect(fs.existsSync(`${__dirname}/data/index.xml`)).toBe(true);
      const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00001.xml');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.gz');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.xml');

      // Validate the sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00001.xml`)).toBe(true);
      const sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00001.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-00001.html');
    });

  test
    .stdin('y\n', 1000)
    .stdout()
    .do(() => {
      (FileRecord.loadOne as jest.Mock).mockResolvedValueOnce(mockFileRecords[0]);
      (ItemRecord.loadFile as jest.Mock).mockResolvedValue(mockItemRecords);
      (ItemRecord.loadMany as jest.Mock).mockResolvedValueOnce(mockItemRecords);
    })
    .command([
      'create:from-dynamodb',
      '--table-item-type',
      'widget',
      '--table-file-name',
      'widget-00001.xml',
      '--consistency-check',
      'myTable',
      'https://www.example.com/sitemaps/',
      'data/',
      'index.xml',
    ])
    .it('creates an uncompressed index and file for with consistency check', (ctx) => {
      // Add your assertions here
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Setting up DynamoDB client for table: myTable');
      expect(ctx.stdout).toContain('✔ Getting single file to read from DynamoDB');
      expect(ctx.stdout).toContain('› Loaded records: 1');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('› Wrote 1 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('✔ Creating sitemaps from DB records');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      // Validate the index file
      expect(fs.existsSync(`${__dirname}/data/index.xml`)).toBe(true);
      const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00001.xml');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.gz');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.xml');

      // Validate the sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00001.xml`)).toBe(true);
      const sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00001.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-00001.html');
    });

  test
    .stdin('y\n', 1000)
    .stdout()
    .do(() => {
      (FileRecord.loadOne as jest.Mock).mockResolvedValueOnce(mockFileRecords[0]);
      (ItemRecord.loadFile as jest.Mock).mockResolvedValueOnce(mockItemRecords);
    })
    .command([
      'create:from-dynamodb',
      '--table-item-type',
      'widget',
      '--table-file-name',
      'widget-00001.xml',
      'myTable',
      'https://www.example.com/sitemaps/',
      'data/',
      'index.xml.gz',
    ])
    .it('creates a compressed index and file for specified sitemap file', (ctx) => {
      // Add your assertions here
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Setting up DynamoDB client for table: myTable');
      expect(ctx.stdout).toContain('✔ Getting single file to read from DynamoDB');
      expect(ctx.stdout).toContain('› Loaded records: 1');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('› Wrote 1 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('✔ Creating sitemaps from DB records');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      // Validate the index file
      expect(fs.existsSync(`${__dirname}/data/index.xml.gz`)).toBe(true);
      const outputGz = fs.readFileSync(`${__dirname}/data/index.xml.gz`);
      const output = zlib.gunzipSync(outputGz).toString('utf-8');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00001.xml.gz');

      // Validate the sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00001.xml.gz`)).toBe(true);
      const sitemapGz = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00001.xml.gz`);
      const sitemap = zlib.gunzipSync(sitemapGz).toString('utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-00001.html');
    });

  test
    .stdin('y\n', 1000)
    .stdout()
    .do(() => {
      const mockFileRecords: IFileRecord[] = Array.from({ length: 5 }, (_, i) => ({
        FileName: `widget-0000${i + 1}.xml`,
        FileStatus: 'written',
        PK: 'filelist#type#foo',
        SK: 'foo',
        Type: 'widget',
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
          Type: 'widget',
        })),
      );

      (FileRecord.loadType as jest.Mock).mockResolvedValue(mockFileRecords);
      mockItemRecords.forEach((itemRecords) => {
        (ItemRecord.loadFile as jest.Mock).mockResolvedValueOnce(itemRecords);
      });
    })
    .command([
      'create:from-dynamodb',
      '--table-item-type',
      'widget',
      'myTable',
      'https://www.example.com/sitemaps/',
      'data/',
      'index.xml',
    ])
    .it('creates all files when table-file-name is not specified', (ctx) => {
      // Add your assertions here
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Setting up DynamoDB client for table: myTable');
      expect(ctx.stdout).toContain('✔ Getting list of files to read from DynamoDB');
      expect(ctx.stdout).toContain('› Loaded records: 5');
      expect(ctx.stdout).toContain('› About to write 75 sitemap items to 5 sitemap files');
      expect(ctx.stdout).toContain('› Wrote 13 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('› Wrote 14 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('› Wrote 15 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('› Wrote 16 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('› Wrote 17 sitemap items, skipped 0');
      expect(ctx.stdout).toContain('✔ Creating sitemaps from DB records');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      // Validate the index file
      expect(fs.existsSync(`${__dirname}/data/index.xml`)).toBe(true);
      const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00001.xml');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00005.xml');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.gz');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.xml');
      expect(output).toMatchSnapshot();

      // Validate 1st sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00001.xml`)).toBe(true);
      let sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00001.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-1000.html');

      // Validate 2nd sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00002.xml`)).toBe(true);
      sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00002.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-2013.html');

      // Validate 3rd sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00003.xml`)).toBe(true);
      sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00003.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-3014.html');

      // Validate 4th sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00004.xml`)).toBe(true);
      sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00004.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-4015.html');

      // Validate 5th sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00005.xml`)).toBe(true);
      sitemap = fs.readFileSync(`${__dirname}/data/sitemaps/widget-00005.xml`, 'utf-8');
      expect(sitemap).toContain('https://www.example.com/widgets/widget-for-sale-5016.html');
      expect(sitemap).toMatchSnapshot();
    });

  test
    .stdout()
    .do(() => {
      const mockFileRecords: IFileRecord[] = Array.from({ length: 5 }, (_, i) => ({
        FileName: `widget-0000${i + 1}.xml`,
        FileStatus: 'written',
        PK: 'filelist#type#foo',
        SK: 'foo',
        Type: 'widget',
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
          Type: 'widget',
        })),
      );

      (FileRecord.loadType as jest.Mock).mockResolvedValue(mockFileRecords);
      mockItemRecords.forEach((itemRecords) => {
        (ItemRecord.loadFile as jest.Mock).mockResolvedValueOnce(itemRecords);
      });
    })
    .command([
      'create:from-dynamodb',
      '--table-item-type',
      'widget',
      '--no-create-sitemaps',
      'myTable',
      'https://www.example.com/sitemaps/',
      'data/',
      'index.xml',
    ])
    .it('creates index with all files but no sitemaps', (ctx) => {
      // Add your assertions here
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Setting up DynamoDB client for table: myTable');
      expect(ctx.stdout).toContain('✔ Getting list of files to read from DynamoDB');
      expect(ctx.stdout).toContain('› Loaded records: 5');
      expect(ctx.stdout).not.toContain('› About to write 75 sitemap items to 5 sitemap files');
      expect(ctx.stdout).not.toContain('› Wrote 13 sitemap items, skipped 0');
      expect(ctx.stdout).not.toContain('› Wrote 14 sitemap items, skipped 0');
      expect(ctx.stdout).not.toContain('› Wrote 15 sitemap items, skipped 0');
      expect(ctx.stdout).not.toContain('› Wrote 16 sitemap items, skipped 0');
      expect(ctx.stdout).not.toContain('› Wrote 17 sitemap items, skipped 0');
      expect(ctx.stdout).not.toContain('✔ Creating sitemaps from DB records');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      // Validate the index file
      expect(fs.existsSync(`${__dirname}/data/index.xml`)).toBe(true);
      const output = fs.readFileSync(`${__dirname}/data/index.xml`, 'utf-8');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00001.xml');
      expect(output).toContain('https://www.example.com/sitemaps/widget-00005.xml');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.gz');
      expect(output).not.toContain('https://www.example.com/sitemaps/widget-00001.xml.xml');
      expect(output).toMatchSnapshot();

      // Validate 1st sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00001.xml`)).toBe(false);

      // Validate 2nd sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00002.xml`)).toBe(false);

      // Validate 3rd sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00003.xml`)).toBe(false);

      // Validate 4th sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00004.xml`)).toBe(false);

      // Validate 5th sitemap file
      expect(fs.existsSync(`${__dirname}/data/sitemaps/widget-00005.xml`)).toBe(false);
    });
});
