/* eslint-disable no-console */
/// <reference types="jest" />
import {
  App,
  Duration,
  Stack,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import path from 'path';

import { SitemapsConstruct } from '../src';

describe('SitemapsConstruct', () => {
  it('accepts and merges extra lambda props', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    const dynamodbTable = new dynamodb.Table(stack, 'dynamodb-table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    const s3SitemapsBucket = new s3.Bucket(stack, 'sitemaps-bucket', {});
    const construct = new SitemapsConstruct(stack, 'TestConstruct', {
      env: 'alpha',
      s3SitemapsBucket,
      dynamodbTable,
      s3SitemapsPrefix: 's3Directory/',
      lambdaFuncSitemapWriterExtraProps: {
        functionName: 'my-sitemap-function-name',
        architecture: lambda.Architecture.X86_64,
        memorySize: 512,
        timeout: Duration.minutes(3),
        layers: [
          new lambda.LayerVersion(stack, 'sitemap-writer-config-layer', {
            code: lambda.Code.fromAsset(
              path.join(__dirname, 'fixtures', 'configs', 'sitemap-writer', ''),
            ),
            layerVersionName: `sitemap-writer-config`,
          }),
        ],
        environment: {
          MY_CUSTOM_ENV_VAR: 'sitemap',
        },
      },
      lambdaFuncSitemapWriterRuntime: lambda.Runtime.NODEJS_18_X,
      lambdaFuncIndexWriterExtraProps: {
        functionName: 'my-index-function-name',
        architecture: lambda.Architecture.X86_64,
        memorySize: 768,
        timeout: Duration.minutes(4),
        layers: [
          new lambda.LayerVersion(stack, 'index-writer-config-layer', {
            code: lambda.Code.fromAsset(
              path.join(__dirname, 'fixtures', 'configs', 'index-writer', ''),
            ),
            layerVersionName: `index-writer-config`,
          }),
        ],
        environment: {
          MY_CUSTOM_ENV_VAR: 'index',
        },
      },
      lambdaFuncIndexWriterRuntime: lambda.Runtime.NODEJS_18_X,
      metricsSitemapWriterName: 'my-metrics-namespace-sitemaps',
      metricsIndexWriterName: 'my-metrics-namespace-index',
    });

    expect(construct).toBeDefined();

    try {
      // There are 3 lambda functions - 2 for our code, 1 for the log retention cleanup
      Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 3);
      Template.fromStack(stack).resourceCountIs('AWS::DynamoDB::Table', 1);
      Template.fromStack(stack).resourceCountIs('AWS::S3::Bucket', 1);

      // Confirm that logical IDs have not changed accidentally (causes delete/create)
      Template.fromStack(stack).templateMatches({
        Resources: {
          TestConstructkinesissitemapwriterfuncC5440FEB: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['x86_64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: '51103a8dd683be7e370966abb37a8ddc1c9dcee5a8b51694c05f08945f98e95c.zip',
              },
              Environment: {
                Variables: {
                  NODE_CONFIG_ENV: 'alpha',
                  NODE_ENV: 'production',
                  S3_SITEMAPS_BUCKET_NAME: {
                    Ref: 'sitemapsbucket101B82D2',
                  },
                  TABLE_NAME: {
                    Ref: 'dynamodbtable650E77A7',
                  },
                  AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                  MY_CUSTOM_ENV_VAR: 'sitemap',
                  METRICS_NAMESPACE: 'my-metrics-namespace-sitemaps',
                  KINESIS_SELF_STREAM_NAME: stack.resolve(construct.kinesisInputStream.streamName),
                },
              },
              FunctionName: 'my-sitemap-function-name',
              Handler: 'index.handler',
              Layers: [
                {
                  Ref: 'sitemapwriterconfiglayer344CC877',
                },
              ],
              MemorySize: 512,
              Role: {
                'Fn::GetAtt': ['TestConstructkinesissitemapwriterfuncServiceRole277EF8DD', 'Arn'],
              },
              Runtime: 'nodejs18.x',
              Timeout: 180,
            },
          },
          TestConstructkinesisindexwriterfunc180F5261: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['x86_64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: '51103a8dd683be7e370966abb37a8ddc1c9dcee5a8b51694c05f08945f98e95c.zip',
              },
              Environment: {
                Variables: {
                  NODE_ENV: 'production',
                  NODE_CONFIG_ENV: 'alpha',
                  S3_SITEMAPS_BUCKET_NAME: {
                    Ref: 'sitemapsbucket101B82D2',
                  },
                  TABLE_NAME: {
                    Ref: 'dynamodbtable650E77A7',
                  },
                  AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                  MY_CUSTOM_ENV_VAR: 'index',
                  METRICS_NAMESPACE: 'my-metrics-namespace-index',
                },
              },
              FunctionName: 'my-index-function-name',
              Handler: 'index.handler',
              Layers: [
                {
                  Ref: 'indexwriterconfiglayerC283CCA0',
                },
              ],
              MemorySize: 768,
              Role: {
                'Fn::GetAtt': ['TestConstructkinesisindexwriterfuncServiceRole31DC4F79', 'Arn'],
              },
              Runtime: 'nodejs18.x',
              Timeout: 240,
            },
          },
        },
      });
    } catch (error) {
      console.debug(JSON.stringify(Template.fromStack(stack).toJSON(), null, 2));
      throw error;
    }
  });

  it('works with s3 bucket and dynamodb table params', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    const dynamodbTable = new dynamodb.Table(stack, 'dynamodb-table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    const s3SitemapsBucket = new s3.Bucket(stack, 'sitemaps-bucket', {});
    const construct = new SitemapsConstruct(stack, 'TestConstruct', {
      s3SitemapsBucket,
      dynamodbTable,
      autoDeleteEverything: true,
    });

    expect(construct).toBeDefined();

    try {
      // There are 4 lambda functions - 2 for our code, 1 for the log retention cleanup
      Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 3);
      Template.fromStack(stack).resourceCountIs('AWS::DynamoDB::Table', 1);
      Template.fromStack(stack).resourceCountIs('AWS::S3::Bucket', 1);

      // Confirm that logical IDs have not changed accidentally (causes delete/create)
      Template.fromStack(stack).templateMatches({
        Resources: {
          TestConstructkinesissitemapwriterfuncServiceRole277EF8DD: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Statement: [
                  {
                    Action: 'sts:AssumeRole',
                    Effect: 'Allow',
                    Principal: {
                      Service: 'lambda.amazonaws.com',
                    },
                  },
                ],
                Version: '2012-10-17',
              },
              ManagedPolicyArns: [
                {
                  'Fn::Join': [
                    '',
                    [
                      'arn:',
                      {
                        Ref: 'AWS::Partition',
                      },
                      ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                    ],
                  ],
                },
              ],
            },
          },
          TestConstructkinesissitemapwriterfuncServiceRoleDefaultPolicy59245308: {
            Type: 'AWS::IAM::Policy',
            Properties: {
              PolicyDocument: {
                Statement: [
                  {
                    Action: [
                      'kinesis:DescribeStreamSummary',
                      'kinesis:GetRecords',
                      'kinesis:GetShardIterator',
                      'kinesis:ListShards',
                      'kinesis:SubscribeToShard',
                      'kinesis:DescribeStream',
                      'kinesis:ListStreams',
                      'kinesis:DescribeStreamConsumer',
                      'kinesis:PutRecord',
                      'kinesis:PutRecords',
                    ],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      's3:GetObject*',
                      's3:GetBucket*',
                      's3:List*',
                      's3:DeleteObject*',
                      's3:PutObject',
                      's3:PutObjectLegalHold',
                      's3:PutObjectRetention',
                      's3:PutObjectTagging',
                      's3:PutObjectVersionTagging',
                      's3:Abort*',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['sitemapsbucket101B82D2', 'Arn'],
                      },
                      {
                        'Fn::Join': [
                          '',
                          [
                            {
                              'Fn::GetAtt': ['sitemapsbucket101B82D2', 'Arn'],
                            },
                            '/*',
                          ],
                        ],
                      },
                    ],
                  },
                  {
                    Action: [
                      'kinesis:DescribeStreamSummary',
                      'kinesis:GetRecords',
                      'kinesis:GetShardIterator',
                      'kinesis:ListShards',
                      'kinesis:SubscribeToShard',
                      'kinesis:DescribeStream',
                      'kinesis:ListStreams',
                      'kinesis:DescribeStreamConsumer',
                    ],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                    },
                  },
                  {
                    Action: 'kinesis:DescribeStream',
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                    },
                  },
                  {
                    Action: ['kinesis:ListShards', 'kinesis:PutRecord', 'kinesis:PutRecords'],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      'dynamodb:BatchGetItem',
                      'dynamodb:GetRecords',
                      'dynamodb:GetShardIterator',
                      'dynamodb:Query',
                      'dynamodb:GetItem',
                      'dynamodb:Scan',
                      'dynamodb:ConditionCheckItem',
                      'dynamodb:BatchWriteItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:DescribeTable',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['dynamodbtable650E77A7', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                  {
                    Action: 'dynamodb:DescribeTable',
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['dynamodbtable650E77A7', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                ],
                Version: '2012-10-17',
              },
            },
          },
          TestConstructkinesissitemapwriterfuncKinesisEventSourceTestStackTestConstructsitemapsinputstreamE2DF157128FB71FB:
            {
              Type: 'AWS::Lambda::EventSourceMapping',
              Properties: {
                BatchSize: 10000,
                BisectBatchOnFunctionError: true,
                EventSourceArn: {
                  'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                },
                FunctionName: {
                  Ref: 'TestConstructkinesissitemapwriterfuncC5440FEB',
                },
                MaximumBatchingWindowInSeconds: 30,
                StartingPosition: 'TRIM_HORIZON',
              },
            },
          TestConstructkinesissitemapwriterfuncC5440FEB: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['arm64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: '7b057df9bba959e8a4db5db578314a6c16b45ec1f19b3145207864a3f4f0656a.zip',
              },
              Environment: {
                Variables: {
                  NODE_ENV: 'production',
                  S3_SITEMAPS_BUCKET_NAME: {
                    Ref: 'sitemapsbucket101B82D2',
                  },
                  TABLE_NAME: {
                    Ref: 'dynamodbtable650E77A7',
                  },
                  KINESIS_INDEX_WRITER_NAME: {
                    Ref: 'TestConstructsitemapindexwriterstream517F6DD8',
                  },
                  KINESIS_SELF_STREAM_NAME: {
                    Ref: 'TestConstructsitemapsinputstreamD34990D2',
                  },
                  AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                },
              },
              Handler: 'index.handler',
              MemorySize: 1769,
              Role: {
                'Fn::GetAtt': ['TestConstructkinesissitemapwriterfuncServiceRole277EF8DD', 'Arn'],
              },
              Runtime: 'nodejs20.x',
              Timeout: 900,
            },
          },
          TestConstructkinesisindexwriterfuncServiceRoleDefaultPolicy2E579A40: {
            Type: 'AWS::IAM::Policy',
            Properties: {
              PolicyDocument: {
                Statement: [
                  {
                    Action: [
                      'kinesis:DescribeStreamSummary',
                      'kinesis:GetRecords',
                      'kinesis:GetShardIterator',
                      'kinesis:ListShards',
                      'kinesis:SubscribeToShard',
                      'kinesis:DescribeStream',
                      'kinesis:ListStreams',
                      'kinesis:DescribeStreamConsumer',
                    ],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      's3:GetObject*',
                      's3:GetBucket*',
                      's3:List*',
                      's3:DeleteObject*',
                      's3:PutObject',
                      's3:PutObjectLegalHold',
                      's3:PutObjectRetention',
                      's3:PutObjectTagging',
                      's3:PutObjectVersionTagging',
                      's3:Abort*',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['sitemapsbucket101B82D2', 'Arn'],
                      },
                      {
                        'Fn::Join': [
                          '',
                          [
                            {
                              'Fn::GetAtt': ['sitemapsbucket101B82D2', 'Arn'],
                            },
                            '/*',
                          ],
                        ],
                      },
                    ],
                  },
                  {
                    Action: 'kinesis:DescribeStream',
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      'dynamodb:BatchGetItem',
                      'dynamodb:GetRecords',
                      'dynamodb:GetShardIterator',
                      'dynamodb:Query',
                      'dynamodb:GetItem',
                      'dynamodb:Scan',
                      'dynamodb:ConditionCheckItem',
                      'dynamodb:BatchWriteItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:DescribeTable',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['dynamodbtable650E77A7', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                  {
                    Action: 'dynamodb:DescribeTable',
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['dynamodbtable650E77A7', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                ],
                Version: '2012-10-17',
              },
            },
          },
          TestConstructkinesisindexwriterfunc180F5261: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['arm64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: 'a9413a2ded2896b6bb3cb6665ee3c36cd769ba70e1b8ea0072ca616527d2b62c.zip',
              },
              Environment: {
                Variables: {
                  NODE_ENV: 'production',
                  S3_SITEMAPS_BUCKET_NAME: {
                    Ref: 'sitemapsbucket101B82D2',
                  },
                  TABLE_NAME: {
                    Ref: 'dynamodbtable650E77A7',
                  },
                  AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                },
              },
              Handler: 'index.handler',
              MemorySize: 512,
              Role: {
                'Fn::GetAtt': ['TestConstructkinesisindexwriterfuncServiceRole31DC4F79', 'Arn'],
              },
              Runtime: 'nodejs20.x',
              Timeout: 300,
            },
          },
          TestConstructkinesisindexwriterfuncKinesisEventSourceTestStackTestConstructsitemapindexwriterstreamE33E6FE149B7318C:
            {
              Type: 'AWS::Lambda::EventSourceMapping',
              Properties: {
                BatchSize: 1000,
                EventSourceArn: {
                  'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                },
                FunctionName: {
                  Ref: 'TestConstructkinesisindexwriterfunc180F5261',
                },
                MaximumBatchingWindowInSeconds: 30,
                StartingPosition: 'TRIM_HORIZON',
              },
            },
        },
      });
    } catch (error) {
      console.debug(JSON.stringify(Template.fromStack(stack).toJSON(), null, 2));
      throw error;
    }
  });

  it('"easy button" works - creates dynamodb table and kinesis stream"', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    const construct = new SitemapsConstruct(stack, 'TestConstruct', {});

    expect(construct).toBeDefined();

    try {
      // There are 4 lambda functions - 2 for our code, 1 for the log retention cleanup
      Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 3);
      Template.fromStack(stack).resourceCountIs('AWS::DynamoDB::Table', 1);
      Template.fromStack(stack).resourceCountIs('AWS::S3::Bucket', 1);

      // Confirm that logical IDs have not changed accidentally (causes delete/create)
      Template.fromStack(stack).templateMatches({
        Resources: {
          TestConstructkinesissitemapwriterfuncServiceRole277EF8DD: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Statement: [
                  {
                    Action: 'sts:AssumeRole',
                    Effect: 'Allow',
                    Principal: {
                      Service: 'lambda.amazonaws.com',
                    },
                  },
                ],
                Version: '2012-10-17',
              },
              ManagedPolicyArns: [
                {
                  'Fn::Join': [
                    '',
                    [
                      'arn:',
                      {
                        Ref: 'AWS::Partition',
                      },
                      ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                    ],
                  ],
                },
              ],
            },
          },
          TestConstructkinesissitemapwriterfuncServiceRoleDefaultPolicy59245308: {
            Type: 'AWS::IAM::Policy',
            Properties: {
              PolicyDocument: {
                Statement: [
                  {
                    Action: [
                      'kinesis:DescribeStreamSummary',
                      'kinesis:GetRecords',
                      'kinesis:GetShardIterator',
                      'kinesis:ListShards',
                      'kinesis:SubscribeToShard',
                      'kinesis:DescribeStream',
                      'kinesis:ListStreams',
                      'kinesis:DescribeStreamConsumer',
                      'kinesis:PutRecord',
                      'kinesis:PutRecords',
                    ],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      's3:GetObject*',
                      's3:GetBucket*',
                      's3:List*',
                      's3:DeleteObject*',
                      's3:PutObject',
                      's3:PutObjectLegalHold',
                      's3:PutObjectRetention',
                      's3:PutObjectTagging',
                      's3:PutObjectVersionTagging',
                      's3:Abort*',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['TestConstructsitemapss3bucket2BDBADC2', 'Arn'],
                      },
                      {
                        'Fn::Join': [
                          '',
                          [
                            {
                              'Fn::GetAtt': ['TestConstructsitemapss3bucket2BDBADC2', 'Arn'],
                            },
                            '/*',
                          ],
                        ],
                      },
                    ],
                  },
                  {
                    Action: [
                      'kinesis:DescribeStreamSummary',
                      'kinesis:GetRecords',
                      'kinesis:GetShardIterator',
                      'kinesis:ListShards',
                      'kinesis:SubscribeToShard',
                      'kinesis:DescribeStream',
                      'kinesis:ListStreams',
                      'kinesis:DescribeStreamConsumer',
                    ],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                    },
                  },
                  {
                    Action: 'kinesis:DescribeStream',
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                    },
                  },
                  {
                    Action: ['kinesis:ListShards', 'kinesis:PutRecord', 'kinesis:PutRecords'],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      'dynamodb:BatchGetItem',
                      'dynamodb:GetRecords',
                      'dynamodb:GetShardIterator',
                      'dynamodb:Query',
                      'dynamodb:GetItem',
                      'dynamodb:Scan',
                      'dynamodb:ConditionCheckItem',
                      'dynamodb:BatchWriteItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:DescribeTable',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['TestConstructsitemapstable767D06B8', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                  {
                    Action: 'dynamodb:DescribeTable',
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['TestConstructsitemapstable767D06B8', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                ],
                Version: '2012-10-17',
              },
            },
          },
          TestConstructkinesissitemapwriterfuncKinesisEventSourceTestStackTestConstructsitemapsinputstreamE2DF157128FB71FB:
            {
              Type: 'AWS::Lambda::EventSourceMapping',
              Properties: {
                BatchSize: 10000,
                BisectBatchOnFunctionError: true,
                EventSourceArn: {
                  'Fn::GetAtt': ['TestConstructsitemapsinputstreamD34990D2', 'Arn'],
                },
                FunctionName: {
                  Ref: 'TestConstructkinesissitemapwriterfuncC5440FEB',
                },
                MaximumBatchingWindowInSeconds: 30,
                StartingPosition: 'TRIM_HORIZON',
              },
            },
          TestConstructkinesissitemapwriterfuncC5440FEB: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['arm64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: '7b057df9bba959e8a4db5db578314a6c16b45ec1f19b3145207864a3f4f0656a.zip',
              },
              Environment: {
                Variables: {
                  NODE_ENV: 'production',
                  S3_SITEMAPS_BUCKET_NAME: {
                    Ref: 'TestConstructsitemapss3bucket2BDBADC2',
                  },
                  TABLE_NAME: {
                    Ref: 'TestConstructsitemapstable767D06B8',
                  },
                  KINESIS_INDEX_WRITER_NAME: {
                    Ref: 'TestConstructsitemapindexwriterstream517F6DD8',
                  },
                  KINESIS_SELF_STREAM_NAME: {
                    Ref: 'TestConstructsitemapsinputstreamD34990D2',
                  },
                  AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                },
              },
              Handler: 'index.handler',
              MemorySize: 1769,
              Role: {
                'Fn::GetAtt': ['TestConstructkinesissitemapwriterfuncServiceRole277EF8DD', 'Arn'],
              },
              Runtime: 'nodejs20.x',
              Timeout: 900,
            },
          },
          TestConstructkinesisindexwriterfuncServiceRoleDefaultPolicy2E579A40: {
            Type: 'AWS::IAM::Policy',
            Properties: {
              PolicyDocument: {
                Statement: [
                  {
                    Action: [
                      'kinesis:DescribeStreamSummary',
                      'kinesis:GetRecords',
                      'kinesis:GetShardIterator',
                      'kinesis:ListShards',
                      'kinesis:SubscribeToShard',
                      'kinesis:DescribeStream',
                      'kinesis:ListStreams',
                      'kinesis:DescribeStreamConsumer',
                    ],
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      's3:GetObject*',
                      's3:GetBucket*',
                      's3:List*',
                      's3:DeleteObject*',
                      's3:PutObject',
                      's3:PutObjectLegalHold',
                      's3:PutObjectRetention',
                      's3:PutObjectTagging',
                      's3:PutObjectVersionTagging',
                      's3:Abort*',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['TestConstructsitemapss3bucket2BDBADC2', 'Arn'],
                      },
                      {
                        'Fn::Join': [
                          '',
                          [
                            {
                              'Fn::GetAtt': ['TestConstructsitemapss3bucket2BDBADC2', 'Arn'],
                            },
                            '/*',
                          ],
                        ],
                      },
                    ],
                  },
                  {
                    Action: 'kinesis:DescribeStream',
                    Effect: 'Allow',
                    Resource: {
                      'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                    },
                  },
                  {
                    Action: [
                      'dynamodb:BatchGetItem',
                      'dynamodb:GetRecords',
                      'dynamodb:GetShardIterator',
                      'dynamodb:Query',
                      'dynamodb:GetItem',
                      'dynamodb:Scan',
                      'dynamodb:ConditionCheckItem',
                      'dynamodb:BatchWriteItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:DescribeTable',
                    ],
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['TestConstructsitemapstable767D06B8', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                  {
                    Action: 'dynamodb:DescribeTable',
                    Effect: 'Allow',
                    Resource: [
                      {
                        'Fn::GetAtt': ['TestConstructsitemapstable767D06B8', 'Arn'],
                      },
                      {
                        Ref: 'AWS::NoValue',
                      },
                    ],
                  },
                ],
                Version: '2012-10-17',
              },
            },
          },
          TestConstructkinesisindexwriterfunc180F5261: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['arm64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: 'a9413a2ded2896b6bb3cb6665ee3c36cd769ba70e1b8ea0072ca616527d2b62c.zip',
              },
              Environment: {
                Variables: {
                  NODE_ENV: 'production',
                  S3_SITEMAPS_BUCKET_NAME: {
                    Ref: 'TestConstructsitemapss3bucket2BDBADC2',
                  },
                  TABLE_NAME: {
                    Ref: 'TestConstructsitemapstable767D06B8',
                  },
                  AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                },
              },
              Handler: 'index.handler',
              MemorySize: 512,
              Role: {
                'Fn::GetAtt': ['TestConstructkinesisindexwriterfuncServiceRole31DC4F79', 'Arn'],
              },
              Runtime: 'nodejs20.x',
              Timeout: 300,
            },
          },
          TestConstructkinesisindexwriterfuncKinesisEventSourceTestStackTestConstructsitemapindexwriterstreamE33E6FE149B7318C:
            {
              Type: 'AWS::Lambda::EventSourceMapping',
              Properties: {
                BatchSize: 1000,
                EventSourceArn: {
                  'Fn::GetAtt': ['TestConstructsitemapindexwriterstream517F6DD8', 'Arn'],
                },
                FunctionName: {
                  Ref: 'TestConstructkinesisindexwriterfunc180F5261',
                },
                MaximumBatchingWindowInSeconds: 30,
                StartingPosition: 'TRIM_HORIZON',
              },
            },
        },
      });
    } catch (error) {
      console.debug(JSON.stringify(Template.fromStack(stack).toJSON(), null, 2));
      throw error;
    }

    // Access the props
    expect(construct.dynamoDBTable).toBeDefined();
    expect(construct.indexWriterLambdaFunction).toBeDefined();
    expect(construct.sitemapWriterLambdaFunction).toBeDefined();
    expect(construct.kinesisInputStream).toBeDefined();
    expect(construct.s3SitemapsBucket).toBeDefined();
  });

  it('throws on undefined props', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', undefined);
    }).toThrow('props must be set');
  });

  it('throws on stream rentention < 1 days', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        kinesisSitemapWriterRetentionDays: 0.9,
      });
    }).toThrow('Kinesis stream retention cannot be less than 1 day');
  });

  it('throws on s3 bucket and s3 bucket name both set', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    const s3SitemapsBucket = new s3.Bucket(stack, 'sitemaps-bucket', {});
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        s3SitemapsBucket,
        s3SitemapsBucketName: 'test',
      });
    }).toThrow('Bucket name and bucket cannot both be specified');
  });

  it('throws on dynamodb table and dynamodb table name both set', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    const dynamodbTable = new dynamodb.Table(stack, 'dynamodb-table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        dynamodbTable,
        dynamodbTableName: 'test',
      });
    }).toThrow('Table name and table cannot both be specified');
  });

  it('throws on dynamodb table and dynamodb table props both set', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    const dynamodbTable = new dynamodb.Table(stack, 'dynamodb-table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        dynamodbTable,
        // @ts-expect-error testing invalid props mix
        dynamodbTableProps: {
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        },
      });
    }).toThrow('Table props and table cannot both be specified');
  });

  it('throws on extra table props specifying partition or sort key', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        dynamodbTableProps: {
          partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        },
      });
    }).toThrow('Table partition and sort keys cannot be specified');
  });

  it('throws on extra table props specifying partition or sort key', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        // @ts-expect-error testing invalid props mix
        dynamodbTableProps: {
          sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        },
      });
    }).toThrow('Table partition and sort keys cannot be specified');
  });

  it('throws on batch size < 1 for kinesis stream', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        sitemapWriterBatchSize: 0,
      });
    }).toThrow('Sitemap Writer batch size must be between 1 and 10,000 inclusive');
  });

  it('throws on batch size > 10,000 for kinesis stream', () => {
    const app = new App({});
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-2',
      },
    });
    expect(() => {
      new SitemapsConstruct(stack, 'TestConstruct', {
        sitemapWriterBatchSize: 10001,
      });
    }).toThrow('Sitemap Writer batch size must be between 1 and 10,000 inclusive');
  });
});
