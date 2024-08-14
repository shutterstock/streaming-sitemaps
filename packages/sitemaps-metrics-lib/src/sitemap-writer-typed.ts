/**
 * Type-specific metrics emitted by the SitemapWriterConstruct
 *
 * These have metrics dimensions:
 * - LogGroup
 * - ServiceName
 * - ServiceType
 * - SitemapType (e.g. widget)
 */
export enum SitemapWriterTypedMetrics {
  TypeStarted = 'TypeStarted',

  /**
   * Reached end of Type loop for current Type without throwing out
   */
  TypeDone = 'TypeDone',

  /**
   * Caught exception for Type within the Type loop
   */
  TypeFailed = 'TypeFailed',

  /**
   * Count of items received of Type
   */
  Items = 'Items',

  /**
   * Times a type is skipped because it has no items
   */
  NoItems = 'NoItems',

  /**
   * Item was written to a Sitemap file
   */
  SitemapItemWritten = 'SitemapItemWritten',

  /**
   * Record was found in DB and compacted.
   *
   * Records are compacted when:
   * - `incomingCompactVersion` is set in the config
   * - `compactVersion` is undefined
   *    OR `compactVersion` is set and `incomingCompactVersion` is greater
   */
  DuplicateCompacted = 'DuplicateCompacted',

  /**
   * Item belongs to a file that is not the current file for the
   * current shard, so the item must be skipped.
   */
  DuplicateSkipped = 'DuplicateSkipped',

  /**
   * Earlier record, in the input data, for the same type/id was replaced
   * by a later record in the same batch, since only the
   * last record is processed.
   */
  DuplicateSkippedInput = 'DuplicateSkippedInput',

  /**
   * Record was not found in the DB but was compacted.
   *
   * Records are compacted when:
   * - `incomingCompactVersion` is set in the config
   * - `compactVersion` is undefined
   *    OR `compactVersion` is set and `incomingCompactVersion` is greater
   */
  UniqueCompacted = 'UniqueCompacted',

  /**
   * Record was found in the DB but was not expected to be/
   */
  PreFetcherUnexpectedDuplicate = 'PreFetcherUnexpectedDuplicate',

  /**
   * Record was not found in the DB.
   */
  PreFetcherInvalidDBItem = 'PreFetcherInvalidDBItem',

  /**
   * Record was found in the DB and was hydrated.
   */
  PreFetcherHydratedItem = 'PreFetcherHydratedItem',

  /**
   * Count of times that items were lost (not processed) while processing this type
   */
  PreFetcherLostItems = 'PreFetcherLostItems',

  SitemapFile1Recreated = 'SitemapFile1Recreated',

  SitemapLast1Empty = 'SitemapLast1Empty',

  SitemapLastFetch = 'SitemapLastFetch',

  SitemapLastFetchDone = 'SitemapLastFetchDone',

  SitemapLastParseFailed = 'SitemapLastParseFailed',

  SitemapLastFetchFailed = 'SitemapLastFetchFailed',

  SitemapFileCreated = 'SitemapFileCreated',

  SitemapLastFull = 'SitemapLastFull',

  SitemapLastNotFull = 'SitemapLastNotFull',

  SitemapLastNone = 'SitemapLastNone',
}
