const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  parseVersion,
  parseTag,
  compare,
  run,
  publicManifests,
  validateRelease,
  publicationDecision,
  stableVersion,
  publishPackages,
  integrity,
  publisherGuard,
  publicationRecord,
  validatePublicationRecord,
  docsProvenance,
  registryState,
} = require('./release-lib.cjs');
const { readPlan, docsSelection } = require('./release.cjs');
const packages = require('./public-packages.cjs');

test('registry reads use only fixed public-package URLs and reject arbitrary file data', async () => {
  const original = global.fetch;
  const requests = [];
  let expectedName;
  global.fetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ name: expectedName }) };
  };
  try {
    for (const name of packages) {
      expectedName = `@shutterstock/${name}`;
      assert.equal((await registryState(expectedName)).name, expectedName);
      assert.equal(
        requests.at(-1),
        `https://registry.npmjs.org/${encodeURIComponent(expectedName)}`,
      );
    }
    for (const invalid of [
      '@shutterstock/sitemaps-utils-lib',
      '@shutterstock/sitemaps-cli?token=private-file-data',
      '@shutterstock/sitemaps-cli/../../other',
      'https://attacker.invalid/',
      '',
      undefined,
    ])
      await assert.rejects(registryState(invalid), /known public package/);
    assert.equal(requests.length, packages.length);
    global.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(registryState(expectedName), /HTTP 404/);
    global.fetch = async () => ({ ok: true, json: async () => ({ name: 'other' }) });
    await assert.rejects(registryState(expectedName), /different package/);
  } finally {
    global.fetch = original;
  }
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-release-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cwd = path.join(directory, 'checkout');
  const remote = path.join(directory, 'remote.git');
  fs.mkdirSync(cwd);
  run('git', ['init', '--bare', remote]);
  const git = (...args) => run('git', args, cwd);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"private":true,"version":"0.0.0"}\n');
  for (const name of packages) {
    fs.mkdirSync(path.join(cwd, 'packages', name), { recursive: true });
    const source = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'packages', name, 'package.json')),
    );
    fs.writeFileSync(
      path.join(cwd, 'packages', name, 'package.json'),
      JSON.stringify({ ...source, version: '0.0.0' }),
    );
  }
  fs.writeFileSync(path.join(cwd, 'packages', 'sitemaps-cli', 'README.md'), 'source CLI guide');
  fs.writeFileSync(path.join(cwd, 'packages', 'sitemaps-cdk', 'API.md'), 'source API guide');
  git('add', '.');
  git('commit', '-m', 'source');
  git('tag', '-a', 'v1.2.3', '-m', 'stable');
  git('tag', 'v1.3.0-rc.1');
  git('push', 'origin', 'main', '--tags');
  const commit = git('rev-parse', 'HEAD');
  const release = {
    id: 12,
    tag_name: 'v1.2.3',
    target_commitish: 'main',
    draft: false,
    prerelease: false,
    published_at: '2026-10-05T00:00:00Z',
  };
  return {
    cwd,
    git,
    commit,
    release,
    options: {
      cwd,
      tag: 'v1.2.3',
      release,
      eventName: 'release',
      event: { release },
      ref: 'refs/tags/v1.2.3',
      sha: commit,
    },
  };
}

test('explicit SemVer/tag parsing and channel comparison reject ambiguous versions', () => {
  for (const valid of ['1.2.3', '0.0.0-pr9', '2.0.0-rc.1', '1.0.0-beta-test'])
    assert.equal(parseVersion(valid).version, valid);
  for (const invalid of [
    'v1.2.3',
    '1.2',
    '01.2.3',
    '1.2.3-01',
    '1.2.3+build',
    '1.2.3\n',
    'release/v1.2.3',
    '../../1.2.3',
    'from-git',
    '1.2.3-',
    '9007199254740992.0.0',
    `1.2.3-${'x'.repeat(256)}`,
  ])
    assert.throws(() => parseVersion(invalid));
  assert.equal(parseTag('v1.2.3-rc.1').version, '1.2.3-rc.1');
  for (const invalid of ['release/v1.2.3', '1.2.3', 'v1.2.3/evil'])
    assert.throws(() => parseTag(invalid));
  for (const [a, b] of [
    ['1.2.4', '1.2.3'],
    ['2.0.0', '1.99.99'],
    ['1.0.0', '1.0.0-rc.9'],
    ['1.0.0-rc.10', '1.0.0-rc.2'],
    ['1.0.0-beta', '1.0.0-9'],
    ['1.0.0-rc.1', '1.0.0-rc'],
  ]) {
    assert.equal(compare(a, b), 1);
    assert.equal(compare(b, a), -1);
  }
  assert.equal(compare('1.0.0-rc.1', '1.0.0-rc.1'), 0);
});

test('published stable/prerelease and manual provenance accept explicit main ancestors', (t) => {
  const { options, commit, release } = fixture(t);
  assert.equal(validateRelease(options).commit, commit);
  assert.equal(
    validateRelease({ ...options, release: { ...release, target_commitish: commit } }).channel,
    'latest',
  );
  assert.equal(
    validateRelease({
      ...options,
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/main',
      event: { inputs: { tag: options.tag } },
    }).version,
    '1.2.3',
  );
  const pre = { ...release, tag_name: 'v1.3.0-rc.1', prerelease: true };
  assert.equal(
    validateRelease({
      ...options,
      tag: pre.tag_name,
      release: pre,
      event: { release: pre },
      ref: `refs/tags/${pre.tag_name}`,
    }).channel,
    'next',
  );
});

test('release guards reject draft, changed release/event, target, SHA, source and unlisted public packages', (t) => {
  const { options, cwd } = fixture(t);
  for (const releasePatch of [
    { draft: true },
    { published_at: null },
    { prerelease: true },
    { tag_name: 'v8.8.8' },
    { target_commitish: 'releases/1.2' },
  ])
    assert.throws(() =>
      validateRelease({ ...options, release: { ...options.release, ...releasePatch } }),
    );
  for (const patch of [
    { sha: 'a'.repeat(40) },
    { ref: 'refs/heads/main' },
    { event: { release: { ...options.release, id: 13 } } },
    { eventName: 'push' },
  ])
    assert.throws(() => validateRelease({ ...options, ...patch }));
  assert.throws(() =>
    validateRelease({
      ...options,
      eventName: 'workflow_dispatch',
      event: { inputs: { tag: options.tag } },
      ref: 'refs/heads/feature',
    }),
  );
  assert.throws(() =>
    validateRelease({
      ...options,
      eventName: 'workflow_dispatch',
      event: { inputs: { tag: 'v9.9.9' } },
      ref: 'refs/heads/main',
    }),
  );
  const file = path.join(cwd, 'packages', packages[0], 'package.json');
  const source = fs.readFileSync(file);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(source), version: '1.2.3' }));
  assert.throws(() => validateRelease(options), /source\/version|differs from/);
  fs.writeFileSync(file, source);
  fs.mkdirSync(path.join(cwd, 'packages', 'rogue'));
  fs.writeFileSync(path.join(cwd, 'packages', 'rogue', 'package.json'), '{"name":"rogue"}');
  assert.throws(() => publicManifests(cwd), /Unlisted public/);
});

test('remote annotated object rewrites, wrong HEAD, stale dispatch and non-main ancestry fail', (t) => {
  const { options, git, cwd } = fixture(t);
  // An annotated tag rewritten to the same commit is still a different tag.
  git('tag', '-f', '-a', 'v1.2.3', '-m', 'changed annotation');
  assert.throws(() => validateRelease(options), /Remote release tag/);
  git('fetch', 'origin', 'refs/tags/v1.2.3:refs/tags/v1.2.3', '--force');
  fs.writeFileSync(path.join(cwd, 'new-file'), 'new');
  git('add', '.');
  git('commit', '-m', 'later');
  assert.throws(() => validateRelease(options), /Checkout/);
  git('push', 'origin', 'main');
  git('checkout', options.sha);
  assert.throws(
    () =>
      validateRelease({
        ...options,
        eventName: 'workflow_dispatch',
        ref: 'refs/heads/main',
        event: { inputs: { tag: options.tag } },
      }),
    /no longer current/,
  );
  git('checkout', '--orphan', 'unrelated');
  git('commit', '--allow-empty', '-m', 'unrelated');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', options.sha);
  assert.throws(() => validateRelease(options), /git failed/);
  fs.writeFileSync(path.join(cwd, '.git', 'shallow'), options.sha + '\n');
  assert.throws(() => validateRelease(options), /Full Git history/);
});

test('selection validates tagged manifests from reviewed main without executing the requested ref', (t) => {
  const { options, cwd, git } = fixture(t);
  const file = path.join(cwd, 'packages', packages[0], 'package.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), version: '9.9.9' }),
  );
  fs.writeFileSync(path.join(cwd, 'packages', 'AGENTS.md'), 'guide');
  fs.mkdirSync(path.join(cwd, 'packages', 'non-package'));
  fs.writeFileSync(path.join(cwd, 'packages', 'non-package', 'guide.md'), 'guide');
  git('add', '.');
  git('commit', '-m', 'later main metadata');
  git('push', 'origin', 'main');
  assert.equal(validateRelease({ ...options, requireHead: false }).version, '1.2.3');
  assert.throws(() => validateRelease(options), /Checkout/);
});

test('injected provenance permits only versions and known generated docs, never dependency or script edits', (t) => {
  const { options, cwd, git } = fixture(t);
  for (const name of packages) {
    const file = path.join(cwd, 'packages', name, 'package.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), version: '1.2.3' }),
    );
  }
  assert.equal(validateRelease({ ...options, injected: true }).version, '1.2.3');
  fs.writeFileSync(path.join(cwd, 'packages', 'sitemaps-cli', 'README.md'), 'generated CLI guide');
  assert.equal(validateRelease({ ...options, injected: true }).version, '1.2.3');
  fs.writeFileSync(path.join(cwd, 'packages', 'sitemaps-cdk', 'API.md'), 'generated API guide');
  assert.throws(() => validateRelease({ ...options, injected: true }), /differs from/);
  assert.equal(
    validateRelease({ ...options, injected: true, generatedDocs: true }).version,
    '1.2.3',
  );
  git('restore', 'packages/sitemaps-cdk/API.md');
  const file = path.join(cwd, 'packages', packages[0], 'package.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), scripts: { install: 'unexpected' } }),
  );
  assert.throws(() => validateRelease({ ...options, injected: true }), /Only explicit version/);
  git('restore', file);
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(file)),
      version: '1.2.3',
      dependencies: { malicious: '1.0.0' },
    }),
  );
  assert.throws(() => validateRelease({ ...options, injected: true }), /Only explicit version/);
});

function state(version = '1.2.2', channel = 'latest', hash = 'sha512-current') {
  return {
    'dist-tags': { [channel]: version },
    versions: { [version]: { dist: { integrity: hash } } },
  };
}

test('immutable recovery and stable/next channels fail closed on mismatched or superseded state', () => {
  assert.deepEqual(publicationDecision('1.2.3', state(), 'sha512-new'), {
    action: 'publish',
    channel: 'latest',
  });
  assert.deepEqual(publicationDecision('1.3.0-rc.1', state(), 'sha512-new'), {
    action: 'publish',
    channel: 'next',
  });
  assert.equal(publicationDecision('1.2.3', state('1.2.3'), 'sha512-current').action, 'skip');
  assert.throws(() => publicationDecision('1.2.3', state('1.2.3'), 'sha512-other'), /integrity/);
  assert.throws(
    () =>
      publicationDecision(
        '1.2.3',
        { ...state('1.2.3'), 'dist-tags': { latest: '1.2.2' } },
        'sha512-current',
      ),
    /channel/,
  );
  assert.throws(() => publicationDecision('1.2.3', state('1.2.4'), 'sha512-new'), /superseded/);
  assert.throws(
    () => publicationDecision('1.3.0-rc.1', state('1.3.0-rc.2', 'next'), 'sha512-new'),
    /backwards/,
  );
  assert.throws(
    () => publicationDecision('1.2.3', state('1.2.3-rc.1'), 'sha512-new'),
    /must be stable/,
  );
  assert.throws(() => publicationDecision('1.2.3', {}, 'sha512-new'), /Incomplete/);
});

test('partial publication stops at failure and recovery skips only identical visible versions', async () => {
  const entries = packages.map((name) => ({ name, integrity: `sha512-${name}` }));
  const states = new Map(entries.map((entry) => [entry.name, state()]));
  const writes = [];
  let fail = true;
  let verifies = 0;
  const options = {
    entries,
    version: '1.2.3',
    readState: async (name) => states.get(name),
    verify: async () => {
      verifies++;
    },
    publish: async (entry, channel) => {
      writes.push(entry.name);
      if (fail && entry.name === packages[2]) throw new Error('OIDC rejected');
      states.set(entry.name, state('1.2.3', channel, entry.integrity));
    },
  };
  await assert.rejects(publishPackages(options), /OIDC rejected/);
  assert.deepEqual(writes, packages.slice(0, 3));
  fail = false;
  writes.length = 0;
  await publishPackages(options);
  assert.deepEqual(writes, packages.slice(2));
  assert.equal(verifies, 9);
  writes.length = 0;
  await publishPackages(options);
  assert.deepEqual(writes, []);
});

test('registry outages, mismatch anywhere, provenance changes and invisible writes prevent further publication', async () => {
  const entries = packages.map((name) => ({ name, integrity: 'sha512-new' }));
  let writes = 0;
  const base = {
    entries,
    version: '1.2.3',
    verify: async () => {},
    readState: async () => state(),
    publish: async () => {
      writes++;
    },
    attempts: 1,
  };
  await assert.rejects(
    publishPackages({
      ...base,
      readState: async () => {
        throw new Error('registry offline');
      },
    }),
    /offline/,
  );
  await assert.rejects(
    publishPackages({
      ...base,
      readState: async (name) => (name === packages[5] ? state('1.2.3') : state()),
    }),
    /integrity/,
  );
  await assert.rejects(
    publishPackages({
      ...base,
      verify: async () => {
        throw new Error('tag changed');
      },
    }),
    /tag changed/,
  );
  assert.equal(writes, 0);
  await assert.rejects(publishPackages(base), /not visible/);
  assert.equal(writes, 1);
});

test('docs require agreement of every stable published package', () => {
  assert.equal(stableVersion(packages.map(() => state('1.2.3'))), '1.2.3');
  assert.throws(
    () => stableVersion([...packages.slice(1).map(() => state('1.2.3')), state('1.2.2')]),
    /must agree/,
  );
  assert.throws(() => stableVersion(packages.map(() => state('1.2.3-rc.1'))), /stable/);
  assert.throws(
    () => stableVersion(packages.map(() => ({ 'dist-tags': { latest: '1.2.3' }, versions: {} }))),
    /not fully published/,
  );
});

test('OIDC requirements and the reviewed publication hold cannot fall back to tokens', () => {
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test',
  };
  const options = {
    policy: { publicationBlocked: false },
    nodeVersion: '24.21.0',
    npmVersion: '11.5.1',
    env,
  };
  assert.doesNotThrow(() => publisherGuard(options));
  for (const patch of [
    { policy: {} },
    { policy: { publicationBlocked: true, reason: 'consumer SDK' } },
    { nodeVersion: '22.14.0' },
    { npmVersion: '11.5.0' },
    { env: {} },
    { env: { ...env, NPM_TOKEN: 'fallback' } },
    { env: { ...env, NODE_AUTH_TOKEN: 'fallback' } },
    { env: { ...env, NPM_CONFIG_PROVENANCE: 'false' } },
  ])
    assert.throws(() => publisherGuard({ ...options, ...patch }));
});

test('docs gating accepts verified publication runs and rejects direct manual dispatch', () => {
  const release = { version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40), channel: 'latest' };
  const entries = packages.map((name) => ({
    name: `@shutterstock/${name}`,
    integrity: integrity(Buffer.from(name)),
  }));
  const publication = publicationRecord(release, entries, {
    GITHUB_RUN_ID: '17',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_SHA: release.commit,
  });
  const workflow = {
    id: 17,
    conclusion: 'success',
    head_sha: release.commit,
    head_repository: { full_name: 'shutterstock/streaming-sitemaps' },
  };
  const options = {
    release,
    eventName: 'workflow_run',
    event: { workflow_run: workflow },
    actualRun: { ...workflow, path: '.github/workflows/publish.yml', event: 'release' },
    publication,
    states: entries.map((entry) => state(release.version, 'latest', entry.integrity)),
  };
  options.actualRun.run_attempt = 2;
  assert.equal(docsProvenance(options), true);
  for (const patch of [
    { actualRun: { ...options.actualRun, path: '.github/workflows/ci.yml' } },
    { actualRun: { ...options.actualRun, event: 'pull_request' } },
    { actualRun: { ...options.actualRun, conclusion: 'failure' } },
    { event: { workflow_run: { ...workflow, head_repository: { full_name: 'fork/repo' } } } },
    { finalVersion: '1.2.2', head: release.commit },
    { finalVersion: release.version, head: 'wrong' },
    { publication: undefined },
    { publication: { ...publication, runId: '18' } },
    { publication: { ...publication, runAttempt: '1' } },
    { publication: { ...publication, workflowSha: 'b'.repeat(40) } },
    { publication: { ...publication, commit: 'b'.repeat(40) } },
    {
      states: entries.map(() =>
        state(release.version, 'latest', integrity(Buffer.from('different source'))),
      ),
    },
  ])
    assert.throws(() => docsProvenance({ ...options, ...patch }));
  assert.equal(
    docsProvenance({
      ...options,
      release: { ...release, version: '1.2.4', tag: 'v1.2.4', commit: 'b'.repeat(40) },
    }),
    false,
  );
  // Manual publication runs use main's source SHA while building an older tag.
  const sourceSha = 'b'.repeat(40);
  const recovered = {
    ...options,
    event: { workflow_run: { ...workflow, head_sha: sourceSha } },
    actualRun: { ...options.actualRun, event: 'workflow_dispatch', head_sha: sourceSha },
    publication: { ...publication, workflowSha: sourceSha },
    head: release.commit,
    finalVersion: release.version,
  };
  assert.equal(docsProvenance(recovered), true);
  assert.throws(
    () =>
      docsProvenance({
        ...recovered,
        publication: { ...recovered.publication, commit: sourceSha },
      }),
    /verified stable release/,
  );
  assert.throws(
    () => docsProvenance({ ...recovered, actualRun: { ...recovered.actualRun, id: 18 } }),
    /workflow provenance/,
  );
  const manual = {
    release,
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/main',
    event: { inputs: { tag: release.tag } },
    sha: 'main',
    remoteMain: 'main',
  };
  assert.throws(() => docsProvenance(manual), /Unsupported docs event/);
  for (const patch of [
    { ref: 'refs/tags/v1.2.3' },
    { sha: 'old-main' },
    { event: { inputs: { tag: 'v1.2.2' } } },
    { eventName: 'release' },
  ])
    assert.throws(() => docsProvenance({ ...manual, ...patch }));
});

test('publication receipts bind exact run attempt, source, version/channel and immutable package set', () => {
  const release = { version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40), channel: 'latest' };
  const entries = packages.map((name) => ({
    name: `@shutterstock/${name}`,
    integrity: integrity(Buffer.from(name)),
  }));
  const record = publicationRecord(release, entries, {
    GITHUB_RUN_ID: '17',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_SHA: 'b'.repeat(40),
  });
  const run = { id: 17, run_attempt: 2, head_sha: 'b'.repeat(40) };
  assert.doesNotThrow(() => validatePublicationRecord(record, run));
  for (const patch of [
    { schema: 2 },
    { repository: 'fork/repo' },
    { tag: 'v1.2.4' },
    { channel: 'next' },
    { entries: entries.toReversed() },
    { entries: entries.slice(1) },
    { entries: entries.map((entry) => ({ ...entry, integrity: 'sha512-missing' })) },
  ])
    assert.throws(() => validatePublicationRecord({ ...record, ...patch }, run));
  const pre = publicationRecord(
    { ...release, version: '1.3.0-rc.1', tag: 'v1.3.0-rc.1', channel: 'next' },
    entries,
    { GITHUB_RUN_ID: '17', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: release.commit },
  );
  const workflow = {
    id: 17,
    head_sha: release.commit,
    conclusion: 'success',
    head_repository: { full_name: 'shutterstock/streaming-sitemaps' },
  };
  assert.equal(
    docsProvenance({
      eventName: 'workflow_run',
      event: { workflow_run: workflow },
      actualRun: {
        ...workflow,
        event: 'release',
        path: '.github/workflows/publish.yml',
        run_attempt: 2,
      },
      publication: pre,
      release,
    }),
    false,
  );
});

test('docs selection downloads this attempt receipt and selects the tag after manual recovery from newer main', async (t) => {
  const { cwd, commit, release, git } = fixture(t);
  fs.writeFileSync(path.join(cwd, 'later-main'), 'advanced main');
  git('add', '.');
  git('commit', '-m', 'advance main');
  git('push', 'origin', 'main');
  const main = git('rev-parse', 'HEAD');
  assert.notEqual(main, commit);
  const stable = { version: '1.2.3', tag: 'v1.2.3', commit, channel: 'latest' };
  const entries = packages.map((name) => ({
    name: `@shutterstock/${name}`,
    integrity: integrity(Buffer.from(name)),
  }));
  const receipt = publicationRecord(stable, entries, {
    GITHUB_RUN_ID: '17',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_SHA: main,
  });
  const actual = {
    id: 17,
    run_attempt: 2,
    path: '.github/workflows/publish.yml',
    event: 'workflow_dispatch',
    head_sha: main,
    conclusion: 'success',
    head_repository: { full_name: 'shutterstock/streaming-sitemaps' },
  };
  const files = {
    'release.json': release,
    'run.json': actual,
    'receipt.json': receipt,
    'event.json': { workflow_run: actual },
  };
  for (const [name, data] of Object.entries(files))
    fs.writeFileSync(path.join(cwd, name), JSON.stringify(data));
  const tools = path.join(cwd, 'fake-tools');
  fs.mkdirSync(tools);
  const fakeGh = `#!${process.execPath}\nconst fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2);\nif (args[0] === 'api') { const file = args[1].includes('/releases/tags/') ? 'release.json' : 'run.json'; process.stdout.write(fs.readFileSync(file)); }\nelse if (args[0] === 'run' && args[1] === 'download') { if (JSON.stringify(args.slice(0,8)) !== JSON.stringify(['run','download','17','--repo','shutterstock/streaming-sitemaps','--name','publication-2','--dir'])) throw Error('Wrong artifact run/attempt'); fs.copyFileSync('receipt.json',path.join(args[8],'publication.json')); }\nelse throw Error('Unexpected gh command');\n`;
  fs.writeFileSync(path.join(tools, 'gh'), fakeGh, { mode: 0o755 });
  const beforeCwd = process.cwd();
  const beforeEnv = { ...process.env };
  const beforeFetch = global.fetch;
  try {
    process.chdir(cwd);
    Object.assign(process.env, {
      PATH: `${tools}${path.delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: 'shutterstock/streaming-sitemaps',
      GITHUB_WORKFLOW_REF:
        'shutterstock/streaming-sitemaps/.github/workflows/docs.yml@refs/heads/main',
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_EVENT_PATH: path.join(cwd, 'event.json'),
      GITHUB_SHA: main,
      GITHUB_OUTPUT: path.join(cwd, 'output'),
    });
    global.fetch = async (url) => {
      const name = decodeURIComponent(new URL(url).pathname.slice(1));
      const entry = entries.find((entry) => entry.name === name);
      assert(entry, 'Unexpected registry request');
      return {
        ok: true,
        json: async () => ({ name, ...state(stable.version, 'latest', entry.integrity) }),
      };
    };
    await docsSelection();
    const result = fs.readFileSync(process.env.GITHUB_OUTPUT, 'utf8');
    assert(result.includes('publish=true\n'));
    assert(result.includes(`commit=${commit}\n`));
    assert(!result.includes(`commit=${main}\n`));
    for (const patch of [
      { runAttempt: '1' },
      { commit: main },
      {
        entries: entries.map((entry) => ({
          ...entry,
          integrity: integrity(Buffer.from('tampered')),
        })),
      },
    ]) {
      fs.writeFileSync(path.join(cwd, 'receipt.json'), JSON.stringify({ ...receipt, ...patch }));
      await assert.rejects(docsSelection());
    }
    fs.rmSync(path.join(cwd, 'receipt.json'));
    await assert.rejects(docsSelection(), /gh failed/);
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    global.fetch = async () => assert.fail('Rejected dispatch must not contact the registry');
    await assert.rejects(docsSelection(), /Unsupported docs event/);
  } finally {
    global.fetch = beforeFetch;
    process.chdir(beforeCwd);
    for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
    Object.assign(process.env, beforeEnv);
  }
});

test('archive plan enforces version, commit, exact package order and bytes', (t) => {
  const { cwd, commit } = fixture(t);
  const directory = path.join(cwd, 'archives');
  fs.mkdirSync(directory);
  const entries = packages.map((name) => {
    const filename = `shutterstock-${name}-0.0.0.tgz`;
    fs.writeFileSync(path.join(directory, filename), name);
    return { name: `@shutterstock/${name}`, filename, integrity: integrity(Buffer.from(name)) };
  });
  const plan = { version: '0.0.0', commit, entries };
  const save = (value) =>
    fs.writeFileSync(path.join(directory, 'plan.json'), JSON.stringify(value));
  const before = process.cwd();
  process.chdir(cwd);
  try {
    save(plan);
    assert.equal(readPlan(directory, plan).entries.length, 6);
    for (const invalid of [
      { ...plan, commit: 'bad' },
      { ...plan, version: '9.9.9' },
      { ...plan, entries: entries.toReversed() },
      { ...plan, entries: entries.slice(1) },
    ]) {
      save(invalid);
      assert.throws(() => readPlan(directory, plan), /plan/);
    }
    save(plan);
    fs.writeFileSync(path.join(directory, entries[0].filename), 'tampered');
    assert.throws(() => readPlan(directory, plan), /integrity/);
  } finally {
    process.chdir(before);
  }
});
