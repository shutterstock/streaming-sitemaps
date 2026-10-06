# Repository security configuration

This guide explains the checked-in security automation and the separate owner
settings needed to make it effective. It adapts the p-map repository's scan and
review patterns to this repository's shared pnpm lock and CDK/Projen source;
it does not inherit that project's release branches or license exceptions.

## Checked in automation

[dependabot.yml](dependabot.yml) scans npm manifests through the root workspace
and its single v9 [pnpm-lock.yaml](../pnpm-lock.yaml). The CDK package belongs
to that workspace; do not add a standalone scan unless it acquires its own lock.
GitHub Actions scans include both root workflows and the existing local
[coverage composite action](actions/coverage-report/action.yml).

Version updates run weekly with a seven-day cooldown. npm majors wait fourteen
days and arrive individually; AWS SDK, CDK/Projen/jsii, lint/TypeScript, testing,
and remaining minor/patch changes have separate groups. Security updates have
their own groups and bypass Dependabot's version cooldown. Security fixes still
need compatibility review, especially when a major is required. These semantics
and scan locations follow [GitHub's Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

There are no non-default maintenance targets or automatic merges. For every
major, review CommonJS and deep imports, Node >=18 engines, ES2018 output, Node 18
Lambda settings, CLI behavior, and the construct defaults. CDK, Projen and jsii
upgrades need a coordinated review of [.projenrc.ts](../packages/sitemaps-cdk/.projenrc.ts),
synthesized metadata, and packaged handlers. Dependabot may edit generated CDK
metadata without updating its source: reconcile the source and run
`pnpm run synth:cdk` before accepting its PR. Root
[release age policy](../pnpm-workspace.yaml) remains 10,080 minutes; resolve and
verify the root lock with Node 24 and pnpm 12.7.0. A fresh emergency fix can pass
Dependabot's cooldown yet fail a fresh pnpm resolution. Prefer a sufficiently
aged safe release; if none exists, an owner must review a narrowly scoped,
temporary release-age exception in a dedicated remediation PR.

GitHub currently [documents pnpm v7 through v10 support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories),
not v12.7. This repository deliberately retains a single v9 lock document, but
that alone does not prove hosted updater compatibility. The
[updater source](https://github.com/dependabot/dependabot-core/blob/d92dca83ecbf13defeec6c70698012b7d84cbf1a/npm_and_yarn/lib/dependabot/npm_and_yarn/helpers.rb)
prepares package managers with Corepack and contains handling for pnpm 11/12;
this source evidence does not establish which revision GitHub runs. After this configuration
lands on main, inspect the first npm update log and require a root lock plus
workspace manifest update that passes a frozen install. If the updater rejects
the manager or workspace policy, track that external limitation and perform
reviewed manual updates until supported; do not downgrade the developer pin,
create nested locks, or bypass the policy to silence it.

[CodeQL](workflows/codeql.yml) analyzes JavaScript/TypeScript and GitHub Actions
on main pushes, PRs, weekly scans, and manual dispatch. It uses security-extended
queries and no-build extraction without installing or executing package code.
The language matrix and build configuration follow the
[released CodeQL Action documentation](https://github.com/github/codeql-action/blob/v4.38.2/README.md)
and [GitHub advanced setup guidance](https://docs.github.com/en/code-security/code-scanning/creating-an-advanced-setup-for-code-scanning/customizing-your-advanced-setup-for-code-scanning).

[Dependency Review](workflows/dependency-review.yml) rejects newly introduced
high/critical vulnerabilities in runtime, development, and unknown scopes. It
retries dependency snapshot warnings for up to 120 seconds and never writes a
PR comment. It reviews the PR delta, not all existing alerts. See the
[pinned action's inputs and prerequisites](https://github.com/actions/dependency-review-action/blob/v5.0.0/README.md)
and [supported dependency graph manifests](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems).

Both workflows accept PRs to main. Use `pull_request`, never
`pull_request_target` with a contributor
checkout. Tokens default to contents read; only CodeQL's analysis job requests
security-events write. GitHub [allows CodeQL uploads for Dependabot PR scans](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/resource-not-accessible)
under this trigger despite the bot's restricted token. Keep fork and bot scans
credentialless: do not add PATs, npm/AWS secrets, OIDC, installation scripts,
comment permissions, or privileged follow-up workflows to make a check pass.

The new actions use full commit pins resolved from released tags older than
seven days: checkout v7.0.0 (2026-06-18), dependency-review v5.0.0 (2026-05-08),
and CodeQL v4.38.2 (2026-09-24). The CodeQL release API additionally reports
`immutable: true`; checkout and dependency-review report `false`. Commit pins
make workflow references immutable without claiming every upstream release has
GitHub's release immutability setting. Verify release/tag commit correspondence
when updating. Minor and patch Action updates remain enabled for SHA pins.
This change does not redesign the existing release or documentation workflows.

## License review policy

Dependency Review's license check is explicitly disabled pending an owner-reviewed
policy. Root and published package manifests declare MIT, but that is not a license determination
for every third-party package. The 2026-10-05 dependency-graph SBOM returned 1,498
components and only one `licenseDeclared` field, so it cannot establish a vetted
allowlist. There are no approved package exceptions in this configuration.

For additions and updates, examine the exact npm tarball's package metadata,
LICENSE/COPYING files, notices, and bundled third-party source. Record SPDX
identifiers, versions, artifact integrity, source links, obligations, and the
reviewer's decision. Escalate missing, conflicting, custom, or copyleft terms
to the organization's license owner. Before enabling an automated allowlist,
inventory the actual locked production and development artifacts and obtain
owner approval for the proposed terms. Reject absent license metadata explicitly
if adopting a fail-closed policy: the pinned action otherwise warns about
unlicensed entries. Keep any exceptions version-specific with a separate guard
against name-only matching and an evidence document; re-review on version change.
Do not inherit p-map's robust-predicates exception or another project's allowlist.

## Read only findings and owner setup

Measured via GET requests to the repository's GitHub API on 2026-10-05. Settings
and alerts were not changed. Counts are a baseline and will change as dependencies
are repaired by separate work.

| Area | Observed state | Owner task |
| --- | --- | --- |
| Dependabot alerts | Enabled (alerts endpoint returned 204); 104 open alerts: 5 critical, 51 high, 31 medium, 17 low | Triage the existing backlog, prioritizing reachability and build/release exposure; do not equate a green PR delta review with remediation |
| Automatic security fixes | Disabled, not paused | Enable Dependabot security updates after the configuration reaches main and inspect the first npm updater job |
| Dependency graph | SBOM API succeeded with 1,498 components | Verify the new v9 pnpm lock's snapshots include all workspace packages before relying on Dependency Review |
| Code scanning | Default setup not configured | Activate this advanced workflow on main, inspect both language results, and avoid enabling a duplicate default setup |
| Secret scanning | Disabled, including non-provider patterns and validity checks | Enable repository secret scanning; assess additional pattern coverage and validation according to organization policy |
| Push protection | Disabled | Enable repository push protection and review bypass handling and any organization constraints |
| Private vulnerability reporting | Private reporting GET returned `enabled: false` | Enable private reporting and establish a monitored intake and response owner before advertising its URL |
| Actions defaults | Actions enabled; all actions allowed; default token write; PR approval allowed; required SHA pinning false | Review a contents-read default, disable action PR approval, and evaluate an allowed-action policy and SHA enforcement only after auditing all existing workflows |
| Main protections | Branch protection GET returned 404; rulesets API returned an empty list | Review protections and required checks after successful main-target runs; include build, Dependency Review, and both CodeQL languages using actual hosted check names |

Owner configuration uses [Dependabot security update setup](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/configuring-dependabot-security-updates),
[secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning),
[push protection](https://docs.github.com/en/code-security/secret-scanning/protecting-pushes-with-secret-scanning),
and [private reporting setup](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository).
If an organization policy blocks activation, record the exact denial and request
the specific owner setting; do not compensate with broader workflow permissions.

Do not disclose suspected vulnerabilities or secrets in public issues or PRs.
Use the organization's established private security channel while repository
private reporting is unavailable. On a confirmed leak, the credential owner must
revoke/rotate it and assess access; removing the string from Git does not revoke
the credential. Never include secret values in validation logs or evidence.
