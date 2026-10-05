#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const directories = [
  '.',
  ...fs
    .readdirSync('packages', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join('packages', entry.name)),
];
const mode = process.argv[2];
for (const directory of directories) {
  if (!['--modules-only', '--tsbuildinfo'].includes(mode)) {
    // packages/cdk/lib contains stack source, not generated output.
    const outputs = ['dist', 'cdk.out'];
    if (directory === path.join('packages', 'sitemaps-cdk')) outputs.push('lib');
    for (const output of outputs) {
      fs.rmSync(path.join(directory, output), { recursive: true, force: true });
    }
  }
  if (!['--modules-only', '--outputs'].includes(mode)) {
    for (const entry of fs.readdirSync(directory)) {
      if (entry.endsWith('.tsbuildinfo')) fs.rmSync(path.join(directory, entry));
    }
  }
  if (['--modules', '--modules-only'].includes(mode)) {
    fs.rmSync(path.join(directory, 'node_modules'), { recursive: true, force: true });
  }
}
if (!['--modules-only', '--tsbuildinfo'].includes(mode)) {
  // docs/assets is maintained source. Only the staged API page is generated.
  fs.rmSync('docs/index.html', { force: true });
}
