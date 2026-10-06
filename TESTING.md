# Behavior tests and coverage

Use the [root development commands](README.md#development) with Node 24 and
pnpm 12.7.0. `pnpm run build:all` prepares workspace dependencies;
`pnpm run test` prepares deterministic gzip fixtures, emits unbundled CLI
commands for shared AWS mocks, and runs Jest in one process. Focus a suite with:

```sh
pnpm run test --runTestsByPath packages/sitemaps-wrapper-lib/src/sitemap-lifecycle.test.ts
```

[jest.config.js](jest.config.js) collects V8 coverage for package `src/**/*.ts`,
including source that no test imports, excluding tests and declarations.
[tsconfig.test.json](tsconfig.test.json) explicitly supplies Jest ambient types
so focused suites do not depend on another suite's references. Coverage uses
source maps and writes HTML, LCOV, text and a JSON summary under `coverage/`.
It is not a statement that every line reported by V8 is executable TypeScript.
There is no coverage threshold or percentage target.

## Measured maintenance baseline

Measured on the dependency prerequisite at `91a6a261`, then validated against
its CI repair at `f440cef2`, using Node 24.21.0 and pnpm 12.7.0. The repair only
moves CI lint after compilation and does not change package behavior.
The original imported-file report was 88.03% lines/statements; switching to
all package source exposes previously invisible files. The comparable source
baseline and resulting report are:

| Metric | Before | After |
| --- | --- | --- |
| Passing tests / suites | 197 / 32 | 271 / 41 |
| Skipped tests | 7 | 7 |
| Lines/statements | 9,968 / 12,055 (82.68%) | 10,246 / 12,058 (84.97%) |
| Branches | 757 / 1,038 (72.92%) | 889 / 1,157 (76.83%) |
| Functions | 278 / 339 (82.00%) | 294 / 343 (85.71%) |

Source changes alter denominators, and V8 branch counts can grow when additional
paths execute. These measurements include compatible fixes as well as new tests;
they are not a claim of percentage gains from tests alone. The 44 existing
snapshots remain unchanged. The after values include the follow-up
destination-open failure regression. Representative line/branch coverage:

| Source | Before lines / branches | After lines / branches |
| --- | --- | --- |
| Wrapper base | 82.43% / 82.69% | 97.10% / 93.06% |
| Index wrapper | 72.24% / 100.00% | 98.00% / 94.44% |
| DB batch | 91.89% / 76.00% | 100.00% / 100.00% |
| DB repair planner | 92.76% / 72.22% | 100.00% / 100.00% |
| CLI conversion | 94.73% / 77.77% | 98.95% / 93.10% |
| CLI rotation | 80.15% / 75.00% | 100.00% / 100.00% |

Tests gate downstream callbacks and finalization to observe backpressure and
completion; they inject stream, upload, database and notification failures;
they use fake timers for batch retry budgets. XML round trips check escaping,
Unicode, gzip, limits, index timestamps and subclass destination compatibility.
Repair tests check deduplication and ownership of stale by-file records. CLI
tests cover local files, gzip, CSV BOM/percent escaping, parsing failures, HTTP
status/body failures, Lambda function errors and dry-run payloads. AWS requests
are mocked; the existing dynalite suites and socket monitor use local endpoints.
No cloud account, arbitrary race sleeps or new output snapshots are needed.

## Teardown evidence and limits

A passing isolated conversion suite left `process.exitCode=1`: oclif's
`Command.catch` sets the shared exit code even when the test correctly expects a
rejection. [setupAfterEnv.cjs](setupAfterEnv.cjs) restores each test's initial
exit code, retaining Jest's own failure result. It also preserves the prerequisite's
per-suite Nock cleanup/restore. The full suite now exits naturally with status 0
without `--forceExit` or a Jest shutdown warning. The existing loopback socket
arrival/settled teardown assertions and SDK XML deserialization regression stay
in place.

A focused `--detectOpenHandles --coverage=false` run of wrapper lifecycle, CLI
behavior, native socket and upload ordering tests passed all 35 tests in four
suites, exited naturally and reported no open handles. Initial runs identified
Node 24 `STREAM_END_OF_STREAM` resources retained by the output mocks. Clearing
their call history, restoring spies and releasing the mock destination reference
removed those reports. Managed stream closure is asserted independently of
process exit. Node documents retained pipeline listeners in its
[stream API](https://github.com/nodejs/node/blob/main/doc/api/stream.md#streampipelinesource-transforms-destination-callback).

A concurrent worktree run exposed `EADDRINUSE` on the former fixed dynalite
port 8001. [setupBeforeEnv.js](setupBeforeEnv.js) now binds the helper's server
to an OS-assigned port before clients are created; the table config reads that
port from the environment even after `jest.resetModules()`. Shared teardown
closes the server in every suite. Independent shard and file-record suites also
passed concurrently in separate Jest processes (8 and 7 tests), and the
freshener suite's module resets passed all 13 tests. The bootstrap accesses the
pinned helper's server export; recheck that integration when upgrading it.

A full instrumented open-handle run was stopped after instrumentation pushed a
large existing writer test past its timeout; ordinary full suites passed.
The clean focused detector and full natural exit establish the tested teardown
behavior, rather than a claim about every resource path or Node version.

The seven existing skips and optional benchmark datasets remain limitations.
These tests do not certify live AWS retries, IAM permissions, Lambda runtime
migration or large production performance. Packed-consumer validation and
publication resolution policy belong to the package prerequisite work; this
change does not replace those checks.
