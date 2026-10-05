const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('normal cleanup preserves stack source and completed dependency trees', () => {
  const cwd = fs.mkdtempSync(path.join(__dirname, '.clean-fixture-'));
  try {
    const source = [
      'packages/cdk/lib/cdk-stack.ts',
      'packages/example/src/index.ts',
      'docs/assets/architecture.png',
    ];
    const dependencies = [
      'node_modules/helper/index.js',
      'packages/cdk/node_modules/helper/index.js',
    ];
    const outputs = [
      'dist/index.js',
      'packages/cdk/dist/index.js',
      'packages/sitemaps-cdk/lib/index.js',
      'packages/example/tsconfig.tsbuildinfo',
      'docs/index.html',
    ];
    for (const file of [...source, ...dependencies, ...outputs]) {
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), 'preserve these bytes');
    }
    const result = spawnSync(process.execPath, [path.join(__dirname, 'clean.cjs')], { cwd });
    assert.equal(result.status, 0, result.stderr.toString());
    for (const file of [...source, ...dependencies])
      assert.equal(fs.readFileSync(path.join(cwd, file), 'utf8'), 'preserve these bytes');
    for (const file of outputs) assert.equal(fs.existsSync(path.join(cwd, file)), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
