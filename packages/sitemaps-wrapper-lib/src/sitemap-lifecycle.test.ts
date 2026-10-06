/// <reference types="jest" />
import fs from 'fs-extra';
import { once } from 'events';
import { Writable, Readable } from 'stream';
import type { WriteStream } from 'fs';
import { SitemapFileWrapper } from './sitemap-wrapper';
import { SitemapWrapperBase } from './sitemap-wrapper-base';

jest.mock('fs-extra', () => ({ ...jest.requireActual('fs-extra'), createWriteStream: jest.fn() }));

class InspectableSitemap extends SitemapFileWrapper {
  get stages() {
    return [this._sitemapOrIndex!, this._gzip, this._fileStream].filter(Boolean);
  }
}
class InputReader extends SitemapWrapperBase {
  static async read(stream: Readable, compressed: boolean, type: 'sitemap' | 'index') {
    return this._fromStream({ stream, compressed, type });
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('sitemap stream lifecycle', () => {
  let output: Writable | undefined;
  const options = { siteBaseURL: 'https://example.com', localDirectory: '/tmp' };

  afterEach(() => {
    output?.destroy();
    output = undefined;
    jest.mocked(fs.createWriteStream).mockReset();
    jest.restoreAllMocks();
  });

  function useOutput(sink: Writable) {
    output = sink;
    jest.mocked(fs.createWriteStream).mockReturnValue(sink as WriteStream);
  }

  it('waits for downstream backpressure before accepting an item', async () => {
    const arrived = deferred();
    let release!: () => void;
    let blocked = true;
    useOutput(
      new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, callback) {
          if (blocked) {
            release = () => {
              blocked = false;
              callback();
            };
            arrived.resolve();
          } else callback();
        },
      }),
    );
    const sitemap = new InspectableSitemap({ ...options, compress: false, limitCount: 1 });
    let accepted = false;
    const writing = sitemap.write({ item: { url: `/${'x'.repeat(65536)}` } }).then(() => {
      accepted = true;
    });
    await arrived.promise;
    expect(accepted).toBe(false);
    expect(sitemap.count).toBe(1);
    await expect(sitemap.write({ item: { url: '/two' } })).rejects.toThrow('already full');
    release();
    await writing;
    expect(sitemap.count).toBe(1);
    await sitemap.end();
    expect(output?.writableFinished).toBe(true);
    expect(output?.closed).toBe(true);
  });

  it('end waits for the destination final callback and close', async () => {
    const final = deferred();
    let release!: () => void;
    useOutput(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          release = callback;
          final.resolve();
        },
      }),
    );
    const sitemap = new InspectableSitemap({ ...options, compress: true });
    await sitemap.write({ item: { url: '/one' } });
    let completed = false;
    const ending = sitemap.end().then(() => {
      completed = true;
    });
    await final.promise;
    expect(completed).toBe(false);
    release();
    await ending;
    expect(output?.closed).toBe(true);
    expect(sitemap.ended).toBe(true);
    await expect(sitemap.end()).rejects.toThrow('after closed');
    await expect(sitemap.write({ item: { url: '/two' } })).rejects.toThrow('after closed');
  });

  it.each([false, true])('closes every stage of an empty sitemap (gzip=%s)', async (compress) => {
    useOutput(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    const sitemap = new InspectableSitemap({ ...options, compress });
    const stages = sitemap.stages;
    await sitemap.end();
    expect(stages.every((stage) => stage?.destroyed)).toBe(true);
    expect(output?.closed).toBe(true);
  });

  it.each([false, true])(
    'rejects output failure and closes every stage (gzip=%s)',
    async (compress) => {
      const failure = new Error('disk full');
      useOutput(
        new Writable({
          write(_chunk, _encoding, callback) {
            callback(failure);
          },
        }),
      );
      const sitemap = new InspectableSitemap({ ...options, compress });
      const stages = sitemap.stages;
      // A buffered write can succeed before the destination fails. Both promises
      // have rejection handlers immediately; end must still report that failure.
      const writing = sitemap.write({ item: { url: '/one' } }).catch((error: Error) => error);
      await writing;
      await expect(sitemap.end()).rejects.toBe(failure);
      expect(stages.every((stage) => stage?.destroyed)).toBe(true);
      expect(sitemap.ended).toBe(true);
      await expect(sitemap.pushToS3({ bucketName: 'unused' })).rejects.toBe(failure);
    },
  );

  it('rejects end when a backpressured destination fails', async () => {
    const arrived = deferred();
    let fail!: () => void;
    const failure = new Error('write cancelled');
    useOutput(
      new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, callback) {
          fail = () => callback(failure);
          arrived.resolve();
        },
      }),
    );
    const sitemap = new InspectableSitemap({ ...options, compress: false });
    const writing = sitemap.write({ item: { url: `/${'x'.repeat(65536)}` } });
    const settled = writing.catch((error: Error) => error);
    await arrived.promise;
    fail();
    await settled;
    await expect(sitemap.end()).rejects.toBe(failure);
    expect(output?.destroyed).toBe(true);
  });

  it('rolls back capacity when the XML transform rejects a write', async () => {
    useOutput(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    const sitemap = new InspectableSitemap({ ...options, compress: false });
    const failure = new Error('XML transform failed');
    const input = sitemap.stages[0] as import('sitemap').SitemapStream;
    jest
      .spyOn(input, '_transform')
      .mockImplementation((_item, _encoding, callback) => callback(failure));
    const bytes = sitemap.sizeUncompressed;
    await expect(sitemap.write({ item: { url: '/one' } })).rejects.toBe(failure);
    expect(sitemap.count).toBe(0);
    expect(sitemap.items).toEqual([]);
    expect(sitemap.sizeUncompressed).toBe(bytes);
    await expect(sitemap.end()).rejects.toBe(failure);
  });

  it.each(['sitemap', 'index'] as const)(
    'propagates source cancellation while reading %s',
    async (type) => {
      const source = new Readable({
        read() {
          /* Controlled by the test. */
        },
      });
      const parsing = InputReader.read(source, true, type);
      const failure = new Error('download cancelled');
      const rejected = expect(parsing).rejects.toBe(failure);
      source.destroy(failure);
      await rejected;
      expect(source.closed).toBe(true);
    },
  );

  it.each(['sitemap', 'index'] as const)('rejects corrupt gzip while reading %s', async (type) => {
    const source = Readable.from(['not a gzip stream']);
    await expect(InputReader.read(source, true, type)).rejects.toThrow();
    expect(source.destroyed).toBe(true);
  });

  it('rejects premature source closure without waiting indefinitely for XML', async () => {
    const arrived = deferred();
    const source = new Readable({
      read() {
        arrived.resolve();
      },
    });
    const parsing = InputReader.read(source, false, 'sitemap');
    const rejected = expect(parsing).rejects.toThrow('Premature close');
    await arrived.promise;
    const closed = once(source, 'close');
    source.destroy();
    await closed;
    await rejected;
  });
});
