export type FreshenerOperations = 'start' | 'freshenFile';

/**
 * Per-item message structure for the Kinesis sitemap freshner stream.
 * Producer: CLI, AWS Console - Just submit a `start` operation with the `type` to freshen
 * Consumer: kinesis-sitemap-freshner
 */
export interface ISitemapFreshenerMessageBase {
  /**
   * Operation to perform
   */
  operation: FreshenerOperations;

  /**
   * false - Do not actually write anything to DB or S3
   * true - Write to S3, write to DB only if dryRunDB is also false
   *
   * @default true
   */
  dryRun?: boolean;

  /**
   * false - Do not write to DB
   * true - Write to DB
   *
   * Requires: dryRun to be false
   *
   * @default true
   */
  dryRunDB?: boolean;

  /**
   * The `type` field in the key in the DynamoDB table with the sitemaps being freshened.
   *
   * @example 'widget'
   */
  type?: string;

  /**
   * Override the s3 upload directory - useful for testing before overwriting live files.
   *
   * If set in the `start` operation, this will be copied to all `freshenFile` operations.
   *
   * @example 'sitemaps-freshen-test/'
   */
  s3DirectoryOverride?: string;

  /**
   * ItemID regular expression to parse the `ItemID` out of the URL in the S3 sitemaps
   */
  itemIDRegex?: string;

  /**
   * Repair the DB table using records from the S3 sitemap files
   *
   * Will add missing records to the DB table that are present in the S3 files.
   *
   * @default false
   */
  repairDB?: boolean;
}

export interface ISitemapFreshenerStartMessage extends ISitemapFreshenerMessageBase {
  operation: 'start';
}

export interface ISitemapFreshenerFreshenFileMessage extends ISitemapFreshenerMessageBase {
  operation: 'freshenFile';

  /**
   * The `filename` field in the key of the DynamoDB table with the sitemaps being freshened.
   *
   * @example 'widget-2022-03-01-001-00001.xml'
   */
  filename?: string;
}

/**
 * Lambda Event
 */

export interface ISitemapFreshenerLambdaEvent {
  Records: ISitemapFreshenerMessageBase[];
}

/**
 * Results for Direct Invoke
 */
export interface ISitemapFreshenerResultBase {
  readonly message:
    | ISitemapFreshenerFreshenFileMessage
    | ISitemapFreshenerStartMessage
    | ISitemapFreshenerMessageBase;
}

export interface ISitemapFreshenerStartResult extends ISitemapFreshenerResultBase {
  /**
   * Echo back of the incoming message
   */
  readonly message: ISitemapFreshenerStartMessage;

  /**
   * Total count of files of this type in the DB
   */
  readonly filesOfType?: number;

  /**
   * Count of files written into the KinesisStream for the Freshener to process
   */
  readonly filesWritten?: number;

  /**
   * Count of files skipped because they are currently active (current file for a shard)
   */
  readonly filesSkippedActive?: number;

  /**
   * Was the URL regex valid
   */
  readonly urlRegexValid?: boolean;

  /**
   * Extracted item IDs using the regex
   */
  readonly itemIDsSample?: { itemID: string; url: string }[];

  /**
   * Result of whether dry run for the files is allowed by the lambda and the incoming flag
   */
  readonly computedDryRun?: boolean;

  /**
   * Result of whether dry run for the DB is allowed by the lambda and the incoming flag
   */
  readonly computedDryRunDB?: boolean;

  /**
   * Echo back of the dry run flag on the incoming message
   */
  readonly incomingDryRun?: boolean;

  /**
   * Error message, if any
   */
  readonly error?: string;
}

export interface ISitemapFreshenerFreshenFileResult extends ISitemapFreshenerResultBase {
  readonly message: ISitemapFreshenerFreshenFileMessage;
}
