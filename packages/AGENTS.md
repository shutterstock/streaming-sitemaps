# Package boundaries and tests

Read the [root guide](../AGENTS.md). Each immediate package directory is part of
the root pnpm workspace and shares its lockfile and installation policy.

The Kinesis handlers consume models, database, metrics, utility, and wrapper
libraries. The construct bundles the three sibling handlers. The CLI bundles its
utilities and keeps oclif plugins external. `cdk` is an example application.
`sitemaps-utils-lib` and the handler packages are private; do not make them
registry dependencies of public packages. `sitemaps-wrapper-lib`, models,
database, metrics, CLI, and construct are publishable.

Declare internal links as `workspace:^` in the appropriate dependencies or
devDependencies. Declare imported runtime libraries and test helpers directly;
do not depend on npm's former hoisting or incidental pnpm peer resolution.
Root scripts provide shared TypeScript, lint, and Jest executables. Package
scripts named `test` in ordinary libraries are placeholders; use root tests.

[tsconfig.packages.json](../tsconfig.packages.json) supplies strict composite
TypeScript settings and `importHelpers`, so compiled packages need `tslib`.
[tsconfig.json](../tsconfig.json) builds ordinary packages. The jsii construct
and example app run separately in `build:all` after their inputs are available.
Read the [construct guide](sitemaps-cdk/AGENTS.md) before changing its configs.

[jest.config.js](../jest.config.js) selects `packages/**/*.test.ts`, transforms
with ts-jest and the root package config, and collects V8 LCOV/HTML/text coverage.
There is no coverage threshold. [setupBeforeEnv.js](../setupBeforeEnv.js) starts
jest-dynalite with the root table config. AWS clients are mocked in relevant
suites; keep the mock's Smithy types aligned with the installed SDK.

Run a focused suite after building its dependencies:

```sh
pnpm run test --runTestsByPath packages/sitemaps-db-lib/src/batch.test.ts
```

Keep behavior tests alongside source or in the existing package test directory.
Do not silently skip failing suites or refresh snapshots to hide a migration
regression. Distinguish missing fixtures/tooling issues from application changes.
Public tarballs should omit tests, coverage, dependency trees, and agent guides;
inspect actual archives, not just successful compiler output.
