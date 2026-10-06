/// <reference types="jest" />
import { KinesisClient, PutRecordsCommand } from '@aws-sdk/client-kinesis';
import { KinesisRetrierStatic } from '@shutterstock/kinesis-helpers';
import type { DBManager } from '@shutterstock/sitemaps-db-lib';
import type { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import { backgroundUploadSitemapWorker } from './sitemap-rotate';
import type { SitemapFileAndStats } from './sitemap-file-stats';
import type { IConfig } from './config/config';

jest.mock('./utils/log', () => ({ log: { info: jest.fn(), error: jest.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('upload completion orders DB and index publication', () => {
  let client: KinesisClient;
  const config = {
    s3SitemapsBucketName: 'unused',
    s3Directory: 'sitemaps/',
    siteBaseURL: 'https://example.com',
    siteBaseSitemapPath: '/sitemaps',
    kinesisIndexWriterStreamName: 'index-stream',
  } as IConfig;
  beforeEach(() => {
    client = new KinesisClient({ region: 'test' });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    client.destroy();
  });

  function fixture(existing = false) {
    const sitemap = {
      filename: 'one.xml',
      end: jest.fn().mockResolvedValue({ filenameAndPath: '/unused' }),
      pushToS3: jest.fn().mockResolvedValue({ s3Path: 's3://unused/sitemaps/widget/one.xml' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const stats = { save: jest.fn().mockResolvedValue(undefined) };
    const notify = jest
      .spyOn(KinesisRetrierStatic, 'putRecords')
      .mockResolvedValue({ $metadata: {}, Records: [] });
    const opts = {
      sitemapAndStats: {
        sitemap: sitemap as unknown as SitemapFileWrapper,
        stats,
        existing,
      } as unknown as SitemapFileAndStats,
      config,
      type: 'widget',
      infixDirs: [],
      dbManager: {} as DBManager,
      kinesisClient: client,
    };
    return { sitemap, stats, notify, opts };
  }

  it.each([false, true])(
    'waits for close and upload before publishing metadata (existing=%s)',
    async (existing) => {
      const { sitemap, stats, notify, opts } = fixture(existing);
      const closed = deferred<{ filenameAndPath: string }>();
      const uploaded = deferred<{ s3Path: string }>();
      const uploadStarted = deferred<void>();
      sitemap.end.mockReturnValue(closed.promise);
      sitemap.pushToS3.mockImplementation(async () => {
        uploadStarted.resolve();
        return uploaded.promise;
      });
      const work = backgroundUploadSitemapWorker(opts);
      expect(sitemap.pushToS3).not.toHaveBeenCalled();
      expect(stats.save).not.toHaveBeenCalled();
      closed.resolve({ filenameAndPath: '/unused' });
      await uploadStarted.promise;
      expect(stats.save).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      uploaded.resolve({ s3Path: 's3://unused/one.xml' });
      await work;
      expect(stats.save).toHaveBeenCalledTimes(1);
      const command = notify.mock.calls[0][1] as PutRecordsCommand;
      expect(command.input.StreamName).toBe('index-stream');
      const message = JSON.parse(Buffer.from(command.input.Records![0].Data!).toString());
      expect(message).toMatchObject({
        action: existing ? 'update' : 'add',
        type: 'widget',
        indexItem: { url: 'https://example.com/sitemaps/widget/one.xml' },
      });
      expect(Number.isNaN(Date.parse(message.indexItem.lastmod))).toBe(false);
      expect(sitemap.delete).toHaveBeenCalledTimes(1);
    },
  );

  it('deletes the partial local file after output closure fails', async () => {
    const { sitemap, stats, notify, opts } = fixture();
    const failure = new Error('output stream failed');
    sitemap.end.mockRejectedValue(failure);
    await expect(backgroundUploadSitemapWorker(opts)).rejects.toBe(failure);
    expect(sitemap.pushToS3).not.toHaveBeenCalled();
    expect(stats.save).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sitemap.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the closed local file after upload failure and publishes no metadata', async () => {
    const { sitemap, stats, notify, opts } = fixture();
    const failure = new Error('S3 rejected upload');
    sitemap.pushToS3.mockRejectedValue(failure);
    await expect(backgroundUploadSitemapWorker(opts)).rejects.toBe(failure);
    expect(stats.save).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sitemap.delete).toHaveBeenCalledTimes(1);
  });

  it('withholds the index message if saving file metadata fails', async () => {
    const { sitemap, stats, notify, opts } = fixture();
    const failure = new Error('DB rejected metadata');
    stats.save.mockRejectedValue(failure);
    await expect(backgroundUploadSitemapWorker(opts)).rejects.toBe(failure);
    expect(notify).not.toHaveBeenCalled();
    expect(sitemap.delete).toHaveBeenCalledTimes(1);
  });

  it('propagates exhausted index notification retries and still deletes the local file', async () => {
    const { sitemap, notify, opts } = fixture();
    const failure = new Error('Kinesis retries exhausted');
    notify.mockRejectedValue(failure);
    await expect(backgroundUploadSitemapWorker(opts)).rejects.toBe(failure);
    expect(sitemap.delete).toHaveBeenCalledTimes(1);
  });
});
