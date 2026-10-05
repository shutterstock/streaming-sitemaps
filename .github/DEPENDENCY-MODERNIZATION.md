# Dependency maintenance decisions

The October 2026 refresh uses Node 24 and pnpm 12.7.0 for tooling, with the
existing seven-day release-age policy and one root lockfile. The construct
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
ESM plugins. Socket tests await actual loopback requests and settle them before
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

| Dependency              | Selected release       | Reason for the hold                                                                                                                                                                                            |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS SDK v3 clients      | 3.967.0                | 3.968.0 raises the published minimum to Node 20. Public Node 18 consumers remain supported by the existing engine contract. SDK types are aligned at 3.965.0.                                                  |
| oclif core/help/plugins | 4.14.0 / 6.3.0 / 5.5.2 | Their published engines include Node 18; current higher majors require Node 22. The build-only oclif generator is upgraded to 6.0.2.                                                                           |
| @oclif/test             | 3.2.15                 | Existing fluent command tests use the API removed by v4. Migrating the test framework is distinct from preserving the tested command contract.                                                                 |
| nock                    | 14.0.17                | Align the root and CLI HTTP interceptors; mixed v15/v14 copies caused full-suite timeouts and disallowed dynalite loopback requests. The fluent test framework retains its separately declared v13 dependency. |
| listr2                  | 3.14.0                 | Existing task options, timers and interactive prompt API change in v8. Keep the tested renderer/prompt behavior and declare its enquirer peer directly.                                                        |
| sitemap                 | 8.0.3                  | v9 requires Node >=20.19.5.                                                                                                                                                                                    |
| node-fetch              | 2.7.0                  | v3 is ESM-only; published CommonJS consumers retain the compatible v2 branch.                                                                                                                                  |
| it-batch                | 1.0.9                  | Later majors are ESM-only.                                                                                                                                                                                     |
| uuid                    | 11.1.1                 | Retains the CommonJS export and fixes the buffer-bounds advisory; later majors are ESM-only.                                                                                                                   |
| aws-embedded-metrics    | 2.0.7                  | The published flatten helper's peer range requires major 2.                                                                                                                                                    |
| lambda-log              | 3.1.0                  | 3.2's new declarations change the logger metadata/argument contract; its stable release is deprecated in favor of an v4 prerelease. No beta is substituted.                                                    |

Useful primary sources include the [npm registry](https://registry.npmjs.org/),
[node-fetch's CommonJS guidance](https://github.com/node-fetch/node-fetch#loading-and-configuring-the-module),
[uuid's CommonJS migration note](https://github.com/uuidjs/uuid#note), and
[CDK versioning](https://docs.aws.amazon.com/cdk/v2/guide/versioning.html).
The manifest and lockfile are the exact installed-version record.

## Runtime and security limits

Development on Node 24 does not change the Node 18 library/CLI engine or ES2018
output of the non-jsii libraries. The construct uses jsii 6’s ES2022 output.
Bundles retain their Node 18 syntax target, which also runs on
the existing Node 20 Lambda default. Runtime selection through construct props
remains explicit. Node 20 Lambda was deprecated on April 30, 2026 according to
the [AWS runtime lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).
An operator must review a runtime migration; this maintenance does not change
that deployment default or enable deployment. Local smoke checks are not cloud
deployment certification.

The workspace refresh removes obsolete transitive resolutions and overrides
fast-xml-parser to the compatible, patched major-5 release 5.11.1. The
development-only DynamoDB v2 SDK uses uuid 11.1.1. Remaining workspace advisories
are reported rather than suppressed:

- The test-only AWS SDK v2 region advisory has no patched v2 release; dynalite
  tests use a fixed region and local endpoint.
- braces 3.0.3 has an unpatched advisory in documentation tooling. Patterns come
  from the checkout, not untrusted service requests.
- http-cache-semantics 4.3.0 fixes a tooling advisory but was published October 4,
  so it is not eligible under the seven-day policy until October 11.

Root overrides do **not** control registry consumers of published libraries.
The isolated tarball consumer resolves the SDK's pinned fast-xml-parser 5.2.5
without that override. Publication therefore requires a reviewed strategy for
patched consumer resolution, or an explicit compatibility-policy decision.
Do not describe the packed dependency graph as vulnerability-free.

The construct has no published npm baseline: jsii-diff's registry compatibility
task skips analysis after a 404. Compilation, JavaScript pacmak packaging,
declarations, real tarballs, CommonJS/native ESM loading, and offline synthesis
are separately validated. Existing extensionless deep-export targets also fail
in an isolated consumer; explicit `.js` deep imports work. The package-correctness
prerequisite must address the broader export/consumer contract before release.
