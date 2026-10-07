const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('version materialization changes only owned manifests, including with pnpm trees', () => {
  const cwd = fs.mkdtempSync(path.join(__dirname, '.version-fixture-'));
  try {
    const owned = ['package.json', 'packages/cli/package.json'];
    const dependencies = [
      'node_modules/.pnpm/helper@1.0.0/node_modules/helper/package.json',
      'packages/cli/node_modules/helper/package.json',
      'packages/cli/dist/package.json',
    ];
    for (const name of [...owned, ...dependencies]) {
      const file = path.join(cwd, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"version":"0.0.0"}\n');
    }
    const before = dependencies.map((file) => fs.readFileSync(path.join(cwd, file), 'utf8'));
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'version'), 'release/v1.2.3'],
      { cwd },
    );
    assert.equal(result.status, 0, result.stderr.toString());
    for (const file of owned)
      assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, file))).version, '1.2.3');
    assert.deepEqual(
      dependencies.map((file) => fs.readFileSync(path.join(cwd, file), 'utf8')),
      before,
    );
    for (const version of [
      'not-a-version',
      'other/v1.2.3',
      'refs/tags/v1.2.3',
      'from-git',
      '01.2.3',
      '1.2.3+build',
      '1.2.3-01',
    ]) {
      const invalid = spawnSync(process.execPath, [path.join(__dirname, 'version'), version], {
        cwd,
      });
      assert.notEqual(invalid.status, 0);
    }
    for (const file of owned)
      assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, file))).version, '1.2.3');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
