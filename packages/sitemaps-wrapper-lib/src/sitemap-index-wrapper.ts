import { ErrorLevel, IndexItem, SitemapIndexStream } from 'sitemap';
import path from 'path';
import { createReadStream } from 'fs-extra';
import { SitemapWrapperBase } from './sitemap-wrapper-base';

export { IndexItem };

export type SitemapIndexFileWrapperOptions = {
  compress?: boolean;
  filenameRoot?: string;
  limitCount?: number;
  limitBytes?: number;
  localDirectory?: string;
  lastFile?: string;
};

export class SitemapIndexWrapper extends SitemapWrapperBase {
  private _options: SitemapIndexFileWrapperOptions;
  public get options(): SitemapIndexFileWrapperOptions {
    return this._options;
  }

  /**
   * Asynchronous helper for SitemapStream.
   */
  constructor(options: SitemapIndexFileWrapperOptions) {
    const {
      compress = true,
      filenameRoot = 'sitemap-index',
      limitCount,
      limitBytes,
      localDirectory = '/tmp',
      lastFile,
    } = options;
    super({ compress, filenameRoot, limitCount, limitBytes, localDirectory });

    this._options = options;

    // Create the map
    this._sitemapOrIndex = new SitemapIndexStream({ level: ErrorLevel.SILENT });

    // Pipe to either file or gzip (then to file)
    this._sitemapOrIndex.pipe(this._sitemapDest);

    // Save a reference to the last file URL
    this._lastFileURL = lastFile;

    // Track written bytes
    // Note: This is only accuate after `.end()` is called
    // because of buffering in the streams - it causes
    // the computed size to lag non-deterministically from the current size
    // buffered + size written.
    this._sitemapOrIndex.on('data', this.countBytes.bind(this));
  }

  /**
   * Hydrate items from file
   * @param param0
   * @returns
   */
  public static async itemsFromFile({ sourceFileAndPath }: { sourceFileAndPath: string }): Promise<{
    items: IndexItem[];
  }> {
    const result = await super._fromStream({
      stream: createReadStream(sourceFileAndPath),
      compressed: sourceFileAndPath.endsWith('.gz'),
      type: 'index',
    });

    return { items: result.items };
  }

  /**
   * Asynchronously pull and hydrate from local file
   * @param bucketName - S3 bucket name
   * @returns
   */
  public static async fromFile({
    sourceFileAndPath,
    compress = true,
    filenameRoot = 'sitemap-index',
    limitCount,
    limitBytes,
    localDirectory = '/tmp',
  }: {
    sourceFileAndPath: string;
    compress?: boolean;
    filenameRoot?: string;
    limitCount?: number;
    limitBytes?: number;
    localDirectory?: string;
    bucketName: string;
    s3Directory?: string;
    siteBaseURL: string;
  }): Promise<{
    index: SitemapIndexWrapper;
    existing: boolean;
    items: IndexItem[];
  }> {
    const result = await super._fromStream({
      stream: createReadStream(sourceFileAndPath),
      compressed: sourceFileAndPath.endsWith('.gz'),
      type: 'index',
    });

    const { items } = result;
    let existing = true;
    if (items.length === 0) {
      existing = false;
    }

    // Let the wrapper create a new index stream
    const index = new SitemapIndexWrapper({
      compress,
      filenameRoot,
      limitCount,
      limitBytes,
      localDirectory,
    });

    await index.writeArray({ items });

    return { index, existing, items };
  }

  /**
   * Asynchronously pull and hydrate from S3
   * @param bucketName - S3 bucket name
   * @returns
   */
  public static async fromS3({
    bucketName,
    s3Directory = 'sitemaps/',
    compress = true,
    filenameRoot = 'sitemap-index',
    limitCount,
    limitBytes,
    localDirectory = '/tmp',
  }: {
    compress?: boolean;
    filenameRoot?: string;
    limitCount?: number;
    limitBytes?: number;
    localDirectory?: string;
    bucketName: string;
    s3Directory?: string;
  }): Promise<{
    index: SitemapIndexWrapper;
    existing: boolean;
    items: IndexItem[];
  }> {
    const filename = `${filenameRoot}.xml${compress ? '.gz' : ''}`;
    const s3Key = path.join(s3Directory, filename);

    const s3Result = await super._fromS3({
      bucketName,
      s3Key,
      type: 'index',
    });

    const { items } = s3Result;
    let existing = true;
    let lastFile: string | undefined = undefined;
    if (items.length === 0) {
      existing = false;
    } else {
      lastFile = items[items.length - 1].url;
    }

    // Let the wrapper create a new index stream
    const indexWrapper = new SitemapIndexWrapper({
      compress,
      filenameRoot,
      limitCount,
      limitBytes,
      localDirectory,
      lastFile,
    });

    await indexWrapper.writeArray({ items });

    return { index: indexWrapper, existing, items };
  }

  public async write({ item }: { item: IndexItem }): Promise<void> {
    await super.write({ item });
  }

  public async writeArray({ items }: { items: IndexItem[] }): Promise<void> {
    await super.writeArray({ items });
  }

  private _lastFileURL: string | undefined = undefined;
  public get lastFilename(): string | undefined {
    if (this._lastFileURL !== undefined) {
      const lastFileURL = new URL(this._lastFileURL);
      const filename = path.basename(lastFileURL.pathname);
      return filename;
    }
    return this._lastFileURL;
  }

  /**
   * All items written to the index via construction or `write`
   */
  public get items(): IndexItem[] {
    return this._items;
  }
}
