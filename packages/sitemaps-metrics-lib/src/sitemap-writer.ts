/**
 * Non-type-specific metrics emitted by the SitemapWriterConstruct
 *
 * These have metrics dimensions:
 * - LogGroup
 * - ServiceName
 * - ServiceType
 * - SitemapType (e.g. widget)
 */
export enum SitemapWriterMetrics {
  DurationMS = 'DurationMS',

  EventReceived = 'EventReceived',
  EventIncomplete = 'EventIncomplete',
  EventComplete = 'EventComplete',
  EventFailed = 'EventFailed',

  MsgReceived = 'MsgReceived',
  MsgSkipped = 'MsgSkipped',

  ExceptionCompactVersion = 'ExceptionCompactVersion',
  KinesisBackgroundWriterError = 'KinesisBackgroundWriterError',
}
