import { existsSync } from 'fs';
import * as path from 'path';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { SitemapWriterCode, IndexWriterCode } from './sitemaps-code';

export interface SitemapsConstructProps {
  /**
   * Disable minification during test builds so that snaphots match
   *
   * @default false
   */
  readonly testBuild?: boolean;

  /**
   * Environment used to select config files from the config layer, if provided
   *
   * Passed to the Lamba as `NODE_CONFIG_ENV`
   *
   * @example 'dev'
   * @example 'prod'
   *
   * @default none
   */
  readonly env?: string;

  /**
   * Automatically clean up durable resources (e.g. for PR builds).
   *
   * ⚠️ CAUTION: This will delete the S3 bucket (and all contents) and DynamoDB table.
   *
   * @default false
   */
  readonly autoDeleteEverything?: boolean;

  /**
   * Specific name of the kinesis input stream
   *
   * If not specified, the name will be availabe via the
   * `kinesisInputStreamName` export
   *
   * @default - auto assigned
   */
  readonly kinesisInputStreamName?: string;

  /**
   * Number of shards in the kinesis input stream
   *
   * @default 4
   */
  readonly kinesisInputStreamShards?: number;

  /**
   * Number of days of data retention in the kinesis sitemap writer stream
   *
   * @default 1 day
   */
  readonly kinesisSitemapWriterRetentionDays?: number;

  /**
   * Optional - Specific name of the S3 sitemaps files bucket to be created.
   * If not set, a name will be assigned.
   *
   * @default - auto assigned
   */
  readonly s3SitemapsBucketName?: string;

  /**
   * Optional - Already-existing S3 sitemaps files bucket to be used for sitemap and index files.
   * If not set, a bucket will be created.
   *
   * @default - S3 Bucket will be created
   */
  readonly s3SitemapsBucket?: s3.IBucket;

  /**
   * Optional - Already-existing DynamoDB Table to be used for sitemap and index files.
   * If not set, a table will be created.
   *
   * @default - DynamoDB Table will be created
   */
  readonly dynamodbTable?: dynamodb.ITable;

  /**
   * Optional - Name of the DynamoDB table
   *
   * @default - auto assigned by CDK
   */
  readonly dynamodbTableName?: string;

  /**
   * Optional - Extra properties for the DynamoDB table
   */
  readonly dynamodbTableProps?: dynamodb.TableProps;

  /**
   * Path to write sitemap files to.
   *
   * This should be unique per durable deployment, such as:
   * - sitemaps/20210704/
   * - sitemaps/20211031/
   *
   * When a new durable deployment is created, by changing the stack name,
   * this prefix should be changed so that the new backfill writes to a
   * new path and the old stack, with the old Lambda code, continues to write
   * to the old path.  When it is desired to migrate to the new sitemaps,
   * a 301 should be returned for the well-known sitemap index URL to point
   * to the deploy-specific sitemap index URL.
   *
   * @default - defers to config file or `sitemaps/` if not in config file
   */
  readonly s3SitemapsPrefix?: string;

  /**
   * Metrics namespace and name for Sitemap Writer Lambda
   *
   * @default - none, metrics disabled
   */
  readonly metricsSitemapWriterName?: string;

  /**
   * Metrics namespace and name for Index Writer Lambda
   *
   * @default - none, metrics disabled
   */
  readonly metricsIndexWriterName?: string;

  /**
   * Extra properties for the sitemap writer Lambda function.
   *
   * Configuration can be passed either via Environment Variables or
   * via a config file layer that can have a default config.yml and
   * an NODE_CONFIG_ENV-specific config override file:
   * `config-${NODE_CONFIG_ENV}.yml`.
   *
   * @default - { architecture: ARM_64, memorySize: 2000, timeout: Duration.minutes(15), logRetention: logs.RetentionDays.ONE_MONTH }
   *
   * @example { functionName: 'my-sitemap-function-name', layers: lambda.Code.fromAsset('./configs/sitemap-writer/') }
   */
  readonly lambdaFuncSitemapWriterExtraProps?: lambda.FunctionOptions;

  /**
   * Optional runtime for the sitemap writer Lambda function.
   *
   * @default - lambda.Runtime.NODEJS_20_X
   */
  readonly lambdaFuncSitemapWriterRuntime?: lambda.Runtime;

  /**
   * Extra properties for the sitemap writer Lambda function.
   *
   * Configuration can be passed either via Environment Variables or
   * via a config file layer that can have a default config.yml and
   * an NODE_CONFIG_ENV-specific config override file:
   * `config-${NODE_CONFIG_ENV}.yml`.
   *
   * @default - { architecture: ARM_64, memorySize: 2000, timeout: Duration.minutes(15), logRetention: logs.RetentionDays.ONE_MONTH }
   *
   * @example { functionName: 'my-index-function-name', layers: lambda.Code.fromAsset('./configs/index-writer/') }
   */
  readonly lambdaFuncIndexWriterExtraProps?: lambda.FunctionOptions;

  /**
   * Optional runtime for the index writer Lambda function.
   *
   * @default - lambda.Runtime.NODEJS_20_X
   */
  readonly lambdaFuncIndexWriterRuntime?: lambda.Runtime;

  /**
   * Batch Size for Sitemap Writer
   *
   * This is the maximum number of records that will be processed in a single batch.
   *
   * Keep this number high (e.g. 10,000) to reduce the number of Lambda invocation
   * under high load and to reduce the number of times that the latest XML file
   * is read from S3, deserialized, updated, serialized, and written back to S3,
   * which is time consuming (10-30 seconds) and gets longer as the file approaches
   * being full.
   *
   * @default - 10,000
   */
  readonly sitemapWriterBatchSize?: number;

  /**
   * Max Batching Window Duration for Sitemap Writer
   *
   * Allowed range is 0-300 seconds. It is not suggested to set this to
   * 0 seconds as that will parse the XML file far too often and will likely
   * result in the Lambda function falling behind on reading the Kinesis Stream.
   *
   * @default - 30 seconds
   */
  readonly sitemapWriterMaxBatchingWindow?: Duration;
}

export interface ISitemapsConstruct {
  readonly s3SitemapsBucket: s3.IBucket;
  readonly dynamoDBTable?: dynamodb.Table;

  /**
   * Kinesis Input Stream for Sitemap Items
   */
  readonly kinesisInputStream: kinesis.IStream;

  /**
   * Sitemap Writer Lambda Function
   */
  readonly sitemapWriterLambdaFunction: lambda.Function;

  /**
   * Index Writer Lambda Function
   */
  readonly indexWriterLambdaFunction: lambda.Function;
}

export class SitemapsConstruct extends Construct implements ISitemapsConstruct {
  private _kinesisInputStream: kinesis.Stream;
  public get kinesisInputStream(): kinesis.IStream {
    return this._kinesisInputStream;
  }

  private _s3SitemapsBucket: s3.IBucket;
  public get s3SitemapsBucket(): s3.IBucket {
    return this._s3SitemapsBucket;
  }

  private _dynamoDBTable: dynamodb.Table | undefined;
  public get dynamoDBTable(): dynamodb.Table | undefined {
    return this._dynamoDBTable;
  }

  private _sitemapWriterLambdaFunction: lambda.Function;
  public get sitemapWriterLambdaFunction(): lambda.Function {
    return this._sitemapWriterLambdaFunction;
  }

  private _indexWriterLambdaFunction: lambda.Function;
  public get indexWriterLambdaFunction(): lambda.Function {
    return this._indexWriterLambdaFunction;
  }

  /**
   * Sitemaps writer from Kinesis stream source
   */
  constructor(scope: Construct, id: string, props?: SitemapsConstructProps) {
    super(scope, id);

    if (props === undefined) {
      throw new Error('props must be set');
    }

    const {
      kinesisInputStreamShards = 4,
      kinesisInputStreamName,
      kinesisSitemapWriterRetentionDays = 1,
      autoDeleteEverything = false,
      testBuild = false,
      env,
      sitemapWriterMaxBatchingWindow = Duration.seconds(30),
      s3SitemapsBucketName,
      s3SitemapsBucket,
      s3SitemapsPrefix,
      lambdaFuncSitemapWriterExtraProps = {},
      lambdaFuncSitemapWriterRuntime = lambda.Runtime.NODEJS_20_X,
      lambdaFuncIndexWriterExtraProps = {},
      lambdaFuncIndexWriterRuntime = lambda.Runtime.NODEJS_20_X,
      sitemapWriterBatchSize = 10000,
      dynamodbTableName,
      dynamodbTableProps,
    } = props;
    let dynamodbTable = props.dynamodbTable;

    //
    // Validate Args
    //
    if (kinesisSitemapWriterRetentionDays < 1) {
      throw new TypeError('Kinesis stream retention cannot be less than 1 day');
    }
    if (s3SitemapsBucket !== undefined && s3SitemapsBucketName !== undefined) {
      throw new TypeError('Bucket name and bucket cannot both be specified');
    }
    if (dynamodbTable !== undefined && dynamodbTableName !== undefined) {
      throw new TypeError('Table name and table cannot both be specified');
    }
    if (dynamodbTable !== undefined && dynamodbTableProps !== undefined) {
      throw new TypeError('Table props and table cannot both be specified');
    }
    if (
      dynamodbTableProps?.partitionKey !== undefined ||
      dynamodbTableProps?.sortKey !== undefined
    ) {
      throw new TypeError('Table partition and sort keys cannot be specified');
    }
    if (sitemapWriterBatchSize < 1 || sitemapWriterBatchSize > 10000) {
      throw new TypeError('Sitemap Writer batch size must be between 1 and 10,000 inclusive');
    }

    //
    // Add or Use Existing DynamoDB Table
    //
    if (dynamodbTable === undefined) {
      // No table was passed, create a table
      this._dynamoDBTable = new dynamodb.Table(this, 'sitemaps-table', {
        tableName: dynamodbTableName,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: 'PK',
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: 'SK',
          type: dynamodb.AttributeType.STRING,
        },
        removalPolicy: RemovalPolicy.DESTROY,
        ...dynamodbTableProps,
      });
      dynamodbTable = this._dynamoDBTable;
    }

    //
    // Add or Use Existing S3 Bucket for sitemaps files
    //
    if (s3SitemapsBucket === undefined) {
      //  No bucket was passed, create a bucket
      this._s3SitemapsBucket = new s3.Bucket(this, 'sitemaps-s3-bucket', {
        bucketName: s3SitemapsBucketName,
        autoDeleteObjects: autoDeleteEverything,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    } else {
      // An existing bucket was passed, save a reference to it
      this._s3SitemapsBucket = s3SitemapsBucket;
    }

    //
    // Add Kinesis input stream
    //
    this._kinesisInputStream = new kinesis.Stream(this, 'sitemaps-input-stream', {
      encryption: kinesis.StreamEncryption.UNENCRYPTED,
      shardCount: kinesisInputStreamShards,
      // Note: if not specified the stream name will be auto-assigned
      streamName: kinesisInputStreamName,
      retentionPeriod: Duration.days(kinesisSitemapWriterRetentionDays),
    });
    if (autoDeleteEverything) {
      this._kinesisInputStream.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    //
    // Add Kinesis index writer stream
    //
    const kinesisIndexWriterStream = new kinesis.Stream(this, 'sitemap-index-writer-stream', {
      encryption: kinesis.StreamEncryption.UNENCRYPTED,
      // This can be more than 1 shards but the shard key must ensure
      // that all messages for a particular index file (e.g. widget)
      // go into the same shard so that updates to each index file
      // are serialized.
      shardCount: 1,
      retentionPeriod: Duration.days(kinesisSitemapWriterRetentionDays),
    });
    if (autoDeleteEverything) {
      kinesisIndexWriterStream.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    //
    // BEGIN - Create the Sitemap Writer Function and Stream
    //

    const sitemapWriterOptEnvs: { [key: string]: string } = {};
    if (props.metricsSitemapWriterName !== undefined) {
      sitemapWriterOptEnvs.METRICS_NAMESPACE = props.metricsSitemapWriterName;
    }
    if (s3SitemapsPrefix !== undefined) {
      sitemapWriterOptEnvs.S3_DIRECTORY = s3SitemapsPrefix;
      sitemapWriterOptEnvs.SITE_BASE_SITEMAP_PATH = s3SitemapsPrefix;
    }

    // Add the Sitemap Writer Lambda
    const defaultKinesisSitemapWriterFuncProps: lambda.FunctionOptions = {
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.ONE_MONTH,
      memorySize: 1769, // 1769 MB is 100% of 1 CPU core
      timeout: Duration.minutes(15),
      environment: {
        NODE_ENV: 'production',
        ...(env ? { NODE_CONFIG_ENV: env } : {}),
        S3_SITEMAPS_BUCKET_NAME: this._s3SitemapsBucket.bucketName,
        TABLE_NAME: dynamodbTable.tableName,
        KINESIS_INDEX_WRITER_NAME: kinesisIndexWriterStream.streamName,
        KINESIS_SELF_STREAM_NAME: this.kinesisInputStream.streamName,
        ...sitemapWriterOptEnvs,
      },
    };
    const kinesisSitemapWriterFuncProps: Omit<lambda.FunctionProps, 'handler' | 'code'> = {
      runtime: lambdaFuncSitemapWriterRuntime,
      ...defaultKinesisSitemapWriterFuncProps,
      ...lambdaFuncSitemapWriterExtraProps,
      environment: {
        ...defaultKinesisSitemapWriterFuncProps.environment,
        ...(props.lambdaFuncSitemapWriterExtraProps?.environment !== undefined
          ? props.lambdaFuncSitemapWriterExtraProps.environment
          : {}),
      },
    };
    if (existsSync(path.join(__dirname, 'kinesis-sitemap-writer', 'index.js'))) {
      // This is for built apps packaged with the CDK construct
      this._sitemapWriterLambdaFunction = new lambda.Function(this, 'kinesis-sitemap-writer-func', {
        code: SitemapWriterCode(),
        handler: 'index.handler',
        ...kinesisSitemapWriterFuncProps,
      });
    } else {
      // This is for deployments and tests when developing the CDK construct
      this._sitemapWriterLambdaFunction = new lambdaNodejs.NodejsFunction(
        this,
        'kinesis-sitemap-writer-func',
        {
          entry: path.join(__dirname, '..', '..', 'kinesis-sitemap-writer', 'src', 'index.ts'),
          handler: 'handler',
          bundling: {
            sourceMap: !testBuild,
            keepNames: !testBuild,
          },
          ...kinesisSitemapWriterFuncProps,
        },
      );
    }
    if (autoDeleteEverything) {
      this._sitemapWriterLambdaFunction.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }
    // Grant read on the Input Stream
    // Grant write as we write back to the stream for compaction
    // of duplicate records
    this.kinesisInputStream.grantReadWrite(this._sitemapWriterLambdaFunction);

    // Give the sitemap writer function read/write on the S3 sitemaps bucket
    // Note: this will work for both pre-existing and newly created buckets
    this.s3SitemapsBucket.grantReadWrite(this._sitemapWriterLambdaFunction);

    // Add the Sitemap Writer stream event source to the Sitemap Writer function
    this._sitemapWriterLambdaFunction.addEventSource(
      new lambdaEventSources.KinesisEventSource(this.kinesisInputStream, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        // TODO: Allow batchSize, maxBatchingWindow, and tumblingWindow to be configured?
        batchSize: sitemapWriterBatchSize,
        maxBatchingWindow: sitemapWriterMaxBatchingWindow,
        bisectBatchOnError: true,
      }),
    );

    // Grant the sitemap writer function to write to the index writer stream
    kinesisIndexWriterStream.grantWrite(this._sitemapWriterLambdaFunction);

    // Give the Sitemap Writer access to DynamoDB table
    dynamodbTable.grantReadWriteData(this._sitemapWriterLambdaFunction);
    dynamodbTable.grant(this._sitemapWriterLambdaFunction, 'dynamodb:DescribeTable');

    //
    // BEGIN - Create the Index Writer Function and Stream
    //

    const indexWriterOptEnvs: { [key: string]: string } = {};
    if (props.metricsIndexWriterName !== undefined) {
      indexWriterOptEnvs.METRICS_NAMESPACE = props.metricsIndexWriterName;
    }
    if (s3SitemapsPrefix !== undefined) {
      indexWriterOptEnvs.S3_DIRECTORY = s3SitemapsPrefix;
      indexWriterOptEnvs.SITE_BASE_SITEMAP_PATH = s3SitemapsPrefix;
    }

    // Add the Index Writer Lambda
    const defaultKinesisIndexWriterFuncProps: lambda.FunctionOptions = {
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.ONE_MONTH,
      memorySize: 512,
      timeout: Duration.minutes(5),
      environment: {
        NODE_ENV: 'production',
        ...(env ? { NODE_CONFIG_ENV: env } : {}),
        S3_SITEMAPS_BUCKET_NAME: this._s3SitemapsBucket.bucketName,
        TABLE_NAME: dynamodbTable.tableName,
        ...indexWriterOptEnvs,
      },
    };
    const kinesisIndexWriterFuncProps: Omit<lambda.FunctionProps, 'handler' | 'code'> = {
      runtime: lambdaFuncIndexWriterRuntime,
      ...defaultKinesisIndexWriterFuncProps,
      ...lambdaFuncIndexWriterExtraProps,
      environment: {
        ...defaultKinesisIndexWriterFuncProps.environment,
        ...(props.lambdaFuncIndexWriterExtraProps?.environment !== undefined
          ? props.lambdaFuncIndexWriterExtraProps.environment
          : {}),
      },
    };
    if (existsSync(path.join(__dirname, 'kinesis-index-writer', 'index.js'))) {
      // This is for built apps packaged with the CDK construct
      this._indexWriterLambdaFunction = new lambda.Function(this, 'kinesis-index-writer-func', {
        code: IndexWriterCode(),
        handler: 'index.handler',
        ...kinesisIndexWriterFuncProps,
      });
    } else {
      // This is for deployments and tests when developing the CDK construct
      this._indexWriterLambdaFunction = new lambdaNodejs.NodejsFunction(
        this,
        'kinesis-index-writer-func',
        {
          entry: path.join(__dirname, '..', '..', 'kinesis-index-writer', 'src', 'index.ts'),
          handler: 'handler',
          bundling: {
            sourceMap: !testBuild,
            keepNames: !testBuild,
          },
          ...kinesisIndexWriterFuncProps,
        },
      );
    }
    if (autoDeleteEverything) {
      this._indexWriterLambdaFunction.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }
    // Give the Index Writer function read on the Index Writer stream
    kinesisIndexWriterStream.grantRead(this._indexWriterLambdaFunction);
    // Give the Index Writer function read/write on the S3 sitemaps bucket
    // Note: this will work for both pre-existing and newly created buckets
    this.s3SitemapsBucket.grantReadWrite(this._indexWriterLambdaFunction);

    // Add the Index Writer stream event source to the Index Writer function
    this._indexWriterLambdaFunction.addEventSource(
      new lambdaEventSources.KinesisEventSource(kinesisIndexWriterStream, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        // TODO: Allow batchSize, maxBatchingWindow, and tumblingWindow to be configured?
        batchSize: 1000,
        maxBatchingWindow: Duration.seconds(30),
      }),
    );

    // Give the Index Writer access to DynamoDB table
    dynamodbTable.grantReadWriteData(this._indexWriterLambdaFunction);
    dynamodbTable.grant(this._indexWriterLambdaFunction, 'dynamodb:DescribeTable');
  }
}
