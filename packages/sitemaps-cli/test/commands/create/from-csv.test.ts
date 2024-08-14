import { test } from '@oclif/test';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

jest.mock('@shutterstock/sitemaps-db-lib');

describe('create:from-csv', () => {
  const outputDir = path.join(__dirname, 'data');
  const originalCwd: string = process.cwd();

  beforeEach(() => {
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
    .stdout()
    .command([
      'create:from-csv',
      '--column',
      'keywords',
      `${__dirname}/../../data/data.csv`,
      'https://www.example.com/sitemaps/',
      'https://www.example.com/search/',
      'data/',
    ])
    .it('creates sitemaps from a CSV file', (ctx) => {
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Parsing local data file');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('› Wrote 5 sitemap items to 1 sitemap files');
      expect(ctx.stdout).toContain('✔ Creating sitemaps from CSV records');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      const indexPath = path.join(__dirname, 'data', 'index.xml');
      expect(fs.existsSync(indexPath)).toBe(true);

      // Check index content
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      expect(indexContent).toContain('https://www.example.com/sitemaps/sitemap-00001.xml');
      expect(indexContent).not.toContain('https://www.example.com/sitemaps/sitemap-00001.xml.xml');
      expect(indexContent).not.toContain('https://www.example.com/sitemaps/sitemap-00001.xml.gz');

      // Check sitemap content
      const sitemapPath = path.join(__dirname, 'data', 'sitemaps', 'sitemap-00001.xml');
      expect(fs.existsSync(sitemapPath)).toBe(true);
      const sitemapContent = fs.readFileSync(sitemapPath, 'utf-8');
      expect(sitemapContent).toContain('https://www.example.com/search/football');
      expect(sitemapContent).toContain('https://www.example.com/search/cooking');
      expect(sitemapContent).toContain('https://www.example.com/search/traveling');
    });

  test
    .stdout()
    .command([
      'create:from-csv',
      `${__dirname}/../../data/data.csv`,
      'https://www.example.com/sitemaps/',
      'https://www.example.com/search/',
      'data/',
    ])
    .exit(2)
    .it('exits with error when column not found in CSV file', (ctx) => {
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Parsing local data file');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain(
        '✖ Creating sitemaps from CSV records: Column Keywords not found in CSV file, on row: {"id":"1","name":"John","keywords":"football","age":"34"}',
      );

      const indexPath = path.join(__dirname, 'index.xml');
      expect(fs.existsSync(indexPath)).toBe(false);
    });

  test
    .stdout()
    .command([
      'create:from-csv',
      `${__dirname}/../../data/empty.csv`,
      'https://www.example.com/sitemaps/',
      'https://www.example.com/search/',
      'data/',
    ])
    .exit(2)
    .it('exits with error on empty CSV file', (ctx) => {
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Parsing local data file');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain(
        '✖ Creating sitemaps from CSV records: No items found in CSV file',
      );

      const indexPath = path.join(__dirname, 'index.xml');
      expect(fs.existsSync(indexPath)).toBe(false);
    });

  test
    .stdout()
    .command([
      'create:from-csv',
      '--base-sitemap-file-name',
      'non-default-sitemap-file-name',
      '--compress',
      '--column',
      'keywords',
      `${__dirname}/../../data/data.csv`,
      'https://www.example.com/sitemaps/',
      'https://www.example.com/search/',
      'data/',
    ])
    .it('creates compressed sitemaps from a CSV file', (ctx) => {
      expect(ctx.stdout).toContain('✔ Creating local directory for sitemap files');
      expect(ctx.stdout).toContain('✔ Parsing local data file');
      expect(ctx.stdout).toContain('✔ Creating sitemap index file');
      expect(ctx.stdout).toContain('› Wrote 5 sitemap items to 1 sitemap files');
      expect(ctx.stdout).toContain('✔ Creating sitemaps from CSV records');
      expect(ctx.stdout).toContain('✔ Saving sitemap index file');

      const indexPath = path.join(__dirname, 'data', 'index.xml.gz');
      expect(fs.existsSync(indexPath)).toBe(true);

      // Check index content
      const indexContent = zlib.gunzipSync(fs.readFileSync(indexPath)).toString('utf-8');
      expect(indexContent).toContain(
        'https://www.example.com/sitemaps/non-default-sitemap-file-name-00001.xml.gz',
      );
      expect(indexContent).not.toContain('https://www.example.com/sitemaps/sitemap-00001.xml.gz');
      expect(indexContent).not.toContain('https://www.example.com/sitemaps/sitemap-00001.xml.xml');

      // Check sitemap content
      const sitemapPath = path.join(
        __dirname,
        'data',
        'sitemaps',
        'non-default-sitemap-file-name-00001.xml.gz',
      );
      expect(fs.existsSync(sitemapPath)).toBe(true);
      const sitemapContent = zlib.gunzipSync(fs.readFileSync(sitemapPath)).toString('utf-8');
      expect(sitemapContent).toContain('https://www.example.com/search/football');
      expect(sitemapContent).toContain('https://www.example.com/search/cooking');
      expect(sitemapContent).toContain('https://www.example.com/search/traveling');
    });
});
