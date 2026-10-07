---
name: release
description: Prepare, validate, or recover coordinated Streaming Sitemaps npm releases and stable docs publication. Use for release readiness, release notes, authorized publication, or failed partial releases in this repository.
---

# Streaming Sitemaps release

Read the current checkout's [release guide](../../../.github/RELEASING.md),
[package contract](../../../.github/PACKAGE-CONTENTS.md),
[dependency decisions](../../../.github/DEPENDENCY-MODERNIZATION.md), and
[publication policy](../../../.github/release-policy.json) before deciding readiness.
Use the selected workspace for edits, builds and Git. Reference checkouts are
read-only. Inspect actual pushed prerequisite commits and hosted checks; local
passes do not bypass failing prerequisites.

Prepare a concrete plan with the exact reviewed source commit, explicit SemVer,
channel, release notes, gates and blockers. Public source versions stay `0.0.0`;
do not derive releases from them. No maintenance-branch policy is established.
Support stable `latest` and prerelease `next` from main ancestors, with strict
`vX.Y.Z[-prerelease]` tags and matching GitHub flags. Do not import p-map's trains
or ESM migration rules.

Use [bin/public-packages.cjs](../../../bin/public-packages.cjs) for the exact
order: `@shutterstock/sitemaps-models-lib`, `@shutterstock/sitemaps-db-lib`,
`@shutterstock/sitemaps-metrics-lib`, `@shutterstock/sitemaps-wrapper-lib`,
`@shutterstock/sitemaps-cli`, `@shutterstock/sitemaps-cdk`. CLI needs published
models/database/wrapper. Utils are private bundled inputs. Construct bundles all
three handlers/maps and has no published internal dependencies. Root, example
app, utils and all three handlers stay private.

Start from clean reviewed source and current origin. Inspect prior GitHub
releases and every package's registry versions/dist-tags. Prepare notes from the
previous release diff, covering user changes, compatibility, all six packages
and known limits. The intentional Node >=24.0.0 minimum is a breaking support
change: review an established 1.x-or-later line as a new major; review an
unpublished/0.x line explicitly against real history without guessing versions.
Use the [draft notes](../../../.github/RELEASE-NOTES.md). Preserve CommonJS/deep
imports, Node types 24 and CLI target 24. Lambda defaults and handler bundle
targets remain Node 20 as a separate deployment migration; packed fixtures
request Node 24. The SDK 3.1143.0 refresh resolves the former pinned XML-parser
hold; audit fresh public consumers independently from workspace tooling.
Independently report publisher settings for each package as
unverified until owner evidence exists; code cannot prove them.

Run the guide's committed Node 24/pnpm 12.7.0 gates: frozen install, clean
`build:all`, lint, full tests, `test:foundation`, CLI rebuild after tests,
**`pnpm run test:packages`**, `build:docs`, repeated `synth:cdk`, and generated
drift inspection. Verify actual `node --version` is major 24, not the shared
default 26. Run `SITEMAPS_AUDIT_PACKAGES=1 pnpm run test:packages` and record
current production audit results and graph size. Also validate the explicitly
injected candidate and the credentialless six-package pack/dry run. Inject after
installation/strict restore. Never rewrite the lock, implicitly install/repair/save restored trees,
or commit versions, archives or build outputs.

Before publication, verify the immutable remote tag object/peeled commit,
published release ID/flags/target, source versions, main ancestry, exact archives
and registry/version/channel state using the reusable
[release guards](../../../bin/release-lib.cjs) and workflow. Manual dispatch runs
from current main and names an existing published tag. Never use
`npm version from-git`, force tags, delete releases or unpublish.

Preparation, notes and PRs do not authorize publication. Require explicit
publishing authorization for the concrete commit/version/release and trigger
immediately before external mutation, unless already granted in the session.
Do not change publishers, secrets, protection or account settings without
separate authorization. Stop at a reviewed PR when scope is implementation;
never create a release merely to test the workflow.

For partial failure, follow the guide's recovery procedure. Recheck the exact
failed run, unchanged tag/release, every immutable version/integrity and channel.
After resolving the diagnosed blocker and confirming authorization, rerun failed
jobs or dispatch the same tag from current main. Identical versions on the
expected channel are verified/skipped; absent versions publish in order.
Integrity/channel mismatch, supersession or registry errors stop recovery.
Compare differing rebuilds against retained archives; do not silently substitute
packages. Broken tagged code requires a new reviewed version, never tag repair.

Docs require all six stable npm versions to agree and a current verified stable
release/tag/source. Emit ordinary workspace inputs with `pnpm run build`, then
build that exact commit with `pnpm run build:docs`, inject
its version after restore and recheck registry/source immediately before Pages.
Failed or partial publication cannot update docs. Infrastructure stays disabled.
For automatic docs after manual publication, use the successful run attempt's
validated publication receipt for the built tag commit; dispatch `head_sha`
identifies main's workflow source. Docs accept only publication `workflow_run`
events. For an explicitly authorized docs repair, verify and rerun that reviewed
docs attempt for the current stable publication within GitHub's 30-day rerun
window; all receipt/registry/source guards still apply. Missing/mismatched
receipts or an ineligible attempt require owner review and separately authorized
immutable publication recovery when needed, never a direct docs dispatch or
provenance bypass. See [docs recovery](../../../.github/RELEASING.md#stable-documentation).

Report actual gates, readiness and remaining owner blockers. PR dry runs do not
establish npm OIDC owner settings, real publication or Pages behavior. Preserve
the guide's publication policy, separate tooling/owner requirements and
prerequisite merge order.
