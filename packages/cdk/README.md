# Example CDK application

[cdk-stack.ts](lib/cdk-stack.ts) creates a sitemap writer, index writer, and
freshener sharing a DynamoDB table and S3 bucket. [bin/cdk.ts](bin/cdk.ts) creates
an environment-agnostic `SitemapsExampleStack`.

From the repository root, use the Node 24 / pnpm 12.7.0 setup in the
[root README](../../README.md#development), then:

```sh
pnpm run build:all
pnpm --dir packages/cdk exec cdk synth
```

Synthesis bundles local handlers and emits templates in `packages/cdk/cdk.out`;
it does not deploy resources. The example uses `autoDeleteEverything: true` and
is intended for disposable development resources. For production, manage durable
tables and buckets separately and pass them to the constructs. Review the
[construct API](../sitemaps-cdk/API.md) and [operations guide](../../OPERATIONS.md)
before deployment. The existing Node 20 Lambda default is deprecated; select a
runtime explicitly as part of an operator-reviewed migration.
