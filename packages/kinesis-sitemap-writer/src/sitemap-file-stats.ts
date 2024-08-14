import { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import { DBManager, FileRecord, IFileRecord } from '@shutterstock/sitemaps-db-lib';

export class SitemapFileAndStatsS3LoadFailed extends Error {
  constructor(m: string) {
    super(m);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, SitemapFileAndStatsS3LoadFailed.prototype);
  }
}

export class SitemapFileAndStatsFileRecordFailed extends Error {
  constructor(m: string) {
    super(m);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, SitemapFileAndStatsFileRecordFailed.prototype);
  }
}

export class SitemapFileAndStats {
  private _sitemap: SitemapFileWrapper;
  private _stats: FileRecord;
  private _existing: boolean;

  constructor(opts: { sitemap: SitemapFileWrapper; existing: boolean; stats: FileRecord }) {
    this._sitemap = opts.sitemap;
    this._stats = opts.stats;
    this._existing = opts.existing;
  }

  public static async fromS3(
    mapOpts: {
      compress?: boolean;
      filenameRoot: string;
      limitCount?: number;
      limitBytes?: number;
      localDirectory?: string;
      bucketName: string;
      s3Directory?: string;
      siteBaseURL: string;
    },
    statOpts: {
      key: Pick<IFileRecord, 'Type'>;
      dbManager: DBManager;
    },
  ): Promise<SitemapFileAndStats> {
    const sitemap = await SitemapFileWrapper.fromS3(mapOpts);

    if (!sitemap.existing) {
      throw new SitemapFileAndStatsS3LoadFailed(
        'SitemapFileAndStats.fromS3 - File not found on S3 - This function cannot be called on non-existing files',
      );
    }

    const stats = await FileRecord.loadOne(statOpts.dbManager, {
      Type: statOpts.key.Type,
      FileName: sitemap.sitemap.filename,
    });
    if (stats === undefined) {
      throw new SitemapFileAndStatsFileRecordFailed(
        `FileRecord.loadOne failed for ${statOpts.key.Type}, ${sitemap.sitemap.filename}`,
      );
    }

    const result = new SitemapFileAndStats({
      sitemap: sitemap.sitemap,
      existing: sitemap.existing,
      stats,
    });
    return result;
  }

  public get sitemap(): SitemapFileWrapper {
    return this._sitemap;
  }

  public get existing(): boolean {
    return this._existing;
  }

  public get stats(): FileRecord {
    return this._stats;
  }
}
