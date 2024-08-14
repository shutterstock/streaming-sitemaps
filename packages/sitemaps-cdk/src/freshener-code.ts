import { existsSync } from 'fs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Code for the Sitemap Freshener Lambda used to refresh sitemap files from DynamoDB
 *
 * Using this directly requires specifying these environment variables:
 * - S3_SITEMAPS_BUCKET_NAME - S3 bucket name for the sitemaps-writer
 * - TABLE_NAME - DynamoDB table name used by sitemaps-writer
 *
 * Optional environment variables:
 * - NODE_CONFIG_ENV - Suffix used to find env-specific config file overrides (default: none)
 * - S3_DIRECTORY - S3 directory to write files into (default: 'sitemaps/')
 * - SITE_BASE_SITEMAP_PATH - Base path of the sitemaps on the website (for sitemap index links) (default: 'sitemaps')
 * - KINESIS_SELF_STREAM_NAME - Compaction: Kinesis stream name for the sitemaps-writer
 */
export function FreshenerCode() {
  return existsSync(path.join(__dirname, 'kinesis-sitemap-freshener', 'index.js'))
    ? // This is for built apps packaged with the CDK construct
      lambda.Code.fromAsset(path.join(__dirname, 'kinesis-sitemap-freshener'))
    : // This is for local builds and tests before the lambda has been bundled
      lambda.Code.fromAsset(path.join(__dirname, 'fake-handler', 'dummy.js'));
}
