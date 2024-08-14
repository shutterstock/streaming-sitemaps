/**
 * Non-type-specific metrics emitted by the SitemapFreshenerConstruct
 *
 * These have metrics dimensions:
 * - LogGroup
 * - ServiceName
 * - ServiceType
 * - SitemapType (e.g. widget)
 */
export enum SitemapFreshenerMetrics {
  DurationMS = 'DurationMS',

  EventReceived = 'EventReceived',
  EventIncomplete = 'EventIncomplete',
  EventComplete = 'EventComplete',
  EventFailed = 'EventFailed',
  EventDone = 'EventDone',

  MsgReceived = 'MsgReceived',
}
