# Overview

- AWS CDK construct to create set of AWS Lambda functions:
  - Sitemap Writer - Generate XML sitemaps from a stream of sitemap JSON items delivered via an AWS Kinesis stream
  - Index Writer - Maintain an XML sitemap index that is updated when new sitemap XML files are created
  - Freshener - Rebuild the sitemap index and sitemap XML files on demand (this applies changes to older items that were saved to the DB but not written to the XML files immediately)
- Saves record of each item in a DynamoDB table, for deduplication, marking deletes, and to enable the Freshener to rebuild the sitemap index and sitemap XML files on demand

# Usage

[Construct API Documentation](API.md) describes both `SitemapsConstruct` and
`SitemapFreshenerConstruct`. The [example stack](../cdk/lib/cdk-stack.ts) shows
how to share the table, bucket and writer input stream with the freshener.
For existing resources, pass the bucket/table props instead of enabling the
example's `autoDeleteEverything` setting.

The developer toolchain is Node 24 and pnpm 12.7.0; published package engines
remain Node >=18. The constructs retain Node 20 Lambda defaults (deprecated).
Set the runtime props explicitly when reviewing a deployment migration.

From the repository root, `pnpm run build:docs` compiles this construct,
regenerates this directory's `API.md`, and stages `docs/index.html` for local
inspection. `pnpm run synth:cdk` regenerates Projen-owned project configuration;
this is different from `cdk synth`, which synthesizes an application template.
See the [root development commands](../../README.md#development) and
[operations guide](../../OPERATIONS.md).
