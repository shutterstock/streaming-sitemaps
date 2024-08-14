/**
 * Type-specific metrics emitted by the SitemapFreshenerConstruct
 *
 * These have metrics dimensions:
 * - LogGroup
 * - ServiceName
 * - ServiceType
 * - SitemapType (e.g. widget)
 */
export enum SitemapFreshenerTypedMetrics {
  /**
   * Events of `type` received.
   */
  EventsReceived = 'EventsReceived',

  /**
   * `start` operation wrote a `fileFreshen` message back to the stream
   */
  FileOpWritten = 'FileOpWritten',

  /**
   * Events of `type` skipped by `start` oepration because the file was recently written.
   */
  FileOpSkippedActive = 'FileOpSkippedActive',

  /**
   * Files written to S3
   */
  FileFreshenWrittenToS3 = 'FileFreshenWrittenToS3',

  /**
   * Files that would have been written to S3
   */
  FileFreshenDryRunToS3 = 'FileFreshenDryRunToS3',

  /**
   * Error occurred (e.g. empty sitemap)
   */
  FileFreshenFailed = 'FileFreshenFailed',

  /**
   * The new sitemap is too small compared to the old sitemap
   * Writing the sitemap was skipped as a result
   */
  FileFreshenTooSmall = 'FileFreshenTooSmall',

  /**
   * The new sitemap is too big by bytes
   */
  FileFreshenTooBigBytes = 'FileFreshenTooBigBytes',

  /**
   * The new sitemap is big by count
   */
  FileFreshenTooBigCount = 'FileFreshenTooBigCount',

  /**
   * Count of items read from the DB
   */
  ItemReceivedFromDB = 'ItemReceivedFromDB',

  /**
   * Count of items read from the S3 XML file, when `repairDB` is true
   */
  ItemReceivedFromS3 = 'ItemReceivedFromS3',

  /**
   * Count of total items written into an XML file (whether preserved or freshened)
   */
  ItemWritten = 'ItemWritten',

  /**
   * Count of items with `written` status - Preserved in XML file and not updated in the DB
   */
  ItemPreserved = 'ItemPreserved',

  /**
   * Count of items with `towrite` status - Updated in XML file and set to `written` in the DB
   */
  ItemFreshened = 'ItemFreshened',

  /**
   * Count of items with `toremove` status - removed from XML file and set to `removed` in the DB
   */
  ItemRemoved = 'ItemRemoved',

  /**
   * Count of items with `removed` status - skipped writing into an XML file that had status `removed` in the DB
   */
  ItemAlreadyRemoved = 'ItemAlreadyRemoved',

  /**
   * Count of items with invalid characters detected and scrubbed from the `SitemapItemLoose`
   */
  InvisibleCharsScrubbed = 'InvisibleCharsScrubbed',

  /**
   * `repairDB` only - Count of items written into the DB that were missing from the DB
   */
  ItemRepaired = 'ItemRepaired',

  /**
   * `repairDB` only - Count of items skipped writing into an XML file because another file owns this item
   */
  ItemRemovedS3NotOwned = 'ItemRemovedS3NotOwned',

  /**
   * `repairDB` only - Count of items skipped writing into an XML file because another file owns this item
   *
   * This is an unusual case, but it can happen if there is a crash of the Lambda after a file
   * is written to S3 but before the DB is updated.
   */
  ItemRemovedDBNotOwned = 'ItemRemovedDBNotOwned',
}
