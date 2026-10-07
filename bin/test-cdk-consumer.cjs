#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pnpm = process.env.npm_execpath;
assert.ok(
  pnpm && /pnpm(?:-native|\.(?:cjs|mjs|js))$/.test(pnpm),
  'Run with pnpm run test:cdk-consumer',
);
const archive = process.argv[2] && path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] || path.join(root, '.validation/cdk-consumer'));
assert.ok(
  archive && fs.statSync(archive).isFile(),
  'Usage: pnpm run test:cdk-consumer /absolute/path/to/freshly-packed-sitemaps-cdk.tgz [artifact-directory]',
);
assert.equal(process.versions.node.split('.')[0], '24', 'Use the repository Node 24 toolchain');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rootManifest = readJson(path.join(root, 'package.json'));
const constructManifest = readJson(path.join(root, 'packages/sitemaps-cdk/package.json'));
const expected = {};
for (const name of [
  'kinesis-sitemap-writer',
  'kinesis-index-writer',
  'kinesis-sitemap-freshener',
]) {
  const file = path.join(root, 'packages/sitemaps-cdk/lib', name, 'index.js');
  assert.ok(fs.existsSync(file), `Build the construct before packing: missing ${file}`);
  expected[name] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-cdk-consumer-'));
const realTemporary = fs.realpathSync(temporary);
assert.ok(
  !realTemporary.startsWith(`${fs.realpathSync(root)}${path.sep}`) &&
    !realTemporary
      .split(path.sep)
      .some((part) => ['node_modules', '.pnpm', 'store'].includes(part)),
  'Consumer installation must be outside the workspace and cached dependency trees',
);
const consumer = path.join(temporary, 'app');
fs.mkdirSync(consumer);
fs.mkdirSync(output, { recursive: true });
// Do not leave a previous assembly in a new failure's diagnostic artifact.
fs.rmSync(path.join(output, 'cdk.out'), { recursive: true, force: true });
fs.rmSync(path.join(output, 'typescript-files.txt'), { force: true });
const logFile = path.join(output, 'verification.log');
fs.writeFileSync(logFile, '');
const env = {
  ...process.env,
  NODE_PATH: '',
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
  AWS_EC2_METADATA_DISABLED: 'true',
  CONSUMER_PACKAGE_VERSION: constructManifest.version,
};
for (const key of [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
])
  delete env[key];
function run(command, args) {
  console.log(`[cdk-consumer] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: consumer,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const text = (result.stdout || '') + (result.stderr || '');
  fs.appendFileSync(logFile, `$ ${command} ${args.join(' ')}\n${text}\n`);
  if (result.error || result.status !== 0) {
    process.stderr.write(text);
    throw new Error(`Consumer command failed (${result.status}): ${command}; see ${logFile}`, {
      cause: result.error,
    });
  }
  return result.stdout;
}
function runPnpm(args) {
  // Corepack's default outside the workspace can differ from our package pin.
  return pnpm.endsWith('-native')
    ? run(pnpm, args)
    : run(process.execPath, [pnpm, ...args]);
}
try {
  assert.equal(
    runPnpm(['--version']).trim(),
    rootManifest.packageManager.replace('pnpm@', ''),
    'Use the pinned repository pnpm version',
  );
  fs.cpSync(path.join(root, 'fixtures/cdk-consumer'), consumer, { recursive: true });
  fs.copyFileSync(archive, path.join(consumer, 'construct.tgz'));
  fs.writeFileSync(path.join(consumer, 'expected-bundles.json'), JSON.stringify(expected));
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'sitemaps-cdk-package-consumer',
        private: true,
        packageManager: rootManifest.packageManager,
        dependencies: {
          '@shutterstock/sitemaps-cdk': 'file:./construct.tgz',
          'aws-cdk-lib': constructManifest.devDependencies['aws-cdk-lib'],
          constructs: constructManifest.devDependencies.constructs,
        },
        devDependencies: {
          typescript: rootManifest.devDependencies.typescript,
          '@types/node': readJson(require.resolve('@types/node/package.json')).version,
        },
      },
      null,
      2,
    ),
  );
  // Policy comes from the root; this is a disposable install, not another owned toolchain/lockfile.
  const releaseAge = fs
    .readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
    .match(/^minimumReleaseAge:\s*(\d+)\s*$/m);
  assert.ok(releaseAge, 'Missing root minimum release age policy');
  // A private temporary store/cache and copied package files cannot mutate the restored workspace tree.
  // --ignore-workspace also ignores YAML policy; pass the inherited age explicitly.
  runPnpm([
    'install',
    '--ignore-workspace',
    '--ignore-scripts',
    '--prod=false',
    '--lockfile=false',
    '--strict-peer-dependencies',
    '--config.verify-deps-before-run=false',
    `--config.minimum-release-age=${releaseAge[1]}`,
    '--config.node-linker=isolated',
    '--config.package-import-method=copy',
    '--store-dir',
    path.join(temporary, 'store'),
    '--config.cache-dir',
    path.join(temporary, 'cache'),
    '--state-dir',
    path.join(temporary, 'state'),
  ]);
  const compiler = path.join(consumer, 'node_modules/typescript/bin/tsc');
  const files = run(process.execPath, [compiler, '--project', 'tsconfig.json', '--listFiles']);
  fs.writeFileSync(path.join(output, 'typescript-files.txt'), files);
  for (const file of files.trim().split('\n')) {
    const realFile = fs.realpathSync(file.trim());
    assert.ok(
      realFile.startsWith(`${fs.realpathSync(consumer)}${path.sep}`),
      `TypeScript resolved a file outside the isolated consumer: ${realFile}`,
    );
  }
  const result = run(process.execPath, ['dist/verify.js']);
  process.stdout.write(result);
} finally {
  if (fs.existsSync(path.join(consumer, 'cdk.out'))) {
    const assemblyOutput = path.join(output, 'cdk.out');
    fs.rmSync(assemblyOutput, { recursive: true, force: true });
    fs.cpSync(path.join(consumer, 'cdk.out'), assemblyOutput, { recursive: true });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log(`[cdk-consumer] Diagnostics and local assembly: ${output}`);
}
