# Public package contract and packed verification

The publication set and dependency order are maintained in
[bin/public-packages.cjs](../bin/public-packages.cjs). All six public source
manifests remain at `0.0.0`; release version injection is a separate step.

| Package | Entry and declarations | Published dependencies within this repository |
| --- | --- | --- |
| `@shutterstock/sitemaps-models-lib` | `dist/index.js`, `dist/index.d.ts` | None |
| `@shutterstock/sitemaps-db-lib` | `dist/index.js`, `dist/index.d.ts` | None |
| `@shutterstock/sitemaps-metrics-lib` | `dist/index.js`, `dist/index.d.ts` | None |
| `@shutterstock/sitemaps-wrapper-lib` | `dist/index.js`, `dist/index.d.ts` | None |
| `@shutterstock/sitemaps-cli` | `dist/index.js`, `dist/index.d.ts`, `bin/run.js` | Models, database, wrapper |
| `@shutterstock/sitemaps-cdk` | `lib/index.js`, `lib/index.d.ts`, `.jsii` | None; all three handler applications are bundled |

The root, `cdk` example, three `kinesis-*` applications, and
`sitemaps-utils-lib` are intentionally private. Utilities are compiled/bundled
inputs for the CLI; handlers are bundled construct assets. They must never
become dependencies on unpublished npm packages. The wrapper is public because
the CLI's shipped helper declarations reference its types. Its file-stream
declaration uses Node's `fs.WriteStream`, so production `@types/fs-extra` is
unnecessary (unlike the former declaration examined in PR #6).

All entries retain CommonJS. Models, database, and metrics accept both
extensionless deep imports (for example `sitemaps-db-lib/manager`) and explicit
`.js` imports, plus existing explicit `.d.ts` type-only imports. Their type maps
support legacy and modern TypeScript resolution.
The wrapper and CLI retain unrestricted `dist/...` deep paths. The CLI build
replaces inferred private oclif interface references with the identical types
exposed through its public `Interfaces` namespace; command and flag types remain
precise. Direct production `sitemap` and `fs-extra` cover shipped CLI helper
imports and declarations.

The construct's [Projen source](../packages/sitemaps-cdk/.projenrc.ts) owns its
metadata, allowlist and npmignore. The archive includes `.jsii` plus the real
`index.js` and `index.js.map` for **each** sibling handler: index writer,
sitemap writer, and sitemap freshener. Source maps intentionally include
bundled source content for debugging. Tests, snapshots, coverage, build state,
agent guides/skills, development configs and local credentials are excluded.
All public archives contain their own README and MIT license.

## Reproduce the consumer gate

Use the pinned Node 24/pnpm 12.7.0 toolchain in this checkout:

```sh
pnpm install --frozen-lockfile
pnpm run clean
pnpm run build:all
pnpm run lint
pnpm run test
pnpm run test:foundation
pnpm run build:cli
pnpm run test:packages
```

Tests deliberately replace CLI bundles with unbundled commands; rebuild before
packing. `test:packages` packs **every** public workspace itself and checks the
actual manifests and archives. Its checked-in
[fixtures](../fixtures/packed-consumer) extend the packaged CLI checks from
PR #6; [construct fixtures](../fixtures/cdk-consumer) reuse PR #5's real asset
and resource assertions. Neither PR is merged or required for this gate.

The runner creates a disposable consumer outside this checkout, rejects any
ancestor `node_modules`, and uses isolated non-hoisted production installs.
Tools live in a separate sibling directory so their types/dependencies cannot
satisfy missing declaration dependencies. A fresh home, config, store, and
restricted executable path remove credentials and global package lookup.
It verifies the root lock and dependency trees were not mutated.

A read-only localhost registry serves exact packed internal versions and
integrity hashes. `workspace:^` becomes `^<actual packed version>` through
pnpm's normal pack operation, including `^0.0.0` locally and prerelease versions
in PR CI. Nothing rewrites bad archives, substitutes registry siblings, changes
source versions, or overrides consumer dependencies. Installs require public
registry access for external packages and inherit the seven-day release policy.
Subsequent runtime commands deny network connections entirely.

The gate checks all public declarations with `skipLibCheck=false`, legacy and
Node16/NodeNext resolution (including all explicitly suffixed declaration
subpaths), every library's CommonJS/native ESM entries and deep modules,
CLI bin/version/help and plugin/command loading, and XML-to-JSONL conversion
against committed output. A synthetic S3 transport exercises the published
SDK's XML error deserialization without AWS or network calls. CDK synthesis
compares all three packaged bundle hashes/source maps against this checkout's
build, checks the resulting staged assets and resource wiring, and rejects
context lookups. Bundle inspection rejects unresolved npm imports except the
SDK's guarded optional CRT/v4a signers; those optional signing paths and real
AWS requests are outside the offline check. Negative controls catch missing `sitemap`, `fs-extra`,
the executable bin, and a missing Lambda bundle.

CI runs the same gate after its explicit PR version injection, without npm
credentials or installing into/saving the restored workspace dependency tree.
To repeat runtime checks on another supported Node executable while retaining
Node 24 for build/compiler tools:

```sh
SITEMAPS_CONSUMER_NODE=/absolute/path/to/node pnpm run test:packages
```

## Publication limits

This gate certifies JavaScript archives and offline consumption, not cloud
deployment, full multilingual jsii packaging, or registry owner settings.
The existing Node 20 Lambda defaults are retained; fixture overrides use Node 18
to exercise the consumer compatibility boundary. Lifecycle warnings do not
authorize runtime migration.

Root overrides do not propagate to npm consumers. The Node 18 compatible SDK
still pins `fast-xml-parser` 5.2.5 in an isolated public install; the workspace's
patched override is not a consumer resolution strategy. See
[dependency decisions](DEPENDENCY-MODERNIZATION.md). Publication remains blocked
on a reviewed patched-consumer strategy or an explicit compatibility-policy
decision; successful packed checks are not a security exception. This change
neither upgrades dependencies nor masks that graph with consumer overrides.
Release provenance, publisher configuration, channel policy and
partial-publication recovery belong to the following release PR.
