import fs, { createWriteStream, WriteStream } from 'fs-extra';
import { IndexItem, SitemapIndexStream, SitemapItemLoose, SitemapStream } from 'sitemap';
import zlib, { createGunzip } from 'zlib';
import { finished, Readable } from 'stream';
import { promisify } from 'util';
import path from 'path';
import * as s3 from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { parseSitemapIndex, parseSitemap } from 'sitemap';

const finishedAsync = promisify(finished);
let s3Client = new s3.S3Client({});
export function SitemapWrapperOverrideAWSClients(opts: { s3Client: s3.S3Client }): void {
  s3Client = opts.s3Client;
}

export class SitemapWriteWouldOverflow extends Error {
  constructor(m: string) {
    super(m);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, SitemapWriteWouldOverflow.prototype);
  }
}

export class SitemapAlreadyFull extends Error {
  constructor(m: string) {
    super(m);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, SitemapAlreadyFull.prototype);
  }
}

export class SitemapWrapperBase {
  protected _writtenUncompressedBytes: number;
  protected _writtenTroughUncompressedBytes = 0;
  protected _count = 0;
  protected _items: SitemapItemLoose[] = [];
  protected _sitemapOrIndex?: SitemapStream | SitemapIndexStream;
  protected readonly _fileStream: WriteStream;
  protected readonly _gzip?: zlib.Gzip;
  protected readonly _compress: boolean;
  protected readonly _limitCount: number;
  protected readonly _limitBytes: number;
  protected readonly _filenameAndPath: string;
  protected readonly _filename: string;
  protected readonly _sitemapDest: WriteStream | zlib.Gzip;
  protected readonly _xmlHeaderSize = 336;

  /**
   * Asynchronous helper for SitemapStream.
   */
  protected constructor({
    compress,
    filenameRoot,
    limitCount = 50000,
    limitBytes = 45 * 1024 * 1024, // Limit is 50 MB for Google
    localDirectory,
  }: {
    compress: boolean;
    filenameRoot: string;
    limitCount?: number;
    limitBytes?: number;
    localDirectory: string;
  }) {
    if (limitCount > 50000 || limitCount <= 0) {
      throw new Error('Sitemaps must contain 50,000 or less items');
    }

    this._limitCount = limitCount;
    this._limitBytes = limitBytes;
    this._writtenUncompressedBytes = this._xmlHeaderSize;
    this._compress = compress;
    this._filename = `${filenameRoot}.xml${this._compress ? '.gz' : ''}`;
    this._filenameAndPath = path.join(localDirectory, this._filename);

    // Create the directory if it doesn't exist
    if (!fs.pathExistsSync(localDirectory)) {
      fs.mkdirpSync(localDirectory);
    }

    // Create the file write stream now that the path exists
    this._fileStream = createWriteStream(this._filenameAndPath);

    this._sitemapDest = this._fileStream;
    if (this._compress) {
      this._gzip = zlib.createGzip();
      this._gzip.pipe(this._fileStream);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this._sitemapDest = this._gzip!;
    }
  }

  /**
   * Count the bytes emitted by the SitemapStream or SitemapIndexStream
   *
   * @param chunk
   */
  protected countBytes(chunk: string): void {
    this._writtenTroughUncompressedBytes += Buffer.from(chunk, 'utf-8').length;
  }

  /**
   * Asynchronously write an array of SitemapItemLoose items to the file
   */
  protected async writeArray({
    items,
    disregardByteLimit = false,
    disregardCountLimit = false,
  }: {
    items: SitemapItemLoose[];
    disregardByteLimit?: boolean;
    disregardCountLimit?: boolean;
  }): Promise<void> {
    for (const item of items) {
      await this.write({ item, disregardByteLimit, disregardCountLimit });
    }
  }

  /**
   * Asynchronously write a line containing one SitemapItemLoose or IndexItem to the file
   */
  protected async write({
    item,
    disregardByteLimit = false,
    disregardCountLimit = false,
  }: {
    item: SitemapItemLoose | IndexItem;
    disregardByteLimit?: boolean;
    disregardCountLimit?: boolean;
  }): Promise<void> {
    if (this._sitemapOrIndex === undefined) {
      throw new Error('cannot write to sitemap after closed');
    }

    if (!disregardCountLimit) {
      if (this.fullCount) {
        throw new SitemapAlreadyFull(
          `Cannot write to already full sitemap: ${this._count} of ${this._limitCount} item limit, ${this._writtenUncompressedBytes} bytes of ${this._limitBytes} bytes limit`,
        );
      }
    }

    // Cheesy size computation - JSON string size * fudge factor (XML is large)
    const bytesToWrite = Math.ceil(this.itemSize(item) * 1.5);

    // When loading an existing Sitemap from XML we disregard the byte limit
    // because the file is what it is... after loading we will check if it's full
    if (!disregardByteLimit) {
      if (this.fullBytes) {
        throw new SitemapAlreadyFull(
          `Cannot write to already full sitemap: ${this._count} of ${this._limitCount} item limit, ${this._writtenUncompressedBytes} bytes of ${this._limitBytes} bytes limit`,
        );
      }

      // Check if this write would cause an overflow
      if (this._writtenUncompressedBytes + bytesToWrite > this._limitBytes) {
        throw new SitemapWriteWouldOverflow(
          `Writing ${bytesToWrite} bytes would overflow sitemap with bytes limit ${this._limitBytes}, current bytes total ${this._writtenUncompressedBytes}`,
        );
      }
    }

    // We will add the item, increment both counts
    this._count++;
    this._writtenUncompressedBytes += bytesToWrite;

    return new Promise<void>((resolve, reject) => {
      this._sitemapOrIndex?.write(item, (error) => {
        if (error !== undefined && error !== null) {
          reject(error);
        } else {
          // Keep a copy of the item in the accumulated array
          this._items.push(item);
          resolve();
        }
      });
    });
  }

  /**
   * Asynchronously finish writing to the stream and wait for the file to close
   */
  public async end(): Promise<{ filenameAndPath: string }> {
    if (this._sitemapOrIndex === undefined) {
      throw new Error('cannot close sitemap after closed');
    }

    if (this.count === 0) {
      this._sitemapOrIndex.destroy();
    } else {
      this._sitemapOrIndex.end();
      await finishedAsync(this._fileStream);
    }

    delete this._sitemapOrIndex;

    return { filenameAndPath: this._filenameAndPath };
  }

  /**
   * Asynchronously use a multi-part upload to push the file to S3
   * @param bucketName - S3 bucket name
   * @returns
   */
  public async pushToS3({
    bucketName,
    s3Directory = 'sitemaps/',
  }: {
    bucketName: string;
    s3Directory?: string;
  }): Promise<{ filenameAndPath: string; s3Path: string }> {
    if (this._sitemapOrIndex !== undefined) {
      throw new Error('cannot push sitemap to s3 until closed');
    }

    // Use up to 4 multi-part parallel uploads for items > 5 MB
    const s3Key = path.join(s3Directory, this._filename);
    const s3Path = `s3://${path.join(bucketName, s3Key)}`;
    const upload = new Upload({
      client: s3Client,
      leavePartsOnError: false,
      params: {
        Bucket: bucketName,
        Key: path.join(s3Directory, this._filename),
        Body: fs.createReadStream(this._filenameAndPath),
        ...(this._compress ? { ContentEncoding: 'gzip' } : {}),
        ContentType: 'application/xml',
        // Default to up to 15 minutes of caching
        CacheControl: `max-age=${15 * 60}; public`,
      },
    });
    await upload.done();

    return { filenameAndPath: this._filenameAndPath, s3Path };
  }

  // our updater stream
  // private static updateEntries = new Transform({
  //   objectMode: true,
  //   transform(chunk: SitemapItemLoose, encoding, callback) {
  //     callback(undefined, chunk);
  //   },
  // });

  /**
   * Asynchronously hydrate from a readable
   * @param bucketName - S3 bucket name
   * @returns
   */
  protected static async _fromStream({
    stream,
    type,
    compressed = false,
  }: {
    compressed: boolean;
    stream: Readable;
    type: 'sitemap' | 'index';
  }): Promise<{
    items: IndexItem[] | SitemapItemLoose[];
  }> {
    if (stream !== undefined) {
      // If there are contents, pipe them through into the map
      // Hydrate map/index from the stream
      // (result.Body as Readable)
      //   .pipe(createGunzip(), { end: false })
      //   .pipe(new XMLToSitemapIndexStream())
      //   .pipe(map);

      let uncompressedReadable: Readable;
      if (compressed) {
        uncompressedReadable = stream.pipe(createGunzip());
      } else {
        uncompressedReadable = stream;
      }

      if (type === 'index') {
        const items = await parseSitemapIndex(uncompressedReadable);
        return { items };
      } else {
        const items = await parseSitemap(uncompressedReadable);
        return { items };
      }
    } else {
      return { items: [] };
    }
  }

  /**
   * Asynchronously pull and hydrate from S3
   * @param bucketName - S3 bucket name
   * @returns
   */
  protected static async _fromS3({
    bucketName,
    s3Key,
    type,
  }: {
    bucketName: string;
    s3Key: string;
    type: 'sitemap' | 'index';
  }): Promise<{
    items: IndexItem[] | SitemapItemLoose[];
  }> {
    let existingBody: Readable | undefined = undefined;
    try {
      const result = await s3Client.send(
        new s3.GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
      );
      existingBody = result.Body as Readable;
    } catch (error: any) {
      if (!(error instanceof s3.NoSuchKey)) {
        throw error;
      }
      // Disregard - NoSuchKey - This just means the item definitely does not exist
    }

    if (existingBody !== undefined) {
      // If there are contents, pipe them through into the map
      // Hydrate map/index from the stream
      // (result.Body as Readable)
      //   .pipe(createGunzip(), { end: false })
      //   .pipe(new XMLToSitemapIndexStream())
      //   .pipe(map);

      // Pipe through gunzip if gzipped
      let uncompressedReadable: Readable;
      if (s3Key.endsWith('.gz')) {
        uncompressedReadable = existingBody.pipe(createGunzip());
      } else {
        uncompressedReadable = existingBody;
      }

      if (type === 'index') {
        const items = await parseSitemapIndex(uncompressedReadable);
        return { items };
      } else {
        const items = await parseSitemap(uncompressedReadable);
        return { items };
      }
    } else {
      return { items: [] };
    }
  }

  public async delete(): Promise<void> {
    if (this._sitemapOrIndex !== undefined) {
      throw new Error('cannot delete sitemap until closed');
    }

    if (await fs.pathExists(this._filenameAndPath)) {
      await fs.unlink(this._filenameAndPath);
    }
  }

  public get ended(): boolean {
    return this._sitemapOrIndex === undefined;
  }

  public get full(): boolean {
    return this._writtenUncompressedBytes >= this._limitBytes || this._count >= this._limitCount;
  }

  protected get fullCount(): boolean {
    return this._count >= this._limitCount;
  }

  public get fullBytes(): boolean {
    return this._writtenUncompressedBytes >= this._limitBytes;
  }

  public get sizeUncompressed(): number {
    return this._writtenUncompressedBytes;
  }

  /**
   * WARNING: This cannot be called under after `.end()` is called.
   * Calling before `.end()` will result in an error.
   *
   * Sum of the uncompressed size of all bytes emitted by the
   * SitemapStream or SitemapIndexStream.
   *
   * Useful for a final check that the estimated size during writing
   * did not result in a file that is too large when uncompressed.
   */
  public get sizeUncompressedBytesEmitted(): number {
    if (this._sitemapOrIndex !== undefined) {
      throw new TypeError('cannot get size of dest stream until closed');
    }
    return this._writtenTroughUncompressedBytes;
  }

  protected itemSize(item: SitemapItemLoose | IndexItem): number {
    return JSON.stringify(item).length;
  }

  public get count(): number {
    return this._count;
  }

  public get filename(): string {
    return this._filename;
  }

  public get filenameAndPath(): string {
    return this._filenameAndPath;
  }
}
