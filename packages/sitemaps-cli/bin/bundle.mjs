#!/usr/bin/env node
const { build } = await import('esbuild');

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
  plugins: [],
  // splitting: true,
  treeShaking: true,
  minify: true,
};

await build(buildOptions);
