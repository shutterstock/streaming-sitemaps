# CLI guide

Read the [root](../../AGENTS.md) and [package](../AGENTS.md) guides first.
[src/commands](src/commands) implements oclif commands;
[bin/bundle.mjs](bin/bundle.mjs) uses a directly declared esbuild dependency.
Keep command names, flags, defaults, output, and Node >=18 support compatible.

`pnpm run build:all` builds dependencies and the CLI. `build:cli` cleans CLI dist,
emits declarations with tsc, and bundles commands and internal helpers with
esbuild. oclif core/help/plugins stay external and are direct runtime dependencies.
The private utilities package is a development input bundled into the CLI.
The public wrapper dependency is retained for emitted helper declarations.

Root tests first emit unbundled commands into dist so AWS mocks share the real
SDK module instances. A bundled SDK cannot be intercepted by those mocks.
Run `pnpm run build:cli` after tests before inspecting or packing the distribution.

Readable XML inputs live in [test/data](test/data) and
[test/commands/convert/data](test/commands/convert/data). They are explicitly
allowed by the root .gitignore; command outputs remain ignored. The root test
script regenerates deterministic gzip inputs from these XML files. Keep fixtures
present on clean checkouts: missing streams can make download tests hang.

Use root `pnpm run test --runTestsByPath <test-path>` to retain shared environment,
dynalite, fixture preparation, and CLI compilation. Do not run placeholder test
scripts in sibling libraries. Preserve checked-in snapshots when maintenance
does not change behavior.

`pnpm --dir packages/sitemaps-cli pack` runs existing oclif manifest/README
hooks and rewrites workspace ranges. Verify bin/run.js, dist/index.js,
dist/index.d.ts, command bundles, and oclif.manifest.json in the tarball.
The postpack hook removes the local generated manifest. Review README drift;
packing must not alter dependency files. Publication is a separate explicitly
requested action and is never needed for a packaging check.
