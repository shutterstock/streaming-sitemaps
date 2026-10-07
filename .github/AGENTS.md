# CI, documentation, and release guide

Read the [root guide](../AGENTS.md). Root workflows own this workspace's CI;
Projen's nested construct workflows are disabled at their source.

| Workflow | Behavior |
| --- | --- |
| [ci.yml](workflows/ci.yml) | Push/PR to main: populate dependencies, build/test, lint/build/pack; build remains an always-running gate on setup and test success. Deployment stays disabled. |
| [docs.yml](workflows/docs.yml) | Successful publication only, including authorized reruns of that docs attempt: verify all six stable registry versions and immutable tag/source, restore, inject stable version, build the existing API page and gate Pages publication. |
| [publish.yml](workflows/publish.yml) | Published release or explicit manual recovery from current main: verify tag/release provenance, strictly restore, inject explicit version, build/lint/test/verify consumers, and publish six ordered archives with npm OIDC, subject to the reviewed publication hold. |

## Completed dependency caching

All setup calls use released
[pwrdrvr/configure-nodejs v1.6.0](https://github.com/pwrdrvr/configure-nodejs/releases/tag/v1.6.0)
at `8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3`, directly. There is no local wrapper.
Each workflow has a completed-tree `populate` producer and strict `restore`
consumers on the same runner type, working directory, Node 24 major, pnpm pin,
action revision/policy namespace, and immutable `github.sha` checkout.

The key covers full root/package manifest bytes, the lock/workspace policy,
root/package .npmrc files, and the Projen source. The action also scans owned
installation inputs while excluding node_modules, protects the frozen lock/input
bytes, and includes runner OS/architecture/ImageOS, working directory, Node
major and the exact manager pin; restored metadata also validates the ABI. ImageVersion and producer/consumer role do
not split the key. Keep the producer cache-key output and every consumer equality
check. A strict miss fails instead of installing or repairing dependencies.

Root script dispatch uses `pnpm --dir` rather than filtered recursive runs to
avoid pnpm 12 writing task journals inside the restored dependency tree.
Use directory-scoped packing as well: filtered packing can refresh workspace
state metadata after version changes.
Every consumer sets `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'` so pnpm 12 cannot
implicitly install after version materialization. Producers retain normal
verification and save only successfully completed trees. Do not save caches
after changing versions, pack hooks, compilation, or tests. Preserve the pnpm
seven-day policy and `npm_config_min_release_age: '7'`.

## Validation and release boundaries

The build job runs `pnpm run test:packages` after version injection/build/pack.
This explicit disposable consumer install uses its own temporary store/home
outside the workspace. It must never install into or save the restored tree.
See the [public package contract](PACKAGE-CONTENTS.md) for the complete npm set,
dependency order, offline checks and publication limits.

CI retains the `install-deps`, `test`, and `build` job identifiers. The always
running build gate fails setup/test failures instead of reporting a skipped
required check. Coverage comments use public peter-evans actions and skip fork
and Dependabot PRs. No-token paths still build/test/pack. Dry-run publication
operates on `pnpm pack` tarballs without npm authentication, using an explicit
`ci-preview` tag so npm accepts PR prerelease versions; never add credentials
to PR packaging checks. Upload-artifact uses a supported action version.

Validate YAML/action inputs, cache input equality, and actionlint after workflow
changes. The intentionally disabled deploy job's constant false condition is an
expected actionlint diagnostic; do not enable deployment to remove that warning.
Local build/test results do not establish hosted cache or GitHub event behavior.

The build job verifies the freshly packed construct tarball with
`pnpm run test:cdk-consumer <tarball>` after version materialization/build/pack.
This explicit disposable consumer install uses its own temporary store/cache
outside the workspace; it must never install into or save the restored tree.
The `sitemaps-cdk-consumer` artifact contains diagnostics and local synthesis,
separate from multilingual packaging and deployment.

[bin/version](../bin/version) materializes only owned versions, preserving
workspace protocols until pnpm pack rewrites them. Public wrapper, database,
models, metrics, CLI, and construct tarballs are publishable; private utilities
are bundled inputs, not registry dependencies. npm publishes the already packed
archives so workspace protocols cannot leak into registry manifests. Keep
release authentication confined to the actual publication job. Source versions
stay at their existing convention; manual publication requires a version tag.

The [release guide](RELEASING.md), [release skill](../.agents/skills/release/SKILL.md)
and reusable [guards](../bin/release-lib.cjs) define immutable tag/event provenance,
stable/next channels, partial recovery, docs gating and independent per-package
npm owner settings. The [publication policy](release-policy.json) reflects the
reviewed SDK 3.1143.0 consumer refresh; re-audit fresh public tarballs independently
from workspace tooling with `SITEMAPS_AUDIT_PACKAGES=1 pnpm run test:packages`.
Public package minimums are intentionally Node >=24; record this breaking support
change in version review and notes while keeping Lambda defaults at Node 20.
Do not run
release workflows, publish npm packages, create
releases/tags, merge PRs, change repository settings, or deploy infrastructure
without an explicit user request. Name dependencies and merge order in stacked
PRs; report checks actually verified and concrete remaining limitations.
