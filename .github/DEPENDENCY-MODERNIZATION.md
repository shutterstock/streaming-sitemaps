# Dependency maintenance decisions

The October 2026 refresh uses Node 24 and pnpm 12.7.0 for tooling, with the
explicitly approved Node >=24 package minimum, existing seven-day release-age policy and one root lockfile. The construct
remains a workspace package because it bundles sibling handlers. There is no
standalone installation or second lockfile.

## Tooling

[.projenrc.ts](../packages/sitemaps-cdk/.projenrc.ts) selects Projen 0.103.27,
jsii 6.0.16, independently released Rosetta 6.0.17, TypeScript 6.0.3, and the
diff/docgen/pacmak tools. Projen now generates portable root, test, and runner
TypeScript configs. The TypeScript runner works without conversion to JavaScript
or removal of ambient types. Repeat synthesis must preserve tracked files and
the lockfile. Root workspace policy owns transitive overrides.

TypeScript 7 is held because ts-jest's published peer range is `<7` and the jsii
6 compiler uses TypeScript 6. ESLint 10 uses the flat config. The unused import
plugin was removed rather than retaining its incompatible ESLint peer range.
Jest 30 requires the canonical `toThrow` matcher and VM modules for oclif's
ESM plugins. The dedicated test TypeScript config explicitly selects Node and
Jest types because [TypeScript 6 defaults `types` to an empty list](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).
CLI DynamoDB tests answer the actual confirmation prompt through Enquirer,
asserting its options instead of sending stdin after a fixed startup delay.
Socket tests await actual loopback requests and settle them before
teardown. Their TLS fixture is synthetic and never used outside tests.
Each suite disposes Nock's shared HTTP interceptors so Jest's separate module
registries cannot leave overlapping patches installed for later suites.

The CDK CLI and library have independent version sequences: CLI 2.1143.0 and
library 2.271.0 are tested together. Source-mode NodejsFunction construction
explicitly keeps the previous connection-reuse environment default. Updated
IAM expectations retain exact logical IDs and reflect CDK's split DynamoDB
statements and removal of its redundant Kinesis DescribeStream grant. Snapshot
values are unchanged; Jest only updates their documentation-link headers.

## Compatible version holds

Published registry metadata and actual packed consumers determine compatibility.
Do not infer this repository's policy from the reference repositories.

| Dependency           | Selected release | Reason for the hold                                                                                                                                                                                            |
| -------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @oclif/test          | 3.2.15           | Existing fluent command tests use the API removed by v4. Migrating the test framework is distinct from preserving the tested command contract.                                                                 |
| nock                 | 14.0.17          | Align the root and CLI HTTP interceptors; mixed v15/v14 copies caused full-suite timeouts and disallowed dynalite loopback requests. The fluent test framework retains its separately declared v13 dependency. |
| listr2               | 3.14.0           | Existing task options, timers and interactive prompt API change in v8. Keep the tested renderer/prompt behavior and declare its enquirer peer directly.                                                        |
| node-fetch           | 2.7.0            | v3 is ESM-only; published CommonJS consumers retain the compatible v2 branch.                                                                                                                                  |
| it-batch             | 1.0.9            | Later majors are ESM-only.                                                                                                                                                                                     |
| uuid                 | 11.1.1           | Retains the CommonJS export and fixes the buffer-bounds advisory; later majors are ESM-only.                                                                                                                   |
| aws-embedded-metrics | 2.0.7            | The published flatten helper's peer range requires major 2.                                                                                                                                                    |
| lambda-log           | 3.1.0            | 3.2's new declarations change the logger metadata/argument contract; its stable release is deprecated in favor of an v4 prerelease. No beta is substituted.                                                    |

Useful primary sources include the [npm registry](https://registry.npmjs.org/),
[node-fetch's CommonJS guidance](https://github.com/node-fetch/node-fetch#loading-and-configuring-the-module),
[uuid's CommonJS migration note](https://github.com/uuidjs/uuid#note), and
[CDK versioning](https://docs.aws.amazon.com/cdk/v2/guide/versioning.html).
The manifest and lockfile are the exact installed-version record.

## Runtime and security limits

Node >=24 is now the supported public library/CLI minimum and the workspace
toolchain. This intentionally raises the previous engine floor; release notes
and version review must identify the support change. CommonJS exports remain.
The SDK clients use 3.1143.0, SDK types 3.974.6, oclif core/help/plugins use
5.1.2/7.0.2/7.0.3, and sitemap uses 9.0.1, selected from stable published versions
older than seven days. The former Node 18 SDK/type/XML overrides are removed.
Node types align on major 24, including isolated consumer validation.

CLI bundles target Node 24. Shared-library ES2018 output and the construct's
jsii ES2022 output remain compatible syntax. Private Lambda bundles target
Node 20; the selected SDK requires Node >=20 and sitemap requires >=20.19.5.
Existing Node 20 Lambda defaults stay explicit; the packed construct consumer
opts into Node 24 for all three functions. Node 20 Lambda was deprecated on
April 30, 2026 according to the [AWS runtime lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).
Changing deployment defaults remains a separate migration. Local checks are
not cloud deployment certification.

The refreshed SDK uses its current XML implementation instead of the old pinned
fast-xml-parser dependency; actual SDK XML response deserialization is regression
tested. Workspace release tooling independently resolves patched fast-xml-parser
5.11.2 without an override. An isolated consumer of all six public tarballs,
with only unpublished sibling packages mapped to their archives, reports zero
production advisories across 116 dependencies and contains no fast-xml-parser.
This is an October 2026 registry audit, not a guarantee against future findings.
Public consumers must be audited independently because root overrides do not
propagate. Workspace advisories are reported rather than suppressed:

- The test-only AWS SDK v2 region advisory has no patched v2 release; dynalite
  tests use a fixed region and local endpoint.
- braces 3.0.3 has an unpatched advisory in documentation tooling.
- sprintf-js has an unpatched precision-specifier advisory in CLI tooling.
- http-cache-semantics 4.3.0 fixes a tooling advisory but was published October 4,
  so it is not eligible under the seven-day policy until October 11.

The construct has no published npm baseline: jsii-diff's registry compatibility
task skips analysis after a 404. Compilation, JavaScript pacmak packaging,
declarations, real tarballs, CommonJS/native ESM loading, and offline synthesis
are separately validated. Existing extensionless deep-export targets also fail
in an isolated consumer; explicit `.js` deep imports work. The package-correctness
follow-up must address the broader export/consumer contract before release.
