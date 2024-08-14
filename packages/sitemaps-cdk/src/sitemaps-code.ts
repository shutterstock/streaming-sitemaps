import { existsSync } from 'fs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Code for the Sitemap Writer Lambda used to write items into sitemaps
 * with a copy in DynamoDB for deduplication and updates via the Freshener Lambda
 *
 * Using this directly requires specifying these environment variables:
 * - S3_SITEMAPS_BUCKET_NAME - S3 bucket name
 * - TABLE_NAME - DynamoDB table name
 * - KINESIS_INDEX_WRITER_NAME - Kinesis stream name for the index-writer
 *
 * Optional environment variables:
 * - NODE_CONFIG_ENV - Suffix used to find env-specific config file overrides (default: none)
 * - S3_DIRECTORY - S3 directory to write files into (default: 'sitemaps/')
 * - SITE_BASE_SITEMAP_PATH - Base path of the sitemaps on the website (for sitemap index links) (default: 'sitemaps')
 * - KINESIS_SELF_STREAM_NAME - Compaction: Kinesis stream name of the sitemaps-writer (used for compacting messages)
 */
export function SitemapWriterCode() {
  return existsSync(path.join(__dirname, 'kinesis-sitemap-writer', 'index.js'))
    ? // This is for built apps packaged with the CDK construct
      lambda.Code.fromAsset(path.join(__dirname, 'kinesis-sitemap-writer'))
    : // This is for local builds and tests before the lambda has been bundled
      lambda.Code.fromAsset(path.join(__dirname, 'fake-handler', 'dummy.js'));
}

/**
 * Code for the Index Writer Lambda used to write items into the index
 *
 * Using this directly requires specifying these environment variables:
 * - S3_SITEMAPS_BUCKET_NAME - S3 bucket name
 * - TABLE_NAME - DynamoDB table name
 *
 * Optional environment variables:
 * - NODE_CONFIG_ENV - Suffix used to find env-specific config file overrides (default: none)
 * - S3_DIRECTORY - S3 directory to write files into (default: 'sitemaps/')
 * - SITE_BASE_SITEMAP_PATH - Base path of the sitemaps on the website (for sitemap index links) (default: 'sitemaps')
 */
export function IndexWriterCode() {
  return existsSync(path.join(__dirname, 'kinesis-index-writer', 'index.js'))
    ? // This is for built apps packaged with the CDK construct
      lambda.Code.fromAsset(path.join(__dirname, 'kinesis-index-writer'))
    : // This is for local builds and tests before the lambda has been bundled
      lambda.Code.fromAsset(path.join(__dirname, 'fake-handler', 'dummy.js'));
}
