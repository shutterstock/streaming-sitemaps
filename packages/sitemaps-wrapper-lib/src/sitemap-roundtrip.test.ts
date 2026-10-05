/// <reference types="jest" />
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { SitemapStream } from 'sitemap';
import { SitemapFileWrapper } from './sitemap-wrapper';
import { SitemapIndexWrapper } from './sitemap-index-wrapper';
import {
  SitemapAlreadyFull,
  SitemapWriteWouldOverflow,
  SitemapWrapperBase,
} from './sitemap-wrapper-base';

// Exercise the existing protected subclass destination contract: consumers
// can connect their own serializer without adopting connectOutput.
class CustomSitemap extends SitemapWrapperBase {
  constructor(localDirectory: string, compress: boolean) {
    super({ localDirectory, compress, filenameRoot: 'custom' });
    this._sitemapOrIndex = new SitemapStream({ hostname: 'https://example.com' });
    this._sitemapOrIndex.pipe(this._sitemapDest);
  }
  async add(url: string) {
    await this.write({ item: { url } });
  }
}

describe('XML round trips and limits', () => {
  let directory: string;
  beforeEach(async () => {
    directory = (await fs.mkdtemp(path.join(os.tmpdir(), 'sitemap-roundtrip-'))).toString();
  });
  afterEach(async () => {
    await fs.remove(directory);
  });

  it.each([false, true])(
    'escapes XML text and preserves Unicode on hydration (gzip=%s)',
    async (compress) => {
      const sitemap = new SitemapFileWrapper({
        compress,
        localDirectory: directory,
        siteBaseURL: 'https://example.com',
      });
      const caption = `A & B <tag> "quoted" café 🐈`;
      await sitemap.write({
        item: { url: '/search?a=1&b=2', img: [{ url: 'https://example.com/image.jpg', caption }] },
      });
      await sitemap.end();
      const bytes = await fs.readFile(sitemap.filenameAndPath);
      const xml = (compress ? zlib.gunzipSync(bytes) : bytes).toString('utf8');
      expect(xml).toContain('a=1&amp;b=2');
      expect(xml).toContain('&lt;tag&gt;');
      expect(sitemap.sizeUncompressedBytesEmitted).toBe(Buffer.byteLength(xml));
      const hydrated = await SitemapFileWrapper.fromFile({
        sourceFileAndPath: sitemap.filenameAndPath,
        bucketName: 'unused',
        siteBaseURL: 'https://example.com',
        filenameRoot: 'hydrated',
        compress,
        localDirectory: directory,
      });
      expect(hydrated.existing).toBe(true);
      expect(hydrated.items[0].url).toBe('https://example.com/search?a=1&b=2');
      expect(hydrated.items[0].img).toEqual([expect.objectContaining({ caption })]);
      await hydrated.sitemap.end();
      await hydrated.sitemap.delete();
      await hydrated.sitemap.delete();
    },
  );

  it.each([false, true])(
    'preserves a consumer subclass destination pipeline (gzip=%s)',
    async (compress) => {
      const sitemap = new CustomSitemap(directory, compress);
      await sitemap.add('/custom');
      await sitemap.end();
      const bytes = await fs.readFile(sitemap.filenameAndPath);
      expect((compress ? zlib.gunzipSync(bytes) : bytes).toString()).toContain(
        'https://example.com/custom',
      );
    },
  );

  it('rejects overflow before changing count, bytes or accumulated items', async () => {
    const sitemap = new SitemapFileWrapper({
      compress: false,
      localDirectory: directory,
      siteBaseURL: 'https://example.com',
      limitBytes: 500,
    });
    await sitemap.write({ item: { url: '/one' } });
    const bytes = sitemap.sizeUncompressed;
    await expect(sitemap.write({ item: { url: `/${'x'.repeat(200)}` } })).rejects.toBeInstanceOf(
      SitemapWriteWouldOverflow,
    );
    expect(sitemap.count).toBe(1);
    expect(sitemap.sizeUncompressed).toBe(bytes);
    expect(sitemap.items.map((item) => item.url)).toEqual(['/one']);
    await sitemap.write({ item: { url: '/two' } });
    await sitemap.end();
  });

  it('enforces count independently of byte overrides', async () => {
    const sitemap = new SitemapFileWrapper({
      compress: false,
      localDirectory: directory,
      siteBaseURL: 'https://example.com',
      limitCount: 1,
    });
    await sitemap.write({ item: { url: '/one' } });
    await expect(
      sitemap.write({ item: { url: '/two' }, disregardByteLimit: true }),
    ).rejects.toBeInstanceOf(SitemapAlreadyFull);
    expect(sitemap.count).toBe(1);
    await sitemap.end();
  });

  it.each([0, -1, 50001])('rejects invalid count limit %s before opening output', (limitCount) => {
    expect(
      () =>
        new SitemapFileWrapper({
          localDirectory: directory,
          siteBaseURL: 'https://example.com',
          limitCount,
        }),
    ).toThrow('50,000');
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('preserves index order and lastmod freshness through a file round trip', async () => {
    const index = new SitemapIndexWrapper({ compress: false, localDirectory: directory });
    const items = [
      { url: 'https://example.com/one.xml?a=1&b=2', lastmod: '2026-10-01T12:00:00.000Z' },
      { url: 'https://example.com/two.xml', lastmod: '2026-10-05T12:00:00.000Z' },
    ];
    await index.writeArray({ items });
    await index.end();
    const result = await SitemapIndexWrapper.itemsFromFile({
      sourceFileAndPath: index.filenameAndPath,
    });
    expect(result.items).toEqual(items);
    const hydrated = await SitemapIndexWrapper.fromFile({
      sourceFileAndPath: index.filenameAndPath,
      filenameRoot: 'hydrated-index',
      localDirectory: directory,
      compress: false,
      bucketName: 'unused',
      siteBaseURL: 'https://example.com',
    });
    expect(hydrated.index.lastFilename).toBe('two.xml');
    await hydrated.index.end();
  });

  it('retains the existing 50,000-entry bound while parsing an index', async () => {
    const filename = path.join(directory, 'oversized-index.xml');
    await fs.writeFile(
      filename,
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        '<sitemap><loc>https://example.com/file.xml</loc></sitemap>'.repeat(50001) +
        '</sitemapindex>',
    );
    await expect(
      SitemapIndexWrapper.itemsFromFile({ sourceFileAndPath: filename }),
    ).rejects.toThrow('maximum allowed entries (50000)');
    await fs.unlink(filename);
  });

  it('rejects a missing local input without creating output', async () => {
    await expect(
      SitemapIndexWrapper.itemsFromFile({ sourceFileAndPath: path.join(directory, 'missing.xml') }),
    ).rejects.toThrow('ENOENT');
    await expect(
      SitemapFileWrapper.fromFile({
        sourceFileAndPath: path.join(directory, 'missing.xml'),
        localDirectory: directory,
        siteBaseURL: 'https://example.com',
        bucketName: 'unused',
      }),
    ).rejects.toThrow('ENOENT');
    expect(await fs.readdir(directory)).toEqual([]);
  });
});
