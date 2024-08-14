/* eslint-disable no-console */
/// <reference types="jest" />
import {
  App,
  Duration,
  Stack,
  aws_dynamodb as dynamodb,
  aws_kinesis as kinesis,
  aws_s3 as s3,
  aws_lambda as lambda,
} from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { SitemapFreshenerConstruct } from '../src';
import path from 'path';

describe('SitemapFreshenerConstruct', () => {
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
    const kinesisStream = new kinesis.Stream(stack, 'kinesis-stream', {
      streamName: 'some-stream',
    });
    const construct = new SitemapFreshenerConstruct(stack, 'TestConstruct', {
      kinesisInputStream: kinesisStream,
      s3SitemapsBucket,
      s3SitemapsPrefix: 's3Directory/',
      dynamodbTable,
      metricsNamespace: 'cats-namespace',
      env: 'alpha',
      lambdaFuncFreshenerExtraProps: {
        functionName: 'my-custom-function-name',
        memorySize: 512,
        architecture: lambda.Architecture.X86_64,
        timeout: Duration.minutes(3),
        layers: [
          new lambda.LayerVersion(stack, 'freshener-config-layer', {
            code: lambda.Code.fromAsset(
              path.join(__dirname, 'fixtures', 'configs', 'sitemap-freshener', ''),
            ),
            layerVersionName: `freshener-config`,
          }),
        ],
        environment: {
          MY_CUSTOM_ENV_VAR: 'dogs',
        },
      },
      lambdaFuncFreshenerRuntime: lambda.Runtime.NODEJS_18_X,
    });

    expect(construct).toBeDefined();

    try {
      // There are 2 lambda functions - One for our code, 1 for the log retention cleanup
      Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 2);
      Template.fromStack(stack).resourceCountIs('AWS::DynamoDB::Table', 1);
      Template.fromStack(stack).resourceCountIs('AWS::S3::Bucket', 1);

      // Confirm that logical IDs have not changed accidentally (causes delete/create)
      Template.fromStack(stack).templateMatches({
        Resources: {
          TestConstructkinesissitemapfreshenerfunc5FDA6B4C: {
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
                  MY_CUSTOM_ENV_VAR: 'dogs',
                  METRICS_NAMESPACE: 'cats-namespace',
                  KINESIS_SELF_STREAM_NAME: stack.resolve(kinesisStream.streamName),
                  S3_DIRECTORY: 's3Directory/',
                  SITE_BASE_SITEMAP_PATH: 's3Directory/',
                },
              },
              FunctionName: 'my-custom-function-name',
              Handler: 'index.handler',
              Layers: [
                {
                  Ref: 'freshenerconfiglayer11CCF2B4',
                },
              ],
              MemorySize: 512,
              Role: {
                'Fn::GetAtt': [
                  'TestConstructkinesissitemapfreshenerfuncServiceRole7653FDD8',
                  'Arn',
                ],
              },
              Runtime: 'nodejs18.x',
              Timeout: 180,
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
    const construct = new SitemapFreshenerConstruct(stack, 'TestConstruct', {
      s3SitemapsBucket,
      dynamodbTable,
    });

    expect(construct).toBeDefined();

    try {
      // There are 2 lambda functions - One for our code, 1 for the log retention cleanup
      Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 2);
      Template.fromStack(stack).resourceCountIs('AWS::DynamoDB::Table', 1);
      Template.fromStack(stack).resourceCountIs('AWS::S3::Bucket', 1);

      // Confirm that logical IDs have not changed accidentally (causes delete/create)
      Template.fromStack(stack).templateMatches({
        Resources: {
          TestConstructkinesissitemapfreshenerfuncServiceRole7653FDD8: {
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
          TestConstructkinesissitemapfreshenerfuncServiceRoleDefaultPolicyA0AD66B9: {
            Type: 'AWS::IAM::Policy',
            Properties: {
              PolicyDocument: {
                Statement: [
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
              PolicyName:
                'TestConstructkinesissitemapfreshenerfuncServiceRoleDefaultPolicyA0AD66B9',
              Roles: [
                {
                  Ref: 'TestConstructkinesissitemapfreshenerfuncServiceRole7653FDD8',
                },
              ],
            },
          },
          TestConstructkinesissitemapfreshenerfunc5FDA6B4C: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Architectures: ['arm64'],
              Code: {
                S3Bucket: 'cdk-hnb659fds-assets-123456789012-us-east-2',
                // S3Key: '51103a8dd683be7e370966abb37a8ddc1c9dcee5a8b51694c05f08945f98e95c.zip',
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
              MemorySize: 1769,
              Role: {
                'Fn::GetAtt': [
                  'TestConstructkinesissitemapfreshenerfuncServiceRole7653FDD8',
                  'Arn',
                ],
              },
              Runtime: 'nodejs20.x',
              Timeout: 900,
            },
          },
        },
      });
    } catch (error) {
      console.debug(JSON.stringify(Template.fromStack(stack).toJSON(), null, 2));
      throw error;
    }
  });
});
