# Coordinated npm releases

The source of truth is a clean reviewed main commit, its immutable
`vX.Y.Z[-prerelease]` tag, and an existing published GitHub Release for that tag.
No release tags or maintenance branches existed in the audited repository.
The former workflow normalized an optional `v`; publication now requires it.
`bin/version` still accepts explicit legacy `release/v...` inputs locally, but
publication does not. No p-map maintenance trains are introduced. All six public
source packages and root remain `0.0.0`; the private example remains `0.1.0`.
Never commit materialized versions.

Read the [package contract](PACKAGE-CONTENTS.md) and
[dependency decisions](DEPENDENCY-MODERNIZATION.md). The checked-in
[publication hold](release-policy.json) blocks registry writes until a reviewed
patched-consumer strategy or explicit compatibility-policy decision addresses
the held SDK's isolated `fast-xml-parser` 5.2.5 graph. Passing tests and workspace
overrides do not resolve that decision. Record its resolution in a reviewed PR.

## Exact package set

[bin/public-packages.cjs](../bin/public-packages.cjs) is authoritative. Publish
one exact version in this order:

1. `@shutterstock/sitemaps-models-lib`
2. `@shutterstock/sitemaps-db-lib`
3. `@shutterstock/sitemaps-metrics-lib`
4. `@shutterstock/sitemaps-wrapper-lib`
5. `@shutterstock/sitemaps-cli`
6. `@shutterstock/sitemaps-cdk`

CLI needs published models/database/wrapper; utils are private bundled inputs.
Construct bundles all three handlers/maps and has no published internal
dependencies. Root, example CDK app, utils and all three handlers stay private.

## Prepare and validate

Use only the assigned checkout. Fetch origin, inspect status, and verify that
the selected main commit includes all prerequisites and passing hosted checks.
For this stack, merge dependency PR #7, then package contract PR #8, then this
release PR. Use actual completed pushed heads; do not bypass failing checks.

Inspect previous GitHub releases and each package's public registry versions and
`dist-tags` before choosing an explicit SemVer. Never infer it from source
`0.0.0`, `npm version from-git`, a branch basename or another repository.
Stable versions use `latest`; prereleases use `next` and a matching GitHub
prerelease flag. Ambiguous numeric identifiers/build metadata are rejected.
Channels never move backwards; older publication needs a separately reviewed
policy. Missing packages or registry read errors stop the workflow; ownership
and initial publisher bootstrap are separate owner operations.

Prepare release notes from the previous release/tag diff: user-visible changes,
compatibility, fixes, upgrade instructions, all six coordinated packages, SDK
consumer limits and retained Lambda defaults. Record exact commit, version,
channel, verified checks and exceptions before reviewing the publication plan.

Use Node 24 and pnpm 12.7.0 and run the committed gates:

```sh
pnpm install --frozen-lockfile
pnpm run clean
pnpm run build:all
pnpm run lint
pnpm run test
pnpm run test:foundation
pnpm run build:cli
pnpm run test:packages
pnpm run build:docs
pnpm run synth:cdk
pnpm run synth:cdk
git diff --exit-code
```

Set `RELEASE_VERSION` to the explicitly reviewed candidate SemVer and inject it
**after** installation, then repeat build/lint/test/foundation, CLI rebuild and
packed consumers. Exercise the same credentialless pack/dry-run path as CI:

```sh
export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
bin/version "$RELEASE_VERSION"
# Repeat build and consumer gates before packing.
node bin/release.cjs pack "$RELEASE_VERSION" release-packages
node bin/release.cjs dry-run "$RELEASE_VERSION" release-packages
```

The destination must be fresh. Inspect the diff before restoring only the known
owned manifest version changes; never discard unrelated work. Do not synthesize
after injection: Projen regenerates its source version. Do not commit archives,
generated outputs or injected versions. Strict restored consumers never rewrite
locks, install/repair dependencies or save caches. `test:packages` explicitly
installs isolated disposable consumers outside the workspace tree.

## Authorization and provenance

Preparation, PRs and dry runs do not authorize tags/releases, workflow dispatch,
npm publication, dist-tag changes or deployments. Require explicit publishing
authorization for the concrete commit/version/notes and trigger immediately
before mutation, unless already granted in the session. This implementation
request authorizes only the PR. Publisher/settings/protection changes and the
consumer-policy decision are separate owner actions.

Read-only inspection includes `gh release view "$RELEASE_TAG" --repo
shutterstock/streaming-sitemaps` and `git ls-remote origin
"refs/tags/$RELEASE_TAG" "refs/tags/$RELEASE_TAG^{}"`. Verify exact tag object,
peeled commit, published release ID/tag/flag/target, clean source and main
ancestry. Release target must be `main` or the full tag commit. Preserve the tag
and release unchanged during recovery. Never force tags, delete releases or
unpublish.

[publish.yml](workflows/publish.yml) verifies those facts against the current
GitHub API and remote tag before dependency population. Manual dispatch must
originate from current main and explicitly name the existing published tag.
All jobs check out the verified immutable commit; injection follows strict cache
restore and producer-key equality. Full build/lint/test, foundations, CLI rebuild
and packed consumers precede publication.
Selection executes reviewed main's guards before checking out any requested
tag. After injection, manifest changes must differ from the tagged source only
by the explicit version. The existing oclif prepack README and docs API output
are the only tracked generated documentation exceptions; restore those local
outputs after validation and do not commit them.

Publication and docs share a non-cancelling queued concurrency group. Preflight
all six packages before writes, then refresh provenance and registry state before
each sequential publication. Publish exact archives with scripts disabled and an
explicit channel. Verify observed registry integrity/channel before continuing.
The workflow retains archives plus a commit/version/integrity plan for failure
investigation. PR CI dry runs have no npm credentials or publication permission.
Archive artifact names include the run attempt, so recovery retains each
attempt independently instead of replacing an earlier immutable artifact.
CLI prepack canonicalizes the asynchronously discovered command map without
changing command/flag metadata or array order under the same toolchain/runner. The packed-consumer gate packs
the real CLI twice and requires identical bytes and recovery integrity.
After all six registry versions are verified, the publisher writes a receipt
and uploads it as `publication-<run attempt>`, bound to the repository, exact
run/attempt, workflow source SHA, verified tag commit/version/channel and six
archive hashes. Failed or incomplete publication produces no successful receipt.

## Independent npm owner settings

The [official npm trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/)
require GitHub-hosted runners, Node >=22.14.0, npm >=11.5.1 and `id-token: write`.
This repository uses Node 24 and checks the npm floor without tooling installs.
OIDC automatically generates provenance for public repositories/packages.
No npm token or registry authentication setup is used.

Owners must independently verify **each of the six packages listed above**
exists and has a trusted publisher for organization `shutterstock`, repository
`streaming-sitemaps`, workflow filename `publish.yml`, and no environment (the
job uses none). Enable **direct `npm publish`**: new publishers default to staged
publication. No `npm dist-tag` permission is needed; this workflow never repairs
channels. Verify each package's repository URL. Code, dry runs and green CI do
not prove these settings or a working OIDC publish. This PR does not create
publishers, secrets or packages, or change repository/account settings.

## Partial-publication recovery

Stop at the first failure. Inspect the exact failed run/source commit, retained
artifact plan, unchanged release/remote tag, and **every** package's immutable
version/integrity and `latest`/`next`. Read errors are blockers, never absence.
After resolving the diagnosed blocker and confirming publishing authorization,
rerun failed jobs or dispatch the same existing release tag from current main.
Every attempt rechecks API/tag and registry, even when setup jobs are reused.

Identical existing versions on the expected channel are verified/skipped;
missing versions publish in order. Different bytes, missing integrity,
superseding channels or existing versions on a different channel stop for owner
review. Compare differing rebuilds to retained archives and source; never treat
mismatched bytes as equivalent. There is no automatic archive substitution or
dist-tag repair. Wrong tagged code requires a new reviewed commit/version,
never rewriting the old tag/release or unpublishing. npm writes are not atomic
across six packages.

## Stable documentation

[docs.yml](workflows/docs.yml) runs after successful publication or an explicitly
authorized manual repair from current main naming the current stable tag.
Require all six npm `latest` versions to agree and contain published integrity
metadata, then verify the corresponding stable GitHub release/tag/main ancestry.
Automatic docs also checks the real completed run's path/event/conclusion,
repository and its verified publication receipt. A manual publication's
`head_sha` identifies the dispatch workflow's main commit, not the checked-out
tag: docs select the receipt's published tag commit instead, even when main has
advanced. The receipt must match the exact successful run attempt and all six
stable registry archive hashes. Superseded/prerelease publication receipts are
skipped. Build the exact stable tag, never unreleased main.
Missing, expired, tampered or mismatched receipts stop automatic docs. Owners
can use the separately authorized manual docs repair from current main with
the current stable tag; the registry/source/construct-integrity guards still apply.

After strict restore, inject the verified stable version and run the actual
`pnpm run build` first to emit workspace inputs required by handler bundling,
then `pnpm run build:docs` (construct compile/docgen, existing HTML staging).
Recheck stable registry and immutable source immediately before Pages, and
require the rebuilt construct archive's integrity to match the published version.
This binds API/handler source to registry bytes even for manual repair; differing
rebuilds stop for owner review. Partial/failed
publication cannot deploy docs and superseded docs cannot overwrite stable
content. The existing infrastructure deployment remains disabled.

## Verification limits

Run actionlint on workflows. Released actionlint 1.7.12 predates GitHub's official
[`queue: max`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
key; ignore only that exact diagnostic with this version. CI's existing
constant-false deploy diagnostic is expected; do not enable deployment.
Fixture tests cover Git refs, event guards, immutable recovery, registry errors,
archive tampering and docs gating without publication. Hosted PR CI proves cache
and consumer behavior, not real release routing, npm owner settings/OIDC writes
or Pages deployment. Record these limits and the publication hold in review.

The audit's anonymous registry reads returned HTTP 404 for all six package
names. That does not prove owner/private-package state; owners must independently
verify/bootstrap public package ownership and publishers before this guarded
workflow can publish. Registry absence is not automatically repaired here.
