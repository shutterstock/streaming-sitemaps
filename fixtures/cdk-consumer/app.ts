import { App, Duration, Stack } from 'aws-cdk-lib';
import { Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import {
  ISitemapsConstruct,
  SitemapFreshenerConstruct,
  SitemapFreshnerConstructProps,
  SitemapsConstruct,
  SitemapsConstructProps,
} from '@shutterstock/sitemaps-cdk';

// Explicit environment values need no account/region lookups or credentials.
export function createConsumer() {
  const app = new App({ outdir: 'cdk.out' });
  const stack = new Stack(app, 'PackageConsumer', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const props: SitemapsConstructProps = {
    env: 'consumer',
    kinesisInputStreamName: 'consumer-input',
    kinesisInputStreamShards: 2,
    kinesisSitemapWriterRetentionDays: 2,
    s3SitemapsBucketName: 'consumer-sitemaps-fixture',
    dynamodbTableName: 'consumer-sitemaps',
    s3SitemapsPrefix: 'sitemaps/consumer/',
    metricsSitemapWriterName: 'ConsumerWriter',
    metricsIndexWriterName: 'ConsumerIndex',
    sitemapWriterBatchSize: 100,
    sitemapWriterMaxBatchingWindow: Duration.seconds(10),
    lambdaFuncSitemapWriterRuntime: Runtime.NODEJS_24_X,
    lambdaFuncIndexWriterRuntime: Runtime.NODEJS_24_X,
    lambdaFuncSitemapWriterExtraProps: { functionName: 'consumer-writer' },
    lambdaFuncIndexWriterExtraProps: { functionName: 'consumer-index' },
  };
  const sitemaps = new SitemapsConstruct(stack, 'Sitemaps', props);
  const publicInterface: ISitemapsConstruct = sitemaps;
  if (!publicInterface.dynamoDBTable) throw new Error('Expected a created table');
  const freshenerProps: SitemapFreshnerConstructProps = {
    env: 'consumer',
    s3SitemapsBucket: publicInterface.s3SitemapsBucket,
    dynamodbTable: publicInterface.dynamoDBTable,
    kinesisInputStream: publicInterface.kinesisInputStream,
    s3SitemapsPrefix: 'sitemaps/consumer/',
    metricsNamespace: 'ConsumerFreshener',
    lambdaFuncFreshenerRuntime: Runtime.NODEJS_24_X,
    lambdaFuncFreshenerExtraProps: { functionName: 'consumer-freshener' },
    kinesisEventSourceExtraProps: {
      startingPosition: StartingPosition.TRIM_HORIZON,
      batchSize: 25,
    },
  };
  const freshener = new SitemapFreshenerConstruct(stack, 'Freshener', freshenerProps);
  return { app, stack, sitemaps, freshener };
}

if (require.main === module) createConsumer().app.synth();
