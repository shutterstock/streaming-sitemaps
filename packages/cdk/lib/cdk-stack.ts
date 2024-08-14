import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SitemapsConstruct, SitemapFreshenerConstruct } from '@shutterstock/sitemaps-cdk';

/**
 * Demonstration of using the SitemapsConstruct and SitemapFreshenerConstruct
 *
 * ⚠️ CAUTION: This uses the "Easy Button" approach where the construct will create and own
 * the DynamoDB Table and S3 Bucket.  This approach is not a CDK best practice.
 *
 * The CDK best practice is to put "durable" assets like DynamoDB Tables and S3 Buckets
 * in a separate stack that is deployed once and managed separately from the application stack.
 * This ensures that data is preserved if the application stack has an accidental resource
 * id change that would cause the stateful resources to be deleted and recreated.
 */
export class SitemapsExampleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sitemaps = new SitemapsConstruct(this, 'SitemapsConstruct', {
      autoDeleteEverything: true,
      testBuild: false,
      env: 'dev',
      s3SitemapsPrefix: 'sitemaps',
    });

    if (sitemaps.dynamoDBTable === undefined) {
      throw new Error('dynamoDBTable must be set');
    }

    const freshener = new SitemapFreshenerConstruct(this, 'SitemapFreshenerConstruct', {
      autoDeleteEverything: true,
      testBuild: false,
      env: 'dev',
      kinesisInputStream: sitemaps.kinesisInputStream,
      s3SitemapsBucket: sitemaps.s3SitemapsBucket,
      s3SitemapsPrefix: 'sitemaps',
      dynamodbTable: sitemaps.dynamoDBTable,
    });
  }
}
