import path from 'path';
import fs from 'fs';
import * as s3 from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { heapdump, heapdumpOptions } from './heap-dump';

const s3Client = new s3.S3Client({});

interface heapdumps3Options extends heapdumpOptions {
  readonly bucketName: string;
  readonly bucketPrefix: string;
}

export class heapdumps3 extends heapdump {
  private _bucketName: string;
  private _bucketPrefix: string;

  /**
   * Monitor memory usage periodically.
   * Write a heap snapshot file when dumpAtBytes is exceeded.
   * Push the file to S3 on cleanup.
   */
  constructor(options: heapdumps3Options) {
    super(options);

    const { bucketName, bucketPrefix } = options;

    if (bucketName === undefined) {
      throw new TypeError('bucketName must be specified');
    }
    if (bucketPrefix === undefined) {
      throw new TypeError('bucketName must be specified');
    }

    this._bucketName = bucketName;
    this._bucketPrefix = bucketPrefix;
  }

  protected async cleanup(): Promise<void> {
    // This will get called by the base class

    if (this._writtenDumpFilename !== undefined && this._writtenDumpFilenameAndPath !== undefined) {
      // Push any file to S3 then proceed to original cleanup
      // Use up to 4 multi-part parallel uploads for items > 5 MB
      const upload = new Upload({
        client: s3Client,
        leavePartsOnError: false,
        params: {
          Bucket: this._bucketName,
          // start: 2021-07-29T20:00:00Z
          // Key: [YYYY-MM-DDTHH:MM:SSZ]/[shardId]]-[type]-[index].json
          Key: path.join(this._bucketPrefix, this._writtenDumpFilename),
          Body: fs.createReadStream(this._writtenDumpFilenameAndPath),
        },
      });
      await upload.done();
    }

    await super.cleanup();
  }
}
