import { SitemapItemLoose } from 'sitemap';

/**
 * Per-item message structure for the Kinesis sitemap writer stream.
 * Producer: source of sitemap data events
 * Consumer: kinesis-sitemap-writer
 */
export interface ISitemapWriterItem {
  /**
   * Sitemap data to be written into the Sitemap XML file as-is
   */
  sitemapItem: SitemapItemLoose;

  /**
   * Unique identifier (within a type, if specified) for each record.
   *
   * Used as part of the key in the DynamoDB table
   *
   * @example '123456'
   */
  customId: string;

  /**
   * Type namespace - corresponds to an input type, but also causes
   * a sitemap index to be created for the type that contains
   * only that type.
   *
   * Used as part of the key in the DynamoDB table
   *
   * @example 'widget'
   */
  type?: string;

  /**
   * Compact version number
   *
   * When the lambda is expecting a particular compact version number,
   * such as `2`, it will handle records as follows:
   *   - version missing: de-duplicate items and write the unique
   *     records back to the Kinesis input stream with version set
   *     to `2`
   *   - version less than `2`: same as version missing
   *   - version `2` or greater: normal processing
   *
   * Typically the source (e.g. another labmda that writes into
   * the Kinesis input stream) should be paused while handling a
   * compaction.  Order will be maintained if no new
   * records are being written into the Kinesis stream from another
   * source.  After the compaction is completed, the other
   * source can be resumed.
   */
  compactVersion?: number;
}
