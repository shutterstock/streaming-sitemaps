// Dependency order for packing, consumer verification, and publication.
// Private utilities and the three handlers are build inputs, not npm packages.
module.exports = Object.freeze([
  'sitemaps-models-lib',
  'sitemaps-db-lib',
  'sitemaps-metrics-lib',
  'sitemaps-wrapper-lib',
  'sitemaps-cli',
  'sitemaps-cdk',
]);
