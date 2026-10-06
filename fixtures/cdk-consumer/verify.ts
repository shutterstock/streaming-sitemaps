import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FreshenerCode, IndexWriterCode, SitemapWriterCode } from '@shutterstock/sitemaps-cdk';
import { createConsumer } from './app';

function inside(parent: string, child: string) {
  const relative = path.relative(realpathSync(parent), realpathSync(child));
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `Resolved outside isolated installation: ${child}`,
  );
}

const installation = path.resolve('node_modules');
for (const name of ['@shutterstock/sitemaps-cdk', 'aws-cdk-lib', 'constructs']) {
  inside(installation, require.resolve(name));
}
const packageRoot = path.dirname(require.resolve('@shutterstock/sitemaps-cdk/package.json'));
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(manifest.version, process.env.CONSUMER_PACKAGE_VERSION);
assert.ok(statSync(path.join(packageRoot, manifest.types)).isFile(), 'Missing public declarations');
assert.ok(statSync(path.join(packageRoot, '.jsii')).isFile(), 'Missing jsii assembly');
const expected = JSON.parse(readFileSync('expected-bundles.json', 'utf8')) as Record<
  string,
  string
>;
const helpers = {
  'kinesis-sitemap-writer': SitemapWriterCode,
  'kinesis-index-writer': IndexWriterCode,
  'kinesis-sitemap-freshener': FreshenerCode,
};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
for (const [name, code] of Object.entries(helpers)) {
  const directory = path.join(packageRoot, 'lib', name);
  const file = path.join(directory, 'index.js');
  const bytes = readFileSync(file); // ENOENT identifies the missing bundle, before fallback can run.
  assert.equal(
    digest(bytes),
    expected[name],
    `Packed ${name} differs from the freshly built bundle`,
  );
  assert.ok(bytes.length > 10000, `${name} is too small to be a real bundled handler`);
  new Script(bytes.toString(), { filename: file }); // Parse without executing handlers or calling AWS.
  const map = JSON.parse(readFileSync(`${file}.map`, 'utf8'));
  assert.ok(
    map.sources.some((source: string) => source.endsWith(`${name}/src/index.ts`)),
    `${name} source map does not contain the real handler entry point`,
  );
  assert.equal(
    realpathSync(code().path),
    realpathSync(directory),
    `${name} selected a fallback asset`,
  );
}

const { app, stack, sitemaps, freshener } = createConsumer();
const assembly = app.synth();
const artifact = assembly.getStackArtifact(stack.artifactId);
const template = Template.fromJSON(JSON.parse(readFileSync(artifact.templateFullPath, 'utf8')));
template.resourceCountIs('AWS::S3::Bucket', 1);
template.resourceCountIs('AWS::DynamoDB::Table', 1);
template.resourceCountIs('AWS::Kinesis::Stream', 2);
template.resourceCountIs('AWS::Lambda::EventSourceMapping', 3);
template.hasResourceProperties('AWS::S3::Bucket', { BucketName: 'consumer-sitemaps-fixture' });
template.hasResourceProperties('AWS::DynamoDB::Table', {
  TableName: 'consumer-sitemaps',
  BillingMode: 'PAY_PER_REQUEST',
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ],
});
template.hasResourceProperties('AWS::Kinesis::Stream', {
  Name: 'consumer-input',
  ShardCount: 2,
  RetentionPeriodHours: 48,
});
template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
  BatchSize: 100,
  MaximumBatchingWindowInSeconds: 10,
  StartingPosition: 'TRIM_HORIZON',
  EventSourceArn: stack.resolve(sitemaps.kinesisInputStream.streamArn),
  FunctionName: stack.resolve(sitemaps.sitemapWriterLambdaFunction.functionName),
});
template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
  BatchSize: 25,
  EventSourceArn: stack.resolve(sitemaps.kinesisInputStream.streamArn),
  FunctionName: stack.resolve(freshener.sitemapFreshenerLambdaFunction.functionName),
});
const indexStreams = Object.entries(template.findResources('AWS::Kinesis::Stream')).filter(
  ([, resource]) => resource.Properties.Name !== 'consumer-input',
);
assert.equal(indexStreams.length, 1, 'Expected a separate index writer stream');
const indexStreamId = indexStreams[0][0];
template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
  BatchSize: 1000,
  StartingPosition: 'TRIM_HORIZON',
  EventSourceArn: { 'Fn::GetAtt': [indexStreamId, 'Arn'] },
  FunctionName: stack.resolve(sitemaps.indexWriterLambdaFunction.functionName),
});
template.hasResourceProperties('AWS::Lambda::Function', {
  FunctionName: 'consumer-writer',
  Environment: {
    Variables: Match.objectLike({
      KINESIS_INDEX_WRITER_NAME: { Ref: indexStreamId },
      KINESIS_SELF_STREAM_NAME: stack.resolve(sitemaps.kinesisInputStream.streamName),
    }),
  },
});

const functions = [
  ['consumer-writer', 'kinesis-sitemap-writer', 'ConsumerWriter'],
  ['consumer-index', 'kinesis-index-writer', 'ConsumerIndex'],
  ['consumer-freshener', 'kinesis-sitemap-freshener', 'ConsumerFreshener'],
];
const assets: Array<{
  source: { path: string; packaging: string };
  destinations: Record<string, { objectKey: string }>;
}> = [];
for (const entry of Object.values(assembly.manifest.artifacts ?? {})) {
  if (entry.type !== 'cdk:asset-manifest') continue;
  const properties = entry.properties as { file: string };
  const assetManifest = JSON.parse(
    readFileSync(path.join(assembly.directory, properties.file), 'utf8'),
  );
  assets.push(...(Object.values(assetManifest.files) as typeof assets));
}
const matchedAssets = new Set<string>();
for (const [functionName, bundle, metrics] of functions) {
  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: functionName,
    Runtime: 'nodejs18.x',
    Handler: 'index.handler',
    Architectures: ['arm64'],
    Environment: {
      Variables: Match.objectLike({
        NODE_CONFIG_ENV: 'consumer',
        S3_DIRECTORY: 'sitemaps/consumer/',
        METRICS_NAMESPACE: metrics,
        TABLE_NAME: stack.resolve(sitemaps.dynamoDBTable!.tableName),
        S3_SITEMAPS_BUCKET_NAME: stack.resolve(sitemaps.s3SitemapsBucket.bucketName),
      }),
    },
  });
  const resources = Object.values(
    template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: functionName },
    }),
  );
  assert.equal(resources.length, 1);
  const s3Key = JSON.stringify(resources[0].Properties.Code.S3Key);
  const referenced = assets.filter((asset) =>
    Object.values(asset.destinations).some((destination) => s3Key.includes(destination.objectKey)),
  );
  assert.equal(referenced.length, 1, `${functionName} must reference one assembly asset`);
  const asset = referenced[0];
  assert.equal(asset.source.packaging, 'zip');
  const staged = path.resolve(assembly.directory, asset.source.path);
  inside(assembly.directory, staged);
  assert.ok(statSync(staged).isDirectory(), 'Lambda asset must be a staged directory');
  assert.equal(
    digest(readFileSync(path.join(staged, 'index.js'))),
    expected[bundle],
    `${functionName} CloudFormation code does not match the real packaged handler`,
  );
  matchedAssets.add(staged);
}
assert.equal(matchedAssets.size, 3, 'The three Lambda functions must use distinct real bundles');
assert.deepEqual(assembly.manifest.missing ?? [], [], 'Synthesis must not require context lookups');
console.log(
  `Verified ${manifest.name}@${manifest.version}: public types, resource wiring, three real Lambda assets and local CloudFormation assembly`,
);
