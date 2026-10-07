# Construct and Projen guide

Read the [root](../../AGENTS.md) and [package](../AGENTS.md) guides first.
[.projenrc.ts](.projenrc.ts) owns package.json, portable tsconfig.json, test/tsconfig.json, projenrc/tsconfig.json,
.gitignore, .npmignore, and metadata/tasks under .projen. Edit that source and
run `pnpm run synth:cdk` from the repository root using locally installed Projen
0.103.27. Bare npx may download a different Projen; do not use it here.

This construct belongs to the root isolated pnpm workspace. It compiles with
jsii and bundles sibling handler source with esbuild, so a standalone island
would lose required workspace inputs. Only the root pnpm-lock.yaml owns
resolution. Root pnpm-workspace.yaml owns installation policy; there is no nested lock or
workspace configuration. Generated nested GitHub workflows are disabled
because root workflows own repository CI/publication.

Synthesis runs without post-install hooks. Reconcile dependencies explicitly at
the root after changing devDeps, then verify frozen installation and repeat
synthesis to check for drift. The default task also suppresses dependency
installation when invoked inside a Projen build. CI consumers must not repair
their restored dependency trees.

The construct uses jsii/Rosetta 6, TypeScript 6.0.3, CDK 2.271, and Node 24
for local tooling. The public package minimum is Node >=24, explicitly approved
for this refresh. Ambient types
are narrowed to node for jsii and node/jest for tests; do not delete shared
type packages. The TypeScript Projen runner uses its dedicated projenrc config.
Lambda bundles target Node 20 syntax. Runtime defaults stay at NODEJS_20_X;
this deprecated Lambda runtime requires
an explicit operator migration. See the root dependency maintenance note.

`pnpm run build:cdk` runs compile and produces lib/index.js, declarations, .jsii,
and three `lib/kinesis-*/index.js` bundles/maps. Source-mode construct tests also
exercise CDK's local esbuild bundling against the root pnpm lock. Projen generates the portable tracked
tsconfig.json; jsii compiles it without replacing it with absolute paths.
lib/.types-compat and machine-specific paths must remain untracked. Root solution compilation excludes this generated config.

`pnpm run build:docs` regenerates the existing [API.md](API.md) and stages its
content in the root docs page. It does not imply a separate documentation source
tree. Verify `pnpm --dir packages/sitemaps-cdk pack` contains .jsii,
entry points, declarations, and all three handler bundles. AGENTS.md stays out
of the archive. Full multilingual Projen packaging needs additional toolchains;
ordinary foundation verification uses the JavaScript tarball.

Treat exports, construct props, generated declarations, resource defaults, and
fallback source bundling as compatibility contracts. Compile/pack verification
does not authorize synthesis/deployment of real AWS resources or publication.
