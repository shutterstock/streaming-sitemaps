/**
 * Non-type-specific metrics emitted by the IndexWriterConstruct
 *
 * These have metrics dimensions:
 * - LogGroup
 * - ServiceName
 * - ServiceType
 * - SitemapType (e.g. widget)
 */
export enum IndexWriterMetrics {
  DurationMS = 'DurationMS',

  EventReceived = 'EventReceived',
  EventIncomplete = 'EventIncomplete',
  EventComplete = 'EventComplete',
  EventFailed = 'EventFailed',

  MsgReceived = 'MsgReceived',
}
