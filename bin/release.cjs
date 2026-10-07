#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  repository,
  registry,
  parseVersion,
  parseTag,
  run,
  publicManifests,
  validateRelease,
  stableVersion,
  publisherGuard,
  publicationRecord,
  publicationDecision,
  docsProvenance,
  integrity,
  registryState,
  publishPackages,
} = require('./release-lib.cjs');

const output = (values) => {
  const text =
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
  console.log(text.trim());
};
const event = () => JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH));
const releaseRecord = (tag) =>
  JSON.parse(run('gh', ['api', `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`]));

function checkContext(workflow) {
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    !process.env.GITHUB_WORKFLOW_REF?.startsWith(`${repository}/.github/workflows/${workflow}@`)
  )
    throw new Error('Unexpected repository or workflow identity');
  const expectedRef =
    process.env.GITHUB_EVENT_NAME === 'release' ? process.env.GITHUB_REF : 'refs/heads/main';
  if (
    process.env.GITHUB_WORKFLOW_REF !== `${repository}/.github/workflows/${workflow}@${expectedRef}`
  )
    throw new Error('Workflow must originate from the release tag or main');
}

function verify(injected = false, requireHead = true) {
  checkContext('publish.yml');
  const payload = event();
  const tag =
    process.env.GITHUB_EVENT_NAME === 'release' ? payload.release?.tag_name : payload.inputs?.tag;
  parseTag(tag);
  return validateRelease({
    tag,
    release: releaseRecord(tag),
    eventName: process.env.GITHUB_EVENT_NAME,
    event: payload,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    injected,
    requireHead,
  });
}

function pack(version, directory) {
  parseVersion(version);
  const commit = run('git', ['rev-parse', 'HEAD']);
  const destination = path.resolve(directory);
  if (fs.existsSync(destination))
    throw new Error('Pack destination must not exist; stale archives are forbidden');
  fs.mkdirSync(destination, { recursive: true });
  const entries = publicManifests(process.cwd(), version).map(({ directory: workspace, name }) => {
    run('pnpm', ['--dir', `packages/${workspace}`, 'pack', '--pack-destination', destination]);
    const filename = `shutterstock-${workspace}-${version}.tgz`;
    const archive = path.join(destination, filename);
    const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']));
    if (manifest.name !== name || manifest.version !== version || manifest.private)
      throw new Error('Packed manifest disagrees with the release');
    for (const [dependency, range] of Object.entries(manifest.dependencies || {})) {
      if (
        range.startsWith('workspace:') ||
        (dependency.startsWith('@shutterstock/sitemaps-') &&
          !require('./public-packages.cjs').some((item) => dependency === `@shutterstock/${item}`))
      )
        throw new Error('Unpublishable internal dependency');
    }
    return { name, filename, integrity: integrity(fs.readFileSync(archive)) };
  });
  fs.writeFileSync(
    path.join(destination, 'plan.json'),
    JSON.stringify({ version, commit, entries }, null, 2) + '\n',
  );
  return entries;
}

function readPlan(directory, release) {
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json')));
  const names = publicManifests(process.cwd(), release.version).map((entry) => entry.name);
  if (
    plan.version !== release.version ||
    plan.commit !== release.commit ||
    JSON.stringify(plan.entries?.map((entry) => entry.name)) !== JSON.stringify(names)
  )
    throw new Error('Archive plan does not match the immutable release/package order');
  for (const entry of plan.entries) {
    const expected = `${entry.name.slice(1).replace('/', '-')}-${release.version}.tgz`;
    if (
      entry.filename !== expected ||
      integrity(fs.readFileSync(path.join(directory, expected))) !== entry.integrity
    )
      throw new Error('Archive path or integrity mismatch');
  }
  return plan;
}

function readPublication(actualRun) {
  if (
    !/^[1-9][0-9]*$/.test(String(actualRun.id)) ||
    !/^[1-9][0-9]*$/.test(String(actualRun.run_attempt))
  )
    throw new Error('Invalid publication run identity');
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-publication-receipt-'));
  try {
    run('gh', [
      'run',
      'download',
      String(actualRun.id),
      '--repo',
      repository,
      '--name',
      `publication-${actualRun.run_attempt}`,
      '--dir',
      destination,
    ]);
    return JSON.parse(fs.readFileSync(path.join(destination, 'publication.json'), 'utf8'));
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

async function docsSelection(final = false) {
  checkContext('docs.yml');
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_run')
    throw new Error('Unsupported docs event; rerun a verified publication-triggered docs attempt');
  const payload = event();
  const manifests = publicManifests(process.cwd(), final ? process.env.RELEASE_VERSION : '0.0.0');
  const states = await Promise.all(manifests.map(({ name }) => registryState(name)));
  const version = stableVersion(states);
  const tag = `v${version}`;
  const release = validateRelease({
    tag,
    release: releaseRecord(tag),
    eventName: 'docs',
    requireHead: false,
    injected: final,
    generatedDocs: final,
  });
  const actualRun =
    process.env.GITHUB_EVENT_NAME === 'workflow_run' &&
    JSON.parse(run('gh', ['api', `repos/${repository}/actions/runs/${payload.workflow_run?.id}`]));
  if (
    !docsProvenance({
      eventName: process.env.GITHUB_EVENT_NAME,
      event: payload,
      actualRun,
      publication: actualRun ? readPublication(actualRun) : undefined,
      states,
      release,
      head: run('git', ['rev-parse', 'HEAD']),
      finalVersion: final ? process.env.RELEASE_VERSION : undefined,
    })
  )
    return output({ publish: false });
  if (final) {
    // The construct has no published internal dependencies. Its rebuilt archive
    // therefore binds this API build directly to the immutable registry bytes,
    // including all three real handler bundles/maps, even during manual repair.
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-docs-archive-'));
    try {
      run('pnpm', ['--dir', 'packages/sitemaps-cdk', 'pack', '--pack-destination', destination]);
      const archive = fs.readFileSync(
        path.join(destination, `shutterstock-sitemaps-cdk-${version}.tgz`),
      );
      if (integrity(archive) !== states.at(-1).versions[version].dist.integrity)
        throw new Error(
          'Docs construct archive differs from the immutable published source; stop for owner review',
        );
    } finally {
      fs.rmSync(destination, { recursive: true, force: true });
    }
  }
  output({ publish: true, version, tag, commit: release.commit });
}

async function main() {
  const [command, version, directory] = process.argv.slice(2);
  if (command === 'select') {
    const release = verify(false, false);
    output({
      version: release.version,
      tag: release.tag,
      commit: release.commit,
      channel: release.channel,
    });
  } else if (command === 'pack') {
    if (!directory) throw new Error('Usage: node bin/release.cjs pack X.Y.Z destination');
    pack(version, directory);
  } else if (command === 'dry-run') {
    const release = {
      version: parseVersion(version).version,
      commit: run('git', ['rev-parse', 'HEAD']),
    };
    if (!directory) throw new Error('Specify the fresh packed destination');
    const plan = readPlan(directory, release);
    for (const entry of plan.entries)
      console.log(
        run('npm', [
          'publish',
          path.resolve(directory, entry.filename),
          '--dry-run',
          '--ignore-scripts',
          '--access=public',
          '--tag=ci-preview',
          `--registry=${registry}/`,
        ]),
      );
  } else if (command === 'publish') {
    if (!version) throw new Error('Specify the validated archive directory');
    const release = verify(true);
    const policy = JSON.parse(fs.readFileSync('.github/release-policy.json'));
    publisherGuard({
      policy,
      nodeVersion: process.versions.node,
      npmVersion: run('npm', ['--version']),
      env: process.env,
    });
    const plan = readPlan(version, release);
    const receipt = publicationRecord(release, plan.entries, process.env);
    await publishPackages({
      entries: plan.entries,
      version: release.version,
      readState: registryState,
      verify: async () => {
        verify(true);
        readPlan(version, release);
      },
      publish: async (entry, channel) =>
        console.log(
          run('npm', [
            'publish',
            path.resolve(version, entry.filename),
            '--ignore-scripts',
            '--access=public',
            `--tag=${channel}`,
            `--registry=${registry}/`,
          ]),
        ),
    });
    verify(true);
    readPlan(version, release);
    for (const entry of plan.entries) {
      if (
        publicationDecision(release.version, await registryState(entry.name), entry.integrity)
          .action !== 'skip'
      )
        throw new Error('Publication is incomplete; no successful receipt may be written');
    }
    fs.writeFileSync(
      path.join(version, 'publication.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    output({ channel: release.channel });
  } else if (command === 'docs-select' || command === 'docs-verify') {
    await docsSelection(command === 'docs-verify');
  } else throw new Error('Expected select, pack, dry-run, publish, docs-select, or docs-verify');
}

module.exports = { pack, readPlan, verify, docsSelection };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
