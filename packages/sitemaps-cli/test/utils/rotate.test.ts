/// <reference types="jest" />
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SitemapFileWrapper, SitemapIndexWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import { writeOrRotateAndWrite } from '../../src/utils/rotate';

describe('CLI rotation keeps each item and index entry once', () => {
  let directory: string;
  let index: SitemapIndexWrapper;
  beforeEach(async () => {
    jest.useFakeTimers({
      now: new Date('2026-10-05T12:00:00.000Z'),
      // Freeze Date while keeping filesystem and stream scheduling native.
      doNotFake: [
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'nextTick',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sitemap-rotation-'));
    index = new SitemapIndexWrapper({ compress: false, localDirectory: directory });
  });
  afterEach(async () => {
    jest.useRealTimers();
    if (!index.ended) await index.end();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('initializes filenames and the index on the first write', async () => {
    const state = { count: 0 };
    const sitemap = await writeOrRotateAndWrite({
      index,
      item: { url: '/one' },
      siteBaseURL: 'https://example.com/',
      compress: false,
      state,
      fileNameRoot: 'widget',
      localDirectory: directory,
    });
    await sitemap.end();
    await index.end();
    expect(sitemap.filename).toBe('widget-00001.xml');
    expect(sitemap.items.map((item) => item.url)).toEqual(['/one']);
    expect(state.count).toBe(1);
    expect(index.items.map((item) => item.url)).toEqual(['https://example.com/widget-00001.xml']);
  });

  it.each([{ limitCount: 1 }, { limitBytes: 400 }])(
    'rotates at %j and writes the triggering item to the new file',
    async (limits) => {
      const current = new SitemapFileWrapper({
        ...limits,
        compress: false,
        filenameRoot: 'widget-00001',
        siteBaseURL: 'https://example.com/',
        localDirectory: directory,
      });
      await current.write({ item: { url: '/a' } });
      await index.write({
        item: { url: 'https://example.com/widget-00001.xml', lastmod: '2026-10-01T00:00:00.000Z' },
      });
      const state = { count: 1 };
      const next = await writeOrRotateAndWrite({
        currentSitemap: current,
        index,
        item: { url: '/b' },
        siteBaseURL: 'https://example.com/',
        compress: false,
        state,
        fileNameRoot: 'widget',
        localDirectory: directory,
      });
      await next.end();
      await index.end();
      expect(current.ended).toBe(true);
      expect(state.count).toBe(2);
      expect(next.filename).toBe('widget-00002.xml');
      expect(current.items.map((item) => item.url)).toEqual(['/a']);
      expect(next.items.map((item) => item.url)).toEqual(['/b']);
      expect(index.items.map((item) => item.url)).toEqual([
        'https://example.com/widget-00001.xml',
        'https://example.com/widget-00002.xml',
      ]);
      expect(Date.parse(index.items[1].lastmod as string)).toBeGreaterThan(
        Date.parse(index.items[0].lastmod as string),
      );
      const xml = await fs.readFile(next.filenameAndPath, 'utf8');
      expect(xml).toContain('https://example.com/b');
      expect(xml).not.toContain('https://example.com/a');
    },
  );

  it('propagates non-capacity failures without advancing the index or file count', async () => {
    const current = new SitemapFileWrapper({
      compress: false,
      siteBaseURL: 'https://example.com',
      localDirectory: directory,
    });
    const failure = new Error('cannot write XML');
    const write = jest.spyOn(current, 'write').mockRejectedValue(failure);
    const state = { count: 1 };
    try {
      await expect(
        writeOrRotateAndWrite({
          currentSitemap: current,
          index,
          item: { url: '/one' },
          siteBaseURL: 'https://example.com',
          compress: false,
          state,
          fileNameRoot: 'widget',
          localDirectory: directory,
        }),
      ).rejects.toBe(failure);
      expect(state.count).toBe(1);
      expect(index.items).toEqual([]);
    } finally {
      write.mockRestore();
      await current.end();
    }
  });
});
