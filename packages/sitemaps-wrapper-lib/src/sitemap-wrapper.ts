import { ErrorLevel, SitemapItemLoose, SitemapStream } from 'sitemap';
import path from 'path';
import cloneDeep from 'lodash/cloneDeep';
import { SitemapWrapperBase } from './sitemap-wrapper-base';
import { createReadStream } from 'fs-extra';

export type SitemapFileWrapperOptions = {
  compress?: boolean;
  filenameRoot?: string;
  limitCount?: number;
  limitBytes?: number;
  siteBaseURL: string;
  localDirectory?: string;
};

export class SitemapFileWrapper extends SitemapWrapperBase {
  protected _siteBaseURL: string;
  private _options: SitemapFileWrapperOptions;
  public get options(): SitemapFileWrapperOptions {
    return this._options;
  }

  /**
   * Asynchronous helper for SitemapStream.
   */
  constructor(options: SitemapFileWrapperOptions) {
    const {
      compress = true,
      filenameRoot = 'sitemap',
      limitCount,
      limitBytes,
      siteBaseURL,
      localDirectory = '/tmp',
    } = options;
    super({ compress, filenameRoot, limitCount, limitBytes, localDirectory });

    this._options = options;

    this._siteBaseURL = siteBaseURL;

    // Create the map
    this._sitemapOrIndex = new SitemapStream({
      hostname: siteBaseURL,
      level: ErrorLevel.SILENT,
    });

    // Pipe to either file or gzip (then to file)
    this._sitemapOrIndex.pipe(this._sitemapDest);

    // Track written bytes
    // Note: This is only accuate after `.end()` is called
    // because of buffering in the streams - it causes
    // the computed size to lag non-deterministically from the current size
    // buffered + size written.
    this._sitemapOrIndex.on('data', this.countBytes.bind(this));
  }

  /**
   * Asynchronously pull and hydrate from local file
   * @param bucketName - S3 bucket name
   * @returns
   */
  public static async fromFile({
    sourceFileAndPath,
    compress = true,
    filenameRoot = 'sitemap',
    limitCount,
    limitBytes,
    localDirectory = '/tmp',
    siteBaseURL,
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
    sitemap: SitemapFileWrapper;
    existing: boolean;
    items: SitemapItemLoose[];
  }> {
    const result = await super._fromStream({
      stream: createReadStream(sourceFileAndPath),
      compressed: sourceFileAndPath.endsWith('.gz'),
      type: 'sitemap',
    });

    const { items } = result;
    let existing = true;
    if (items.length === 0) {
      existing = false;
    }

    // Let the wrapper create a new sitemap stream
    const sitemap = new SitemapFileWrapper({
      compress,
      filenameRoot,
      limitCount,
      limitBytes,
      localDirectory,
      siteBaseURL,
    });

    await sitemap.writeArray({ items, disregardByteLimit: true });

    return { sitemap, existing, items };
  }

  /**
   * Asynchronously pull and hydrate from S3
   *
   * Does *not* create a new `SitemapFileWrapper`
   */
  public static async itemsFromS3({
    bucketName,
    s3Directory = 'sitemaps/',
    compress = true,
    filenameRoot = 'sitemap',
  }: {
    compress?: boolean;
    filenameRoot?: string;
    bucketName: string;
    s3Directory?: string;
  }): Promise<{
    existing: boolean;
    items: SitemapItemLoose[];
  }> {
    const filename = `${filenameRoot}.xml${compress ? '.gz' : ''}`;
    const s3Key = path.join(s3Directory, filename);

    const s3Result = await super._fromS3({
      bucketName,
      s3Key,
      type: 'sitemap',
    });

    const { items } = s3Result;
    let existing = true;
    if (items.length === 0) {
      existing = false;
    }

    return { existing, items };
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
    filenameRoot = 'sitemap',
    limitCount,
    limitBytes,
    localDirectory = '/tmp',
    siteBaseURL,
  }: {
    compress?: boolean;
    filenameRoot?: string;
    limitCount?: number;
    limitBytes?: number;
    localDirectory?: string;
    bucketName: string;
    s3Directory?: string;
    siteBaseURL: string;
  }): Promise<{
    sitemap: SitemapFileWrapper;
    existing: boolean;
    items: SitemapItemLoose[];
  }> {
    const { items, existing } = await SitemapFileWrapper.itemsFromS3({
      bucketName,
      s3Directory,
      compress,
      filenameRoot,
    });

    // Let the wrapper create a new sitemap stream
    const sitemap = new SitemapFileWrapper({
      compress,
      filenameRoot,
      limitCount,
      limitBytes,
      localDirectory,
      siteBaseURL,
    });

    await sitemap.writeArray({ items, disregardByteLimit: true });

    return { sitemap, existing, items };
  }

  public async write({
    item,
    disregardByteLimit = false,
    disregardCountLimit = false,
  }: {
    item: SitemapItemLoose;
    disregardByteLimit?: boolean;
    disregardCountLimit?: boolean;
  }): Promise<void> {
    await super.write({ item, disregardByteLimit, disregardCountLimit });
  }

  public async writeArray({
    items,
    disregardByteLimit = false,
    disregardCountLimit = false,
  }: {
    items: SitemapItemLoose[];
    disregardByteLimit?: boolean;
    disregardCountLimit?: boolean;
  }): Promise<void> {
    await super.writeArray({ items, disregardByteLimit, disregardCountLimit });
  }

  protected itemSize(item: SitemapItemLoose): number {
    const itemClone = cloneDeep(item);

    // Remove the arrays if empty
    if (
      itemClone.video !== undefined &&
      itemClone.video instanceof Array &&
      itemClone.video.length === 0
    ) {
      delete itemClone.video;
    }
    if (
      itemClone.img !== undefined &&
      itemClone.img instanceof Array &&
      itemClone.img.length === 0
    ) {
      delete itemClone.img;
    }
    if (
      itemClone.news !== undefined &&
      itemClone.news instanceof Array &&
      itemClone.news.length === 0
    ) {
      delete itemClone.news;
    }
    if (
      itemClone.links !== undefined &&
      itemClone.links instanceof Array &&
      itemClone.links.length === 0
    ) {
      delete itemClone.links;
    }

    // Fully justify the item path
    // Writing a new map will often just have the path in the items,
    // but the written XML map will have the base url prefixed on each item.
    // Reading a file back from S3 will have the base url on each item as a result.
    // We want the space computation for new and existing to be roughly the same.
    itemClone.url = new URL(item.url, this._siteBaseURL).toString();
    const length = JSON.stringify(itemClone).length;
    return length;
  }

  /**
   * All items written to the index via construction or `write`
   */
  public get items(): SitemapItemLoose[] {
    return this._items;
  }
}
