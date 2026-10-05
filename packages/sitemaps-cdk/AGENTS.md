# Construct and Projen guide

Read the [root](../../AGENTS.md) and [package](../AGENTS.md) guides first.
[.projenrc.ts](.projenrc.ts) owns package.json, tsconfig.dev.json, .npmrc,
.gitignore, .npmignore, and metadata/tasks under .projen. Edit that source and
run `pnpm run synth:cdk` from the repository root using locally installed Projen
0.81.6. Bare npx may download a different Projen; do not use it here.

This construct belongs to the root isolated pnpm workspace. It compiles with
jsii and bundles sibling handler source with esbuild, so a standalone island
would lose required workspace inputs. Only the root pnpm-lock.yaml owns
resolution. The generated local .npmrc keeps Projen's resolution policy; it does
not change the workspace linker. Generated nested GitHub workflows are disabled
because root workflows own repository CI/publication.

Synthesis runs without post-install hooks. Reconcile dependencies explicitly at
the root after changing devDeps, then verify frozen installation and repeat
synthesis to check for drift. The default task also suppresses dependency
installation when invoked inside a Projen build. CI consumers must not repair
their restored dependency trees.

The retained jsii 5.4/CDK 2.117 toolchain predates Node 24 and can emit support
warnings. Upgrade it in the dedicated construct maintenance change. Ambient
types are narrowed to node for jsii and node/jest for the development config;
do not delete parent node_modules types to make the older compiler succeed.
The root lock pins downlevel-dts's wildcard compiler dependency to a compatible
TypeScript compiler. Runtime engines and Lambda behavior remain unchanged.

`pnpm run build:cdk` runs compile and produces lib/index.js, declarations, .jsii,
and three `lib/kinesis-*/index.js` bundles/maps. Source-mode construct tests also
exercise CDK's local esbuild bundling against the root pnpm lock. jsii generates
tsconfig.json and lib/.types-compat; they must remain untracked, including any
machine-specific paths. Root solution compilation excludes this generated config.

`pnpm run build:docs` regenerates the existing [API.md](API.md) and stages its
content in the root docs page. It does not imply a separate documentation source
tree. Verify `pnpm --dir packages/sitemaps-cdk pack` contains .jsii,
entry points, declarations, and all three handler bundles. AGENTS.md stays out
of the archive. Full multilingual Projen packaging needs additional toolchains;
ordinary foundation verification uses the JavaScript tarball.

Treat exports, construct props, generated declarations, resource defaults, and
fallback source bundling as compatibility contracts. Compile/pack verification
does not authorize synthesis/deployment of real AWS resources or publication.
