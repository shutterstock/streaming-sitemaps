/// <reference types="jest" />
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { getSitemapType, SitemapType } from '../../src/utils/index-or-sitemap';
import { getUrlOrFilePath } from '../../src/utils/file-or-url';

describe('local input parsing and teardown', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sitemap-input-'));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('rejects missing paths and recognizes local files without network access', async () => {
    const filename = path.join(directory, 'input.xml');
    expect(() => getUrlOrFilePath(filename)).toThrow('ENOTFOUND');
    await fs.writeFile(filename, '<urlset/>');
    expect(getUrlOrFilePath(filename)).toEqual({ file: filename });
    expect(getUrlOrFilePath('https://example.com/input.xml')).toEqual({
      url: new URL('https://example.com/input.xml'),
    });
    await expect(getSitemapType(path.join(directory, 'missing.xml'))).rejects.toThrow('ENOENT');
  });

  it('rejects corrupt gzip and permits removal after stream failure', async () => {
    const filename = path.join(directory, 'broken.xml.gz');
    await fs.writeFile(filename, 'not gzip');
    await expect(getSitemapType(filename)).rejects.toThrow('incorrect header');
    await fs.unlink(filename);
  });

  it('recognizes a valid gzip larger than 10KB without requiring its full decompression', async () => {
    const filename = path.join(directory, 'large.xml.gz');
    const data = Buffer.alloc(65536);
    let seed = 123;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed >>> 24;
    }
    const xml = `<urlset>${data.toString('hex')}</urlset>`;
    const compressed = gzipSync(xml);
    expect(compressed.length).toBeGreaterThan(10240);
    await fs.writeFile(filename, compressed);
    expect(await getSitemapType(filename)).toBe(SitemapType.Sitemap);
    await fs.unlink(filename);
  });

  it('bounds inspection of unrecognized decompressed content to 10KB', async () => {
    const filename = path.join(directory, 'late.xml.gz');
    await fs.writeFile(filename, gzipSync(`${' '.repeat(10240)}<sitemapindex/>`));
    expect(await getSitemapType(filename)).toBeUndefined();
  });
});
