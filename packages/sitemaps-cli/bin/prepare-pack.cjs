const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function canonicalizeManifest(file = 'oclif.manifest.json') {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !manifest.commands ||
    typeof manifest.commands !== 'object' ||
    Array.isArray(manifest.commands)
  )
    throw new Error('Expected an oclif command manifest');
  // oclif discovers commands concurrently. Only command-map insertion order
  // varies; preserve command metadata, flag order and all arrays as generated.
  manifest.commands = Object.fromEntries(
    Object.entries(manifest.commands).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

module.exports = { canonicalizeManifest };
if (require.main === module) {
  // Source/development environments must not make the shipped manifest point
  // at TypeScript files that are absent from the archive.
  const executable = require.resolve('oclif/bin/run.js');
  const run = (command) => {
    const result = spawnSync(process.execPath, [executable, command], {
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0)
      throw new Error(`oclif ${command} failed: ${result.error?.message || result.status}`);
  };
  run('manifest');
  canonicalizeManifest();
  run('readme');
}
