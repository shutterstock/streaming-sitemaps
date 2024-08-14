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
import { FreshenerCode } from './freshener-code';

export interface SitemapFreshnerConstructProps {
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
   * Kinesis input stream
   *
   * If not provided no event source will be created; the lambda can
   * be invoked manually with a `start` operation using the Kinesis message format.
   */
  readonly kinesisInputStream?: kinesis.IStream;

  /**
   * Extra properties for the sitemap freshener Lambda function.
   *
   * Configuration can be passed either via Environment Variables or
   * via a config file layer that can have a default config.yml and
   * an NODE_CONFIG_ENV-specific config override file:
   * `config-${NODE_CONFIG_ENV}.yml`.
   *
   * @default - { architecture: ARM_64, memorySize: 2000, timeout: Duration.minutes(15), logRetention: logs.RetentionDays.ONE_MONTH }
   *
   * @example { functionName: 'my-function-name', layers: lambda.Code.fromAsset('./configs/sitemap-freshner/') }
   */
  readonly lambdaFuncFreshenerExtraProps?: lambda.FunctionOptions;

  /**
   * Optional runtime for the sitemap freshener Lambda function.
   *
   * @default - lambda.Runtime.NODEJS_20_X
   */
  readonly lambdaFuncFreshenerRuntime?: lambda.Runtime;

  /**
   * Existing S3 sitemap files bucket as the desintation for the freshner Lambda.
   */
  readonly s3SitemapsBucket: s3.IBucket;

  /**
   * Existing DynamoDB Table to be used for freshening sitemap files.
   */
  readonly dynamodbTable: dynamodb.ITable;

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
   * Metrics namespace for Sitemap Freshener Lambda
   */
  readonly metricsNamespace?: string;

  /**
   * Extra Kinesis event source properties (e.g. batch size)
   */
  readonly kinesisEventSourceExtraProps?: lambdaEventSources.KinesisEventSourceProps;
}

interface ISitemapFreshenerConstruct {
  readonly sitemapFreshenerLambdaFunction: lambda.Function;
}

/**
 * Sitemap Freshener Construct
 *
 * This construct creates a Lambda function that reads from a Kinesis stream
 * and writes sitemap files to an S3 bucket from the contents in the DynamoDB Table.
 *
 * The Lambda function can be invoked with a `start` message or it can read the `start`
 * message from the Kinesis stream.
 *
 * The Lambda will write a `freshenFile` message back to the Kinesis stream for each
 * sitemap file that exists for the specified type.
 *
 * Changes `toremove` to `removed` and `towrite` to `written` in the DB for items in those states.
 *
 * When `repair` mode is off the XML files are only written, not read.
 */
export class SitemapFreshenerConstruct extends Construct implements ISitemapFreshenerConstruct {
  private _sitemapFreshenerLambdaFunction: lambda.Function;
  public get sitemapFreshenerLambdaFunction(): lambda.Function {
    return this._sitemapFreshenerLambdaFunction;
  }

  /**
   * Sitemap Freshener Construct
   *
   * This construct creates a Lambda function that reads from a Kinesis stream
   * and writes sitemap files to an S3 bucket from the contents in the DynamoDB Table.
   *
   * The Lambda function can be invoked with a `start` message or it can read the `start`
   * message from the Kinesis stream.
   *
   * The Lambda will write a `freshenFile` message back to the Kinesis stream for each
   * sitemap file that exists for the specified type.
   *
   * When `repair` mode is off the XML files are only written, not read.
   */
  constructor(scope: Construct, id: string, props?: SitemapFreshnerConstructProps) {
    super(scope, id);

    if (props === undefined) {
      throw new Error('props must be set');
    }

    const {
      autoDeleteEverything = false,
      testBuild = false,
      env,
      kinesisInputStream,
      s3SitemapsBucket,
      s3SitemapsPrefix,
      dynamodbTable,
      lambdaFuncFreshenerExtraProps: lambdaFuncSitemapFreshenerExtraProps = {},
      lambdaFuncFreshenerRuntime = lambda.Runtime.NODEJS_20_X,
      kinesisEventSourceExtraProps = {},
    } = props;

    //
    // BEGIN - Create the Sitemap Freshener Function
    //

    const sitemapFreshenerOptEnvs: { [key: string]: string } = {};
    if (props.metricsNamespace !== undefined) {
      sitemapFreshenerOptEnvs.METRICS_NAMESPACE = props.metricsNamespace;
    }
    if (s3SitemapsPrefix !== undefined) {
      sitemapFreshenerOptEnvs.S3_DIRECTORY = s3SitemapsPrefix;
      sitemapFreshenerOptEnvs.SITE_BASE_SITEMAP_PATH = s3SitemapsPrefix;
    }
    if (kinesisInputStream !== undefined) {
      sitemapFreshenerOptEnvs.KINESIS_SELF_STREAM_NAME = kinesisInputStream?.streamName;
    }

    const defaultLambdaProps: lambda.FunctionOptions = {
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.ONE_MONTH,
      // The parallel fetches of S3 files / DynamoDB items
      // and parallel writes to S3 files / DynamoDB items, both with back pressure
      // ensure that we operate the Node.js thread at 100% CPU 100% of the time.
      // Additionally we use some libuv I/O CPU as well, so we allocate over 1 CPU core.
      // Reducing this will just increase the runtime in a 1/1 ratio with
      // the reduction in memory, leaving the resulting cost unchanged.
      memorySize: 1769, // 1769 MB is 100% of 1 CPU core
      timeout: Duration.minutes(15),
      environment: {
        ...sitemapFreshenerOptEnvs,
        NODE_ENV: 'production',
        ...(env ? { NODE_CONFIG_ENV: env } : {}),
        S3_SITEMAPS_BUCKET_NAME: s3SitemapsBucket.bucketName,
        TABLE_NAME: dynamodbTable.tableName,
      },
    };

    const kinesisSitemapFreshenerFuncProps: Omit<lambda.FunctionProps, 'handler' | 'code'> = {
      runtime: lambdaFuncFreshenerRuntime,
      ...defaultLambdaProps,
      ...lambdaFuncSitemapFreshenerExtraProps,
      environment: {
        ...defaultLambdaProps.environment,
        ...(props.lambdaFuncFreshenerExtraProps?.environment !== undefined
          ? props.lambdaFuncFreshenerExtraProps.environment
          : {}),
      },
    };

    // Add the Freshener Lambda
    if (existsSync(path.join(__dirname, 'kinesis-sitemap-freshener', 'index.js'))) {
      // This is for built apps packaged with the CDK construct
      this._sitemapFreshenerLambdaFunction = new lambda.Function(
        this,
        'kinesis-sitemap-freshener-func',
        {
          code: FreshenerCode(),
          handler: 'index.handler',
          ...kinesisSitemapFreshenerFuncProps,
        },
      );
    } else {
      // This is for deployments and tests when developing the CDK construct
      this._sitemapFreshenerLambdaFunction = new lambdaNodejs.NodejsFunction(
        this,
        'kinesis-sitemap-freshener-func',
        {
          entry: path.join(__dirname, '..', '..', 'kinesis-sitemap-freshener', 'src', 'index.ts'),
          handler: 'handler',
          bundling: {
            sourceMap: !testBuild,
            keepNames: !testBuild,
          },
          ...kinesisSitemapFreshenerFuncProps,
        },
      );
    }
    if (autoDeleteEverything) {
      this._sitemapFreshenerLambdaFunction.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }
    // Grant read on the Input Stream
    // Grant write as we write back to the stream for `start` -> `freshenFile` operations
    if (kinesisInputStream !== undefined) {
      kinesisInputStream.grantReadWrite(this._sitemapFreshenerLambdaFunction);
    }

    // Give the sitemap freshener function read/write on the S3 sitemaps bucket
    s3SitemapsBucket.grantReadWrite(this._sitemapFreshenerLambdaFunction);

    // Add the Sitemap Writer stream event source to the Sitemap Writer function
    if (kinesisInputStream !== undefined) {
      this._sitemapFreshenerLambdaFunction.addEventSource(
        new lambdaEventSources.KinesisEventSource(kinesisInputStream, {
          startingPosition: lambda.StartingPosition.TRIM_HORIZON,
          bisectBatchOnError: true,
          ...kinesisEventSourceExtraProps,
        }),
      );
    }

    // Give the Sitemap Freshener access to DynamoDB table
    dynamodbTable.grantReadWriteData(this._sitemapFreshenerLambdaFunction);
    dynamodbTable.grant(this._sitemapFreshenerLambdaFunction, 'dynamodb:DescribeTable');
  }
}
