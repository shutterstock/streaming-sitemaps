# API Reference <a name="API Reference" id="api-reference"></a>

## Constructs <a name="Constructs" id="Constructs"></a>

### SitemapFreshenerConstruct <a name="SitemapFreshenerConstruct" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct"></a>

Sitemap Freshener Construct.

This construct creates a Lambda function that reads from a Kinesis stream
and writes sitemap files to an S3 bucket from the contents in the DynamoDB Table.

The Lambda function can be invoked with a `start` message or it can read the `start`
message from the Kinesis stream.

The Lambda will write a `freshenFile` message back to the Kinesis stream for each
sitemap file that exists for the specified type.

Changes `toremove` to `removed` and `towrite` to `written` in the DB for items in those states.

When `repair` mode is off the XML files are only written, not read.

#### Initializers <a name="Initializers" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer"></a>

```typescript
import { SitemapFreshenerConstruct } from '@shutterstock/sitemaps-cdk'

new SitemapFreshenerConstruct(scope: Construct, id: string, props?: SitemapFreshnerConstructProps)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer.parameter.scope">scope</a></code> | <code>constructs.Construct</code> | *No description.* |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer.parameter.id">id</a></code> | <code>string</code> | *No description.* |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer.parameter.props">props</a></code> | <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps">SitemapFreshnerConstructProps</a></code> | *No description.* |

---

##### `scope`<sup>Required</sup> <a name="scope" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer.parameter.scope"></a>

- *Type:* constructs.Construct

---

##### `id`<sup>Required</sup> <a name="id" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer.parameter.id"></a>

- *Type:* string

---

##### `props`<sup>Optional</sup> <a name="props" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.Initializer.parameter.props"></a>

- *Type:* <a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps">SitemapFreshnerConstructProps</a>

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.toString">toString</a></code> | Returns a string representation of this construct. |

---

##### `toString` <a name="toString" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |

---

##### `isConstruct` <a name="isConstruct" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.isConstruct"></a>

```typescript
import { SitemapFreshenerConstruct } from '@shutterstock/sitemaps-cdk'

SitemapFreshenerConstruct.isConstruct(x: any)
```

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

###### `x`<sup>Required</sup> <a name="x" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.property.sitemapFreshenerLambdaFunction">sitemapFreshenerLambdaFunction</a></code> | <code>aws-cdk-lib.aws_lambda.Function</code> | *No description.* |

---

##### `node`<sup>Required</sup> <a name="node" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.property.node"></a>

```typescript
public readonly node: Node;
```

- *Type:* constructs.Node

The tree node.

---

##### `sitemapFreshenerLambdaFunction`<sup>Required</sup> <a name="sitemapFreshenerLambdaFunction" id="@shutterstock/sitemaps-cdk.SitemapFreshenerConstruct.property.sitemapFreshenerLambdaFunction"></a>

```typescript
public readonly sitemapFreshenerLambdaFunction: Function;
```

- *Type:* aws-cdk-lib.aws_lambda.Function

---


### SitemapsConstruct <a name="SitemapsConstruct" id="@shutterstock/sitemaps-cdk.SitemapsConstruct"></a>

- *Implements:* <a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct">ISitemapsConstruct</a>

#### Initializers <a name="Initializers" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer"></a>

```typescript
import { SitemapsConstruct } from '@shutterstock/sitemaps-cdk'

new SitemapsConstruct(scope: Construct, id: string, props?: SitemapsConstructProps)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer.parameter.scope">scope</a></code> | <code>constructs.Construct</code> | *No description.* |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer.parameter.id">id</a></code> | <code>string</code> | *No description.* |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer.parameter.props">props</a></code> | <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps">SitemapsConstructProps</a></code> | *No description.* |

---

##### `scope`<sup>Required</sup> <a name="scope" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer.parameter.scope"></a>

- *Type:* constructs.Construct

---

##### `id`<sup>Required</sup> <a name="id" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer.parameter.id"></a>

- *Type:* string

---

##### `props`<sup>Optional</sup> <a name="props" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.Initializer.parameter.props"></a>

- *Type:* <a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps">SitemapsConstructProps</a>

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.toString">toString</a></code> | Returns a string representation of this construct. |

---

##### `toString` <a name="toString" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |

---

##### `isConstruct` <a name="isConstruct" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.isConstruct"></a>

```typescript
import { SitemapsConstruct } from '@shutterstock/sitemaps-cdk'

SitemapsConstruct.isConstruct(x: any)
```

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

###### `x`<sup>Required</sup> <a name="x" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.property.indexWriterLambdaFunction">indexWriterLambdaFunction</a></code> | <code>aws-cdk-lib.aws_lambda.Function</code> | Index Writer Lambda Function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.property.kinesisInputStream">kinesisInputStream</a></code> | <code>aws-cdk-lib.aws_kinesis.IStream</code> | Kinesis Input Stream for Sitemap Items. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.property.s3SitemapsBucket">s3SitemapsBucket</a></code> | <code>aws-cdk-lib.aws_s3.IBucket</code> | *No description.* |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.property.sitemapWriterLambdaFunction">sitemapWriterLambdaFunction</a></code> | <code>aws-cdk-lib.aws_lambda.Function</code> | Sitemap Writer Lambda Function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct.property.dynamoDBTable">dynamoDBTable</a></code> | <code>aws-cdk-lib.aws_dynamodb.Table</code> | *No description.* |

---

##### `node`<sup>Required</sup> <a name="node" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.property.node"></a>

```typescript
public readonly node: Node;
```

- *Type:* constructs.Node

The tree node.

---

##### `indexWriterLambdaFunction`<sup>Required</sup> <a name="indexWriterLambdaFunction" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.property.indexWriterLambdaFunction"></a>

```typescript
public readonly indexWriterLambdaFunction: Function;
```

- *Type:* aws-cdk-lib.aws_lambda.Function

Index Writer Lambda Function.

---

##### `kinesisInputStream`<sup>Required</sup> <a name="kinesisInputStream" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.property.kinesisInputStream"></a>

```typescript
public readonly kinesisInputStream: IStream;
```

- *Type:* aws-cdk-lib.aws_kinesis.IStream

Kinesis Input Stream for Sitemap Items.

---

##### `s3SitemapsBucket`<sup>Required</sup> <a name="s3SitemapsBucket" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.property.s3SitemapsBucket"></a>

```typescript
public readonly s3SitemapsBucket: IBucket;
```

- *Type:* aws-cdk-lib.aws_s3.IBucket

---

##### `sitemapWriterLambdaFunction`<sup>Required</sup> <a name="sitemapWriterLambdaFunction" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.property.sitemapWriterLambdaFunction"></a>

```typescript
public readonly sitemapWriterLambdaFunction: Function;
```

- *Type:* aws-cdk-lib.aws_lambda.Function

Sitemap Writer Lambda Function.

---

##### `dynamoDBTable`<sup>Optional</sup> <a name="dynamoDBTable" id="@shutterstock/sitemaps-cdk.SitemapsConstruct.property.dynamoDBTable"></a>

```typescript
public readonly dynamoDBTable: Table;
```

- *Type:* aws-cdk-lib.aws_dynamodb.Table

---


## Structs <a name="Structs" id="Structs"></a>

### SitemapFreshnerConstructProps <a name="SitemapFreshnerConstructProps" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps"></a>

#### Initializer <a name="Initializer" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.Initializer"></a>

```typescript
import { SitemapFreshnerConstructProps } from '@shutterstock/sitemaps-cdk'

const sitemapFreshnerConstructProps: SitemapFreshnerConstructProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.dynamodbTable">dynamodbTable</a></code> | <code>aws-cdk-lib.aws_dynamodb.ITable</code> | Existing DynamoDB Table to be used for freshening sitemap files. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.s3SitemapsBucket">s3SitemapsBucket</a></code> | <code>aws-cdk-lib.aws_s3.IBucket</code> | Existing S3 sitemap files bucket as the desintation for the freshner Lambda. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.autoDeleteEverything">autoDeleteEverything</a></code> | <code>boolean</code> | Automatically clean up durable resources (e.g. for PR builds). |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.env">env</a></code> | <code>string</code> | Environment used to select config files from the config layer, if provided. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.kinesisEventSourceExtraProps">kinesisEventSourceExtraProps</a></code> | <code>aws-cdk-lib.aws_lambda_event_sources.KinesisEventSourceProps</code> | Extra Kinesis event source properties (e.g. batch size). |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.kinesisInputStream">kinesisInputStream</a></code> | <code>aws-cdk-lib.aws_kinesis.IStream</code> | Kinesis input stream. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.lambdaFuncFreshenerExtraProps">lambdaFuncFreshenerExtraProps</a></code> | <code>aws-cdk-lib.aws_lambda.FunctionOptions</code> | Extra properties for the sitemap freshener Lambda function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.lambdaFuncFreshenerRuntime">lambdaFuncFreshenerRuntime</a></code> | <code>aws-cdk-lib.aws_lambda.Runtime</code> | Optional runtime for the sitemap freshener Lambda function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.metricsNamespace">metricsNamespace</a></code> | <code>string</code> | Metrics namespace for Sitemap Freshener Lambda. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.s3SitemapsPrefix">s3SitemapsPrefix</a></code> | <code>string</code> | Path to write sitemap files to. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.testBuild">testBuild</a></code> | <code>boolean</code> | Disable minification during test builds so that snaphots match. |

---

##### `dynamodbTable`<sup>Required</sup> <a name="dynamodbTable" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.dynamodbTable"></a>

```typescript
public readonly dynamodbTable: ITable;
```

- *Type:* aws-cdk-lib.aws_dynamodb.ITable

Existing DynamoDB Table to be used for freshening sitemap files.

---

##### `s3SitemapsBucket`<sup>Required</sup> <a name="s3SitemapsBucket" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.s3SitemapsBucket"></a>

```typescript
public readonly s3SitemapsBucket: IBucket;
```

- *Type:* aws-cdk-lib.aws_s3.IBucket

Existing S3 sitemap files bucket as the desintation for the freshner Lambda.

---

##### `autoDeleteEverything`<sup>Optional</sup> <a name="autoDeleteEverything" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.autoDeleteEverything"></a>

```typescript
public readonly autoDeleteEverything: boolean;
```

- *Type:* boolean
- *Default:* false

Automatically clean up durable resources (e.g. for PR builds).

⚠️ CAUTION: This will delete the S3 bucket (and all contents) and DynamoDB table.

---

##### `env`<sup>Optional</sup> <a name="env" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.env"></a>

```typescript
public readonly env: string;
```

- *Type:* string
- *Default:* none

Environment used to select config files from the config layer, if provided.

Passed to the Lamba as `NODE_CONFIG_ENV`

---

*Example*

```typescript
'prod'
```


##### `kinesisEventSourceExtraProps`<sup>Optional</sup> <a name="kinesisEventSourceExtraProps" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.kinesisEventSourceExtraProps"></a>

```typescript
public readonly kinesisEventSourceExtraProps: KinesisEventSourceProps;
```

- *Type:* aws-cdk-lib.aws_lambda_event_sources.KinesisEventSourceProps

Extra Kinesis event source properties (e.g. batch size).

---

##### `kinesisInputStream`<sup>Optional</sup> <a name="kinesisInputStream" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.kinesisInputStream"></a>

```typescript
public readonly kinesisInputStream: IStream;
```

- *Type:* aws-cdk-lib.aws_kinesis.IStream

Kinesis input stream.

If not provided no event source will be created; the lambda can
be invoked manually with a `start` operation using the Kinesis message format.

---

##### `lambdaFuncFreshenerExtraProps`<sup>Optional</sup> <a name="lambdaFuncFreshenerExtraProps" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.lambdaFuncFreshenerExtraProps"></a>

```typescript
public readonly lambdaFuncFreshenerExtraProps: FunctionOptions;
```

- *Type:* aws-cdk-lib.aws_lambda.FunctionOptions
- *Default:* { architecture: ARM_64, memorySize: 2000, timeout: Duration.minutes(15), logRetention: logs.RetentionDays.ONE_MONTH }

Extra properties for the sitemap freshener Lambda function.

Configuration can be passed either via Environment Variables or
via a config file layer that can have a default config.yml and
an NODE_CONFIG_ENV-specific config override file:
`config-${NODE_CONFIG_ENV}.yml`.

---

*Example*

```typescript
{ functionName: 'my-function-name', layers: lambda.Code.fromAsset('./configs/sitemap-freshner/') }
```


##### `lambdaFuncFreshenerRuntime`<sup>Optional</sup> <a name="lambdaFuncFreshenerRuntime" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.lambdaFuncFreshenerRuntime"></a>

```typescript
public readonly lambdaFuncFreshenerRuntime: Runtime;
```

- *Type:* aws-cdk-lib.aws_lambda.Runtime
- *Default:* lambda.Runtime.NODEJS_20_X

Optional runtime for the sitemap freshener Lambda function.

---

##### `metricsNamespace`<sup>Optional</sup> <a name="metricsNamespace" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.metricsNamespace"></a>

```typescript
public readonly metricsNamespace: string;
```

- *Type:* string

Metrics namespace for Sitemap Freshener Lambda.

---

##### `s3SitemapsPrefix`<sup>Optional</sup> <a name="s3SitemapsPrefix" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.s3SitemapsPrefix"></a>

```typescript
public readonly s3SitemapsPrefix: string;
```

- *Type:* string
- *Default:* defers to config file or `sitemaps/` if not in config file

Path to write sitemap files to.

This should be unique per durable deployment, such as:
- sitemaps/20210704/
- sitemaps/20211031/

When a new durable deployment is created, by changing the stack name,
this prefix should be changed so that the new backfill writes to a
new path and the old stack, with the old Lambda code, continues to write
to the old path.  When it is desired to migrate to the new sitemaps,
a 301 should be returned for the well-known sitemap index URL to point
to the deploy-specific sitemap index URL.

---

##### `testBuild`<sup>Optional</sup> <a name="testBuild" id="@shutterstock/sitemaps-cdk.SitemapFreshnerConstructProps.property.testBuild"></a>

```typescript
public readonly testBuild: boolean;
```

- *Type:* boolean
- *Default:* false

Disable minification during test builds so that snaphots match.

---

### SitemapsConstructProps <a name="SitemapsConstructProps" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps"></a>

#### Initializer <a name="Initializer" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.Initializer"></a>

```typescript
import { SitemapsConstructProps } from '@shutterstock/sitemaps-cdk'

const sitemapsConstructProps: SitemapsConstructProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.autoDeleteEverything">autoDeleteEverything</a></code> | <code>boolean</code> | Automatically clean up durable resources (e.g. for PR builds). |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.dynamodbTable">dynamodbTable</a></code> | <code>aws-cdk-lib.aws_dynamodb.ITable</code> | Optional - Already-existing DynamoDB Table to be used for sitemap and index files. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.dynamodbTableName">dynamodbTableName</a></code> | <code>string</code> | Optional - Name of the DynamoDB table. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.dynamodbTableProps">dynamodbTableProps</a></code> | <code>aws-cdk-lib.aws_dynamodb.TableProps</code> | Optional - Extra properties for the DynamoDB table. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.env">env</a></code> | <code>string</code> | Environment used to select config files from the config layer, if provided. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.kinesisInputStreamName">kinesisInputStreamName</a></code> | <code>string</code> | Specific name of the kinesis input stream. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.kinesisInputStreamShards">kinesisInputStreamShards</a></code> | <code>number</code> | Number of shards in the kinesis input stream. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.kinesisSitemapWriterRetentionDays">kinesisSitemapWriterRetentionDays</a></code> | <code>number</code> | Number of days of data retention in the kinesis sitemap writer stream. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncIndexWriterExtraProps">lambdaFuncIndexWriterExtraProps</a></code> | <code>aws-cdk-lib.aws_lambda.FunctionOptions</code> | Extra properties for the sitemap writer Lambda function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncIndexWriterRuntime">lambdaFuncIndexWriterRuntime</a></code> | <code>aws-cdk-lib.aws_lambda.Runtime</code> | Optional runtime for the index writer Lambda function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncSitemapWriterExtraProps">lambdaFuncSitemapWriterExtraProps</a></code> | <code>aws-cdk-lib.aws_lambda.FunctionOptions</code> | Extra properties for the sitemap writer Lambda function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncSitemapWriterRuntime">lambdaFuncSitemapWriterRuntime</a></code> | <code>aws-cdk-lib.aws_lambda.Runtime</code> | Optional runtime for the sitemap writer Lambda function. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.metricsIndexWriterName">metricsIndexWriterName</a></code> | <code>string</code> | Metrics namespace and name for Index Writer Lambda. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.metricsSitemapWriterName">metricsSitemapWriterName</a></code> | <code>string</code> | Metrics namespace and name for Sitemap Writer Lambda. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.s3SitemapsBucket">s3SitemapsBucket</a></code> | <code>aws-cdk-lib.aws_s3.IBucket</code> | Optional - Already-existing S3 sitemaps files bucket to be used for sitemap and index files. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.s3SitemapsBucketName">s3SitemapsBucketName</a></code> | <code>string</code> | Optional - Specific name of the S3 sitemaps files bucket to be created. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.s3SitemapsPrefix">s3SitemapsPrefix</a></code> | <code>string</code> | Path to write sitemap files to. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.sitemapWriterBatchSize">sitemapWriterBatchSize</a></code> | <code>number</code> | Batch Size for Sitemap Writer. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.sitemapWriterMaxBatchingWindow">sitemapWriterMaxBatchingWindow</a></code> | <code>aws-cdk-lib.Duration</code> | Max Batching Window Duration for Sitemap Writer. |
| <code><a href="#@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.testBuild">testBuild</a></code> | <code>boolean</code> | Disable minification during test builds so that snaphots match. |

---

##### `autoDeleteEverything`<sup>Optional</sup> <a name="autoDeleteEverything" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.autoDeleteEverything"></a>

```typescript
public readonly autoDeleteEverything: boolean;
```

- *Type:* boolean
- *Default:* false

Automatically clean up durable resources (e.g. for PR builds).

⚠️ CAUTION: This will delete the S3 bucket (and all contents) and DynamoDB table.

---

##### `dynamodbTable`<sup>Optional</sup> <a name="dynamodbTable" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.dynamodbTable"></a>

```typescript
public readonly dynamodbTable: ITable;
```

- *Type:* aws-cdk-lib.aws_dynamodb.ITable
- *Default:* DynamoDB Table will be created

Optional - Already-existing DynamoDB Table to be used for sitemap and index files.

If not set, a table will be created.

---

##### `dynamodbTableName`<sup>Optional</sup> <a name="dynamodbTableName" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.dynamodbTableName"></a>

```typescript
public readonly dynamodbTableName: string;
```

- *Type:* string
- *Default:* auto assigned by CDK

Optional - Name of the DynamoDB table.

---

##### `dynamodbTableProps`<sup>Optional</sup> <a name="dynamodbTableProps" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.dynamodbTableProps"></a>

```typescript
public readonly dynamodbTableProps: TableProps;
```

- *Type:* aws-cdk-lib.aws_dynamodb.TableProps

Optional - Extra properties for the DynamoDB table.

---

##### `env`<sup>Optional</sup> <a name="env" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.env"></a>

```typescript
public readonly env: string;
```

- *Type:* string
- *Default:* none

Environment used to select config files from the config layer, if provided.

Passed to the Lamba as `NODE_CONFIG_ENV`

---

*Example*

```typescript
'prod'
```


##### `kinesisInputStreamName`<sup>Optional</sup> <a name="kinesisInputStreamName" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.kinesisInputStreamName"></a>

```typescript
public readonly kinesisInputStreamName: string;
```

- *Type:* string
- *Default:* auto assigned

Specific name of the kinesis input stream.

If not specified, the name will be availabe via the
`kinesisInputStreamName` export

---

##### `kinesisInputStreamShards`<sup>Optional</sup> <a name="kinesisInputStreamShards" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.kinesisInputStreamShards"></a>

```typescript
public readonly kinesisInputStreamShards: number;
```

- *Type:* number
- *Default:* 4

Number of shards in the kinesis input stream.

---

##### `kinesisSitemapWriterRetentionDays`<sup>Optional</sup> <a name="kinesisSitemapWriterRetentionDays" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.kinesisSitemapWriterRetentionDays"></a>

```typescript
public readonly kinesisSitemapWriterRetentionDays: number;
```

- *Type:* number
- *Default:* 1 day

Number of days of data retention in the kinesis sitemap writer stream.

---

##### `lambdaFuncIndexWriterExtraProps`<sup>Optional</sup> <a name="lambdaFuncIndexWriterExtraProps" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncIndexWriterExtraProps"></a>

```typescript
public readonly lambdaFuncIndexWriterExtraProps: FunctionOptions;
```

- *Type:* aws-cdk-lib.aws_lambda.FunctionOptions
- *Default:* { architecture: ARM_64, memorySize: 2000, timeout: Duration.minutes(15), logRetention: logs.RetentionDays.ONE_MONTH }

Extra properties for the sitemap writer Lambda function.

Configuration can be passed either via Environment Variables or
via a config file layer that can have a default config.yml and
an NODE_CONFIG_ENV-specific config override file:
`config-${NODE_CONFIG_ENV}.yml`.

---

*Example*

```typescript
{ functionName: 'my-index-function-name', layers: lambda.Code.fromAsset('./configs/index-writer/') }
```


##### `lambdaFuncIndexWriterRuntime`<sup>Optional</sup> <a name="lambdaFuncIndexWriterRuntime" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncIndexWriterRuntime"></a>

```typescript
public readonly lambdaFuncIndexWriterRuntime: Runtime;
```

- *Type:* aws-cdk-lib.aws_lambda.Runtime
- *Default:* lambda.Runtime.NODEJS_20_X

Optional runtime for the index writer Lambda function.

---

##### `lambdaFuncSitemapWriterExtraProps`<sup>Optional</sup> <a name="lambdaFuncSitemapWriterExtraProps" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncSitemapWriterExtraProps"></a>

```typescript
public readonly lambdaFuncSitemapWriterExtraProps: FunctionOptions;
```

- *Type:* aws-cdk-lib.aws_lambda.FunctionOptions
- *Default:* { architecture: ARM_64, memorySize: 2000, timeout: Duration.minutes(15), logRetention: logs.RetentionDays.ONE_MONTH }

Extra properties for the sitemap writer Lambda function.

Configuration can be passed either via Environment Variables or
via a config file layer that can have a default config.yml and
an NODE_CONFIG_ENV-specific config override file:
`config-${NODE_CONFIG_ENV}.yml`.

---

*Example*

```typescript
{ functionName: 'my-sitemap-function-name', layers: lambda.Code.fromAsset('./configs/sitemap-writer/') }
```


##### `lambdaFuncSitemapWriterRuntime`<sup>Optional</sup> <a name="lambdaFuncSitemapWriterRuntime" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.lambdaFuncSitemapWriterRuntime"></a>

```typescript
public readonly lambdaFuncSitemapWriterRuntime: Runtime;
```

- *Type:* aws-cdk-lib.aws_lambda.Runtime
- *Default:* lambda.Runtime.NODEJS_20_X

Optional runtime for the sitemap writer Lambda function.

---

##### `metricsIndexWriterName`<sup>Optional</sup> <a name="metricsIndexWriterName" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.metricsIndexWriterName"></a>

```typescript
public readonly metricsIndexWriterName: string;
```

- *Type:* string
- *Default:* none, metrics disabled

Metrics namespace and name for Index Writer Lambda.

---

##### `metricsSitemapWriterName`<sup>Optional</sup> <a name="metricsSitemapWriterName" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.metricsSitemapWriterName"></a>

```typescript
public readonly metricsSitemapWriterName: string;
```

- *Type:* string
- *Default:* none, metrics disabled

Metrics namespace and name for Sitemap Writer Lambda.

---

##### `s3SitemapsBucket`<sup>Optional</sup> <a name="s3SitemapsBucket" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.s3SitemapsBucket"></a>

```typescript
public readonly s3SitemapsBucket: IBucket;
```

- *Type:* aws-cdk-lib.aws_s3.IBucket
- *Default:* S3 Bucket will be created

Optional - Already-existing S3 sitemaps files bucket to be used for sitemap and index files.

If not set, a bucket will be created.

---

##### `s3SitemapsBucketName`<sup>Optional</sup> <a name="s3SitemapsBucketName" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.s3SitemapsBucketName"></a>

```typescript
public readonly s3SitemapsBucketName: string;
```

- *Type:* string
- *Default:* auto assigned

Optional - Specific name of the S3 sitemaps files bucket to be created.

If not set, a name will be assigned.

---

##### `s3SitemapsPrefix`<sup>Optional</sup> <a name="s3SitemapsPrefix" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.s3SitemapsPrefix"></a>

```typescript
public readonly s3SitemapsPrefix: string;
```

- *Type:* string
- *Default:* defers to config file or `sitemaps/` if not in config file

Path to write sitemap files to.

This should be unique per durable deployment, such as:
- sitemaps/20210704/
- sitemaps/20211031/

When a new durable deployment is created, by changing the stack name,
this prefix should be changed so that the new backfill writes to a
new path and the old stack, with the old Lambda code, continues to write
to the old path.  When it is desired to migrate to the new sitemaps,
a 301 should be returned for the well-known sitemap index URL to point
to the deploy-specific sitemap index URL.

---

##### `sitemapWriterBatchSize`<sup>Optional</sup> <a name="sitemapWriterBatchSize" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.sitemapWriterBatchSize"></a>

```typescript
public readonly sitemapWriterBatchSize: number;
```

- *Type:* number
- *Default:* 10,000

Batch Size for Sitemap Writer.

This is the maximum number of records that will be processed in a single batch.

Keep this number high (e.g. 10,000) to reduce the number of Lambda invocation
under high load and to reduce the number of times that the latest XML file
is read from S3, deserialized, updated, serialized, and written back to S3,
which is time consuming (10-30 seconds) and gets longer as the file approaches
being full.

---

##### `sitemapWriterMaxBatchingWindow`<sup>Optional</sup> <a name="sitemapWriterMaxBatchingWindow" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.sitemapWriterMaxBatchingWindow"></a>

```typescript
public readonly sitemapWriterMaxBatchingWindow: Duration;
```

- *Type:* aws-cdk-lib.Duration
- *Default:* 30 seconds

Max Batching Window Duration for Sitemap Writer.

Allowed range is 0-300 seconds. It is not suggested to set this to
0 seconds as that will parse the XML file far too often and will likely
result in the Lambda function falling behind on reading the Kinesis Stream.

---

##### `testBuild`<sup>Optional</sup> <a name="testBuild" id="@shutterstock/sitemaps-cdk.SitemapsConstructProps.property.testBuild"></a>

```typescript
public readonly testBuild: boolean;
```

- *Type:* boolean
- *Default:* false

Disable minification during test builds so that snaphots match.

---


## Protocols <a name="Protocols" id="Protocols"></a>

### ISitemapsConstruct <a name="ISitemapsConstruct" id="@shutterstock/sitemaps-cdk.ISitemapsConstruct"></a>

- *Implemented By:* <a href="#@shutterstock/sitemaps-cdk.SitemapsConstruct">SitemapsConstruct</a>, <a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct">ISitemapsConstruct</a>


#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.indexWriterLambdaFunction">indexWriterLambdaFunction</a></code> | <code>aws-cdk-lib.aws_lambda.Function</code> | Index Writer Lambda Function. |
| <code><a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.kinesisInputStream">kinesisInputStream</a></code> | <code>aws-cdk-lib.aws_kinesis.IStream</code> | Kinesis Input Stream for Sitemap Items. |
| <code><a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.s3SitemapsBucket">s3SitemapsBucket</a></code> | <code>aws-cdk-lib.aws_s3.IBucket</code> | *No description.* |
| <code><a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.sitemapWriterLambdaFunction">sitemapWriterLambdaFunction</a></code> | <code>aws-cdk-lib.aws_lambda.Function</code> | Sitemap Writer Lambda Function. |
| <code><a href="#@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.dynamoDBTable">dynamoDBTable</a></code> | <code>aws-cdk-lib.aws_dynamodb.Table</code> | *No description.* |

---

##### `indexWriterLambdaFunction`<sup>Required</sup> <a name="indexWriterLambdaFunction" id="@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.indexWriterLambdaFunction"></a>

```typescript
public readonly indexWriterLambdaFunction: Function;
```

- *Type:* aws-cdk-lib.aws_lambda.Function

Index Writer Lambda Function.

---

##### `kinesisInputStream`<sup>Required</sup> <a name="kinesisInputStream" id="@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.kinesisInputStream"></a>

```typescript
public readonly kinesisInputStream: IStream;
```

- *Type:* aws-cdk-lib.aws_kinesis.IStream

Kinesis Input Stream for Sitemap Items.

---

##### `s3SitemapsBucket`<sup>Required</sup> <a name="s3SitemapsBucket" id="@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.s3SitemapsBucket"></a>

```typescript
public readonly s3SitemapsBucket: IBucket;
```

- *Type:* aws-cdk-lib.aws_s3.IBucket

---

##### `sitemapWriterLambdaFunction`<sup>Required</sup> <a name="sitemapWriterLambdaFunction" id="@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.sitemapWriterLambdaFunction"></a>

```typescript
public readonly sitemapWriterLambdaFunction: Function;
```

- *Type:* aws-cdk-lib.aws_lambda.Function

Sitemap Writer Lambda Function.

---

##### `dynamoDBTable`<sup>Optional</sup> <a name="dynamoDBTable" id="@shutterstock/sitemaps-cdk.ISitemapsConstruct.property.dynamoDBTable"></a>

```typescript
public readonly dynamoDBTable: Table;
```

- *Type:* aws-cdk-lib.aws_dynamodb.Table

---

