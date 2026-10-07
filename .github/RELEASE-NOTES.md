# Next coordinated release notes (draft)

Choose an explicit reviewed version/channel after inspecting actual prior
GitHub releases and every package's registry history. Source versions remain
`0.0.0`; this draft does not choose a release version or authorize publication.

## Intentional support change

Every public package now requires **Node >=24.0.0**, raising the previous Node
18 minimum. Upgrade application and CLI runtimes to Node 24 before installing.
Review this as a breaking support change when selecting the coordinated SemVer;
an established 1.x-or-later line requires a new major. Review unpublished/0.x
versioning against actual history rather than inventing a baseline.

The [six packages](../bin/public-packages.cjs) share one release version, in
models, database, metrics, wrapper, CLI, construct dependency order. Public
CommonJS exports, deep imports, declarations and CLI command contracts remain.
Node types use major 24; CLI bundles target Node 24. SDK clients are 3.1143.0,
SDK types 3.974.6, oclif core/help/plugins 5.1.2/7.0.2/7.0.3 and sitemap 9.0.1.
The former Node 18 SDK/XML overrides are removed.

## Deployment and security review

The construct's Lambda defaults remain Node 20, and handler bundles target
Node 20. This is separate from the Node 24 minimum for installing the public
construct. Packed fixtures explicitly request Node 24 for all three functions;
local synthesis is not cloud deployment certification. Changing deployment
defaults requires its own reviewed migration.

Run `SITEMAPS_AUDIT_PACKAGES=1 pnpm run test:packages` on freshly built archives
and record the audit date, actual production graph size and results in the
release plan. SDK 3.1143.0 removes the former fast-xml-parser dependency and its
obsolete publication hold. The [dependency guide](DEPENDENCY-MODERNIZATION.md)
records independent workspace-tooling findings. A passing production audit is
a current registry observation, not a guarantee against future advisories.
The final release checkout's October 7, 2026 UTC six-tarball consumer audit has
zero advisories across 122 production dependencies and no fast-xml-parser.
Workspace tooling separately reports 2 high, 1 moderate and 1 low advisory.

Owners must independently verify/bootstrap each public npm package and its
trusted publisher. Code and dry runs do not establish those account settings.
See the [release guide](RELEASING.md) for exact package order, validation,
immutable publication, partial recovery and explicit authorization.
