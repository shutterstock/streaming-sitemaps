#!/usr/bin/env node
const { build } = await import('esbuild');
const fs = await import('node:fs/promises');
const path = await import('node:path');

// TypeScript's legacy resolver infers oclif's private lib/interfaces path.
// The root Interfaces namespace re-exports those identical types and works
// with both legacy and exports-aware consumer resolution. Keep command types
// precise; only their reference to the upstream public export changes.
async function publicDeclarationReferences(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await publicDeclarationReferences(file);
    else if (entry.name.endsWith('.d.ts')) {
      const original = await fs.readFile(file, 'utf8');
      const updated = original.replace(
        /import\(["']@oclif\/core\/(?:lib\/)?interfaces["']\)\./g,
        'import("@oclif/core").Interfaces.',
      );
      if (updated !== original) await fs.writeFile(file, updated);
    }
  }
}

/**
 * @type {import('esbuild').BuildOptions}
 */
const buildOptions = {
  bundle: true,
  entryPoints: ['./src/index.ts', './src/commands/**/*.ts'],
  external: ['@oclif/core', '@oclif/plugin-help', '@oclif/plugin-plugins'],
  format: 'cjs',
  loader: { '.node': 'copy' },
  outdir: './dist',
  platform: 'node',
  target: 'node24',
  plugins: [],
  // splitting: true,
  treeShaking: true,
  minify: true,
};

await build(buildOptions);
await publicDeclarationReferences('./dist');
