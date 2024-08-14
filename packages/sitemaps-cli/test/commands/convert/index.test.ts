import { test } from '@oclif/test';
import fs from 'fs';
import nock from 'nock';

describe('convert', () => {
  const originalCwd: string = process.cwd();

  beforeEach(() => {
    process.chdir(__dirname);

    // Remove data/sitemap.jsonl and data/index.jsonl relative to this file
    fs.rmSync(`${__dirname}/data/sitemap.jsonl`, { force: true });
    fs.rmSync(`${__dirname}/data/index.jsonl`, { force: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  describe('file source', () => {
    test
      .stdout()
      .stderr()
      .command(['convert', '--type=guess'])
      .exit(2)
      .it('fails if type is invalid', (ctx) => {
        expect(ctx.stdout).toEqual('');
      });

    test
      // This is failing without calling `it`
      .skip()
      .stdout()
      .stderr()
      .command(['convert', 'dummy.xml'])
      .exit(1)
      .it('fails if file does not exist', (ctx) => {
        // TODO: Not sure why the error message is not captured in this case
        expect(ctx.stdout).toEqual('');
        expect(ctx.stderr).toEqual('');
      });

    test
      .stdout()
      .stderr()
      .command(['convert', `${__dirname}/data/index.xml`])
      .exit(2)
      .it('reads file but fails if file is index but type flag is sitemap', (ctx) => {
        expect(ctx.stdout).toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✖ Downloading File / Converting Items:');
      });

    test
      .stdout()
      .stderr()
      .command(['convert', '--type=index', `${__dirname}/data/index.xml`])
      .it('succeeds converting index file', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading File / Converting Items');

        // Validate the output file
        const output = fs.readFileSync(`${__dirname}/data/index.jsonl`, 'utf-8');
        expect(output).toContain('http://www.example.com/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();
      });

    test
      .stdout()
      .stderr()
      .command(['convert', '--type=index', `${__dirname}/data/sitemap.xml`])
      .exit(2)
      .it('reads file but fails if file is sitemap but type flag is index', (ctx) => {
        expect(ctx.stdout).toContain('unhandled attr urlset xmlns');
        expect(ctx.stdout).toContain('✖ Downloading File / Converting Items:');
      });

    test
      .stdout()
      .stderr()
      .command(['convert', '--type=sitemap', `${__dirname}/data/sitemap.xml`])
      .it('succeeds converting sitemap file', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr urlset xmlns');
        expect(ctx.stdout).toContain('✔ Downloading File / Converting Items');

        // Validate the output file
        const output = fs.readFileSync(`${__dirname}/data/sitemap.jsonl`, 'utf-8');
        expect(output).toContain('http://www.example.com/foo.html');
        expect(output).toContain('http://www.example.com/bar.html');
        expect(output).toMatchSnapshot();
      });
  });

  describe('url source', () => {
    test
      .stdout()
      .stderr()
      .do(() => {
        // Mock the network request
        nock('http://www.example.com')
          .get('/data/index.xml')
          .reply(200, () => fs.createReadStream(`${__dirname}/data/index.xml`));
      })
      .command(['convert', '--type=index', 'http://www.example.com/data/index.xml'])
      .it('succeeds converting index from URL', (ctx) => {
        expect(ctx.stdout).not.toContain('unhandled attr sitemapindex xmlns');
        expect(ctx.stdout).toContain('✔ Downloading File / Converting Items');

        // Validate the output file
        const output = fs.readFileSync(`${__dirname}/data/index.jsonl`, 'utf-8');
        expect(output).toContain('http://www.example.com/sitemap1.xml.gz');
        expect(output).toContain('http://www.example.com/sitemap2.xml.gz');
        expect(output).toMatchSnapshot();
      });
  });
});
