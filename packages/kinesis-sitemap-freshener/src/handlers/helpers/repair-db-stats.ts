export type RepairDBStats = {
  // S3 Stats
  s3SitemapCountBefore?: number;
  s3SitemapCountDeduped?: number;
  s3SitemapItemInDbCountSameFile: number;
  s3SitemapItemInDbCountDiffFile: number;
  s3SitemapItemNotInDbCount: number;

  // DB By-FileName Stats
  consolidatedItemIDsDeduped?: number;
  dbSitemapItemInDbCountSameFile: number;
  dbSitemapItemInDbCountDiffFile: number;
};
