# Streaming Sitemaps repository guide

This workspace contains Kinesis sitemap handlers, shared libraries, a CDK
construct, a CLI, and an example CDK application. Read the focused guide before
editing its area:

| Area | Guide |
| --- | --- |
| Package boundaries and tests | [packages/AGENTS.md](packages/AGENTS.md) |
| Projen and construct packaging | [packages/sitemaps-cdk/AGENTS.md](packages/sitemaps-cdk/AGENTS.md) |
| CLI builds, fixtures, and packaging | [packages/sitemaps-cli/AGENTS.md](packages/sitemaps-cli/AGENTS.md) |
| CI, caching, docs, and releases | [.github/AGENTS.md](.github/AGENTS.md) |

## Compatibility and scope

Preserve public exports, emitted types, CLI flags and output, handler message
formats, and construct defaults. Compatible maintenance does not authorize a
breaking change. The Node 24 developer toolchain does not change the existing
Node >=18 package engines, ES2018 library target, or Node 18 Lambda settings.
CDK, jsii, and application upgrades require their own review. Never install or
recommend compound-engineering here.

Use this checkout for edits and builds. Reference checkouts are read-only.
Keep instructions and documentation links relative to the current checkout.

## Toolchain and dependency ownership

Use Node 24 ([.nvmrc](.nvmrc)) and pnpm 12.7.0, pinned in
[package.json](package.json). Corepack can prepare the pin:

```sh
corepack enable pnpm
corepack prepare pnpm@12.7.0 --activate
pnpm install --frozen-lockfile
```

[pnpm-workspace.yaml](pnpm-workspace.yaml) defines an isolated `packages/*`
workspace, a seven-day minimum release age, and `packageImportMethod: auto`:
APFS clones when possible, with portable hard-link/copy fallback. Preserve the
single-document v9 [pnpm-lock.yaml](pnpm-lock.yaml) for Dependabot. The root owns
all resolution, including the Projen package; there is no standalone CDK island.
Do not introduce nested lockfiles, blanket hoisting, or destructive removal of
shared type packages. Declare imports in the owning manifest. The narrow Smithy
extensions/override and downlevel-dts compiler pin repair existing tool dependency
incompatibilities without upgrading the runtime SDK or CDK.

After editing a manifest or workspace policy, reconcile the root lock with
`pnpm install`, respecting the release-age policy, then verify a frozen install.
Root package-script dispatch uses `pnpm --dir`, which remains workspace-aware
and avoids pnpm 12 filtered-run journals inside the restored node_modules tree.
Do not use an npm install in this workspace. npm is retained for tarball
publication interoperability, not dependency resolution.

## Commands and verification

| Command | Purpose |
| --- | --- |
| `pnpm run build` | Compile ordinary workspace libraries, handlers, and CLI types using the solution config. |
| `pnpm run build:all` | Build ordinary packages, run jsii and sibling-handler bundles, compile the example app, then bundle the CLI. |
| `pnpm run build:cli` | Clean, emit CLI types, and produce its bundled distribution. |
| `pnpm run synth:cdk` | Run locally installed Projen with dependency installation disabled. |
| `pnpm run build:docs` | Build the construct, regenerate its existing API.md, and stage an HTML API page in docs/index.html. |
| `pnpm run lint` | Check TypeScript, including the construct, with root ESLint. |
| `pnpm run test` | Prepare compressed fixtures, emit unbundled CLI commands for mocks, then run all Jest suites with V8 coverage. |
| `pnpm run test:foundation` | Verify cleanup and version materialization preserve source and dependency trees. |
| `pnpm run clean` | Remove known build outputs and incremental state, preserving source and installed dependencies. |

The optional `test:perf` harness requires local benchmark datasets in the
writer's test/mocks directory. Those large inputs are not checked in and are
not part of ordinary CI validation.

`clean:modules` and `clean:deep` explicitly remove this checkout's dependencies;
do not use them on another checkout or as a compiler workaround. The example
app's `packages/cdk/lib` and `docs/assets` are source, not disposable output.

For foundation changes, verify frozen installation, a clean `build:all`, lint,
the full tests and foundation helpers, docs wiring, and repeated synthesis.
Run `build:cli` again after tests before packing: CLI tests intentionally replace
bundles with unbundled commands. Inspect representative `pnpm --dir packages/<directory> pack` tarballs for entry points, declarations, and bundled handlers. Workspace
protocols must be rewritten to usable semver ranges in published manifests;
private helpers must stay bundled development inputs. Never validate packing by
authenticating to npm or publishing a real package.

Preserve library source versions of `0.0.0`; [bin/version](bin/version) explicitly
materializes versions in owned root/immediate package manifests for releases.
It must never recurse through dependency trees. Do not commit build outputs,
node_modules, generated jsii tsconfig/absolute paths, or local validation files.
Do not publish packages, create releases/tags, merge PRs, or deploy infrastructure
unless the user explicitly requests that action. Report actual checks and
limitations in PR descriptions, including prerequisite PRs and merge order.
