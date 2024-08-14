/**
 * Type-specific metrics emitted by the IndexWriterConstruct
 *
 * These have metrics dimensions:
 * - LogGroup
 * - ServiceName
 * - ServiceType
 * - SitemapType (e.g. widget)
 */
export enum IndexWriterTypedMetrics {
  TypeStarted = 'TypeStarted',

  TypeDone = 'TypeDone',

  TypeFailed = 'TypeFailed',

  ActionUpdate = 'ActionUpdate',

  ActionAdd = 'ActionAdd',

  ActionUnknown = 'ActionUnknown',
}
