// Dependency-free: provenance runs before the dependency-cache producer.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const packages = require('./public-packages.cjs');

const repository = 'shutterstock/streaming-sitemaps';
const registry = 'https://registry.npmjs.org';
// URLs come only from the source-controlled public package set. Manifest or
// archive-plan bytes can select an existing URL, never become request data.
const registryUrls = new Map(
  packages.map((name) => [
    `@shutterstock/${name}`,
    `${registry}/${encodeURIComponent(`@shutterstock/${name}`)}`,
  ]),
);
const integer = '(0|[1-9][0-9]*)';
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = new RegExp(
  `^${integer}\\.${integer}\\.${integer}(?:-(${identifier}(?:\\.${identifier})*))?$`,
);

function parseVersion(version) {
  const match = typeof version === 'string' && versionPattern.exec(version);
  if (
    !match ||
    match[0] !== version ||
    version.length > 256 ||
    match.slice(1, 4).some((value) => BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error(`Invalid explicit SemVer: ${version}`);
  return { version, numbers: match.slice(1, 4).map(BigInt), prerelease: match[4] || '' };
}

function parseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v'))
    throw new Error('Expected tag vX.Y.Z or vX.Y.Z-prerelease');
  return parseVersion(tag.slice(1));
}

function compare(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1;
  }
  if (!left.prerelease || !right.prerelease)
    return left.prerelease === right.prerelease ? 0 : left.prerelease ? -1 : 1;
  const l = left.prerelease.split('.');
  const r = right.prerelease.split('.');
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i] === r[i]) continue;
    if (l[i] === undefined || r[i] === undefined) return l[i] === undefined ? -1 : 1;
    const ln = /^\d+$/.test(l[i]);
    const rn = /^\d+$/.test(r[i]);
    if (ln && rn) return BigInt(l[i]) > BigInt(r[i]) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l[i] > r[i] ? 1 : -1;
  }
  return 0;
}

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message || result.stderr}`);
  return result.stdout.trim();
}

function publicManifests(cwd = process.cwd(), expected = '0.0.0', commit) {
  const read = (file) =>
    JSON.parse(
      commit
        ? run('git', ['show', `${commit}:${file}`], cwd)
        : fs.readFileSync(path.join(cwd, file)),
    );
  const result = packages.map((directory) => {
    const manifest = read(`packages/${directory}/package.json`);
    if (
      manifest.name !== `@shutterstock/${directory}` ||
      manifest.private ||
      manifest.version !== expected ||
      !['>=24.0.0', '>= 24.0.0'].includes(manifest.engines?.node)
    ) {
      throw new Error(
        `Unexpected public manifest: ${directory}; expected source/version ${expected} and Node >=24.0.0`,
      );
    }
    if (manifest.repository?.url !== `https://github.com/${repository}.git`)
      throw new Error(`Wrong repository URL: ${directory}`);
    return { directory, name: manifest.name };
  });
  const directories = commit
    ? run('git', ['ls-tree', '-d', '--name-only', `${commit}:packages`], cwd).split('\n')
    : fs
        .readdirSync(path.join(cwd, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
  for (const directory of directories) {
    const file = `packages/${directory}/package.json`;
    if (!commit && !fs.existsSync(path.join(cwd, file))) continue;
    if (
      commit &&
      !run('git', ['ls-tree', '--name-only', `${commit}:packages/${directory}`], cwd)
        .split('\n')
        .includes('package.json')
    )
      continue;
    const manifest = read(file);
    if (!packages.includes(directory) && manifest.private !== true)
      throw new Error(`Unlisted public package: ${directory}`);
  }
  if (read('package.json').private !== true) throw new Error('Root must remain private');
  return result;
}

function remoteTag(git, tag) {
  const ref = `refs/tags/${tag}`;
  const remote = new Map(
    git('ls-remote', '--exit-code', 'origin', ref, `${ref}^{}`)
      .split('\n')
      .map((line) => {
        const [oid, name] = line.split(/\s+/);
        return [name, oid];
      }),
  );
  const object = git('rev-parse', '--verify', ref);
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (remote.get(ref) !== object || (remote.get(`${ref}^{}`) || remote.get(ref)) !== commit)
    throw new Error('Remote release tag changed or is missing');
  return commit;
}

function validateRelease({
  tag,
  release,
  eventName,
  event,
  ref,
  sha,
  cwd = process.cwd(),
  injected = false,
  requireHead = true,
  generatedDocs = false,
}) {
  const version = parseTag(tag);
  if (
    !release ||
    release.draft ||
    !release.published_at ||
    release.tag_name !== tag ||
    typeof release.prerelease !== 'boolean'
  )
    throw new Error('Expected an existing published GitHub Release for the exact tag');
  if (release.prerelease !== Boolean(version.prerelease))
    throw new Error('GitHub prerelease flag disagrees with SemVer');
  const git = (...args) => run('git', args, cwd);
  if (git('rev-parse', '--is-shallow-repository') !== 'false')
    throw new Error('Full Git history required');
  const commit = remoteTag(git, tag);
  if (requireHead && git('rev-parse', 'HEAD') !== commit)
    throw new Error('Checkout must equal the immutable release tag commit');
  const modified = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean);
  for (const file of modified) {
    if (!injected) throw new Error('Release source differs from the committed tag');
    // oclif's existing prepack hook regenerates this documentation. Docs builds
    // similarly regenerate API.md; neither is an executable build input.
    if (
      file === 'packages/sitemaps-cli/README.md' ||
      (generatedDocs && file === 'packages/sitemaps-cdk/API.md')
    )
      continue;
    if (!/^(?:package\.json|packages\/[^/]+\/package\.json)$/.test(file))
      throw new Error('Release source differs from the committed tag');
    const source = JSON.parse(git('show', `${commit}:${file}`));
    const materialized = JSON.parse(fs.readFileSync(path.join(cwd, file)));
    if (
      materialized.version !== version.version ||
      !isDeepStrictEqual({ ...source, version: version.version }, materialized)
    )
      throw new Error('Only explicit version injection may change release manifests');
  }
  // No maintenance release branches are currently established in this repo.
  if (release.target_commitish !== 'main' && release.target_commitish !== commit)
    throw new Error('Release target must be main or the exact tag commit');
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main');
  if (eventName === 'release') {
    if (
      ref !== `refs/tags/${tag}` ||
      sha !== commit ||
      event.release?.id !== release.id ||
      event.release?.tag_name !== tag ||
      event.release?.draft ||
      event.release?.prerelease !== release.prerelease
    )
      throw new Error('Release event provenance disagrees with the current release/tag');
  } else if (eventName === 'workflow_dispatch') {
    if (ref !== 'refs/heads/main' || event.inputs?.tag !== tag)
      throw new Error('Manual release must run from main with an explicit tag');
    if (sha !== git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/\s+/)[0])
      throw new Error('Manual workflow source is no longer current main');
  } else if (eventName !== 'docs') {
    throw new Error('Unsupported release event');
  }
  publicManifests(
    cwd,
    injected ? version.version : '0.0.0',
    !requireHead && !injected ? commit : undefined,
  );
  return { ...version, tag, commit, channel: version.prerelease ? 'next' : 'latest' };
}

function publicationDecision(version, state, integrity) {
  const release = parseVersion(version);
  if (!state || !state.versions || !state['dist-tags'])
    throw new Error('Incomplete registry metadata');
  const tags = state['dist-tags'];
  const channel = release.prerelease ? 'next' : 'latest';
  if (tags.latest && parseVersion(tags.latest).prerelease)
    throw new Error('Registry latest must be stable');
  if (tags.latest && compare(version, tags.latest) < 0)
    throw new Error('Release is superseded by npm latest');
  if (tags[channel] && compare(version, tags[channel]) < 0)
    throw new Error(`Refusing to move ${channel} backwards`);
  const existing = state.versions[version];
  if (!existing) return { action: 'publish', channel };
  if (!integrity || existing.dist?.integrity !== integrity)
    throw new Error('Immutable registry version has different or missing integrity');
  if (tags[channel] !== version)
    throw new Error(
      'Existing version has a different channel; owner review required, no automatic dist-tag repair',
    );
  return { action: 'skip', channel };
}

function stableVersion(states) {
  const latest = states.map((state) => state['dist-tags']?.latest);
  if (!latest[0] || latest.some((value) => value !== latest[0]))
    throw new Error('All six npm latest versions must agree before docs publication');
  if (parseVersion(latest[0]).prerelease) throw new Error('Docs require a stable latest');
  if (states.some((state) => !state.versions?.[latest[0]]?.dist?.integrity))
    throw new Error('Stable version is not fully published');
  return latest[0];
}

function publisherGuard({ policy, nodeVersion, npmVersion, env }) {
  if (policy.publicationBlocked !== false)
    throw new Error(`Publication policy blocker: ${policy.reason}`);
  if (env.NODE_AUTH_TOKEN || env.NPM_TOKEN || env.NPM_CONFIG_PROVENANCE === 'false')
    throw new Error('Token fallback or disabled provenance is forbidden');
  if (parseVersion(nodeVersion).numbers[0] !== 24n || compare(npmVersion, '11.5.1') < 0)
    throw new Error('Use Node 24 and npm >=11.5.1 for trusted publishing');
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error('GitHub Actions OIDC permission required');
}

function publicationRecord(release, entries, env) {
  const record = {
    schema: 1,
    repository,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    workflowSha: env.GITHUB_SHA,
    tag: release.tag,
    version: release.version,
    commit: release.commit,
    channel: release.channel,
    entries: entries.map(({ name, integrity }) => ({ name, integrity })),
  };
  validatePublicationRecord(record, {
    id: env.GITHUB_RUN_ID,
    run_attempt: env.GITHUB_RUN_ATTEMPT,
    head_sha: env.GITHUB_SHA,
  });
  return record;
}

function validatePublicationRecord(record, actualRun) {
  if (
    !record ||
    record.schema !== 1 ||
    record.repository !== repository ||
    !/^[1-9][0-9]*$/.test(record.runId) ||
    !/^[1-9][0-9]*$/.test(record.runAttempt) ||
    record.runId !== String(actualRun.id) ||
    record.runAttempt !== String(actualRun.run_attempt) ||
    !/^[0-9a-f]{40}$/.test(record.workflowSha) ||
    record.workflowSha !== actualRun.head_sha ||
    !/^[0-9a-f]{40}$/.test(record.commit)
  )
    throw new Error('Publication receipt does not match this workflow run/attempt/source');
  const version = parseTag(record.tag);
  if (
    version.version !== record.version ||
    record.channel !== (version.prerelease ? 'next' : 'latest') ||
    JSON.stringify(record.entries?.map((entry) => entry.name)) !==
      JSON.stringify(packages.map((name) => `@shutterstock/${name}`)) ||
    record.entries.some((entry) => !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity))
  )
    throw new Error('Invalid publication receipt version/channel/package set');
}

function docsProvenance({
  eventName,
  event,
  actualRun,
  release,
  head,
  finalVersion,
  publication,
  states,
}) {
  if (eventName === 'workflow_run') {
    const workflow = event.workflow_run;
    if (workflow?.conclusion !== 'success' || workflow.head_repository?.full_name !== repository)
      throw new Error('Docs require a successful publication in this repository');
    if (
      !actualRun ||
      actualRun.path !== '.github/workflows/publish.yml' ||
      actualRun.conclusion !== 'success' ||
      !['release', 'workflow_dispatch'].includes(actualRun.event) ||
      actualRun.head_sha !== workflow.head_sha ||
      actualRun.id !== workflow.id
    )
      throw new Error('Unexpected publication workflow provenance');
    validatePublicationRecord(publication, actualRun);
    // A dispatch run's head_sha identifies its main workflow source; the
    // immutable package source is the tag commit recorded after publication.
    if (actualRun.event === 'release' && publication.commit !== actualRun.head_sha)
      throw new Error('Release event and published source disagree');
    if (publication.channel !== 'latest' || publication.version !== release.version) return false;
    if (publication.tag !== release.tag || publication.commit !== release.commit)
      throw new Error('Published source does not match the verified stable release');
    if (
      !states ||
      states.length !== packages.length ||
      publication.entries.some(
        (entry, index) =>
          entry.integrity !== states[index].versions?.[release.version]?.dist?.integrity,
      )
    )
      throw new Error('Publication receipt differs from the stable registry archives');
  } else throw new Error('Unsupported docs event');
  if (finalVersion !== undefined && (release.version !== finalVersion || head !== release.commit))
    throw new Error('Docs source was superseded or checkout changed');
  return true;
}

const integrity = (bytes) => `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;

async function registryState(name) {
  const url = registryUrls.get(name);
  if (!url) throw new Error('Registry reads require a known public package');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { accept: 'application/json' },
  });
  // Even 404 is a blocker: initial package ownership/publisher bootstrap is an owner operation.
  if (!response.ok)
    throw new Error(`Public registry read failed for ${name}: HTTP ${response.status}`);
  const state = await response.json();
  if (state.name !== name) throw new Error('Registry returned a different package');
  return state;
}

async function publishPackages({ entries, version, readState, publish, verify, attempts = 5 }) {
  // Preflight every package before making the first write.
  for (const entry of entries)
    publicationDecision(version, await readState(entry.name), entry.integrity);
  for (const entry of entries) {
    await verify();
    const decision = publicationDecision(version, await readState(entry.name), entry.integrity);
    if (decision.action === 'skip') {
      console.log(`Verified existing immutable ${entry.name}@${version}; skipping`);
      continue;
    }
    await publish(entry, decision.channel);
    let verified = false;
    for (let i = 0; i < attempts; i++) {
      const state = await readState(entry.name);
      if (publicationDecision(version, state, entry.integrity).action === 'skip') {
        verified = true;
        break;
      }
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!verified)
      throw new Error(
        `Publication not visible for ${entry.name}; stop and recover this exact version`,
      );
  }
}

module.exports = {
  repository,
  registry,
  parseVersion,
  parseTag,
  compare,
  run,
  publicManifests,
  validateRelease,
  publicationDecision,
  stableVersion,
  publisherGuard,
  publicationRecord,
  validatePublicationRecord,
  docsProvenance,
  integrity,
  registryState,
  publishPackages,
};
