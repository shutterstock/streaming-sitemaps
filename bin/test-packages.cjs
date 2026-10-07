#!/usr/bin/env node
// Consume real archives through a read-only localhost registry for the public
// sibling scope. Nothing is published or rewritten, including workspace ranges.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire, builtinModules } = require('node:module');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'fixtures/packed-consumer');
const publicPackages = require('./public-packages.cjs');
const runtimeNode = process.env.SITEMAPS_CONSUMER_NODE
  ? path.resolve(process.env.SITEMAPS_CONSUMER_NODE)
  : process.execPath;
const pnpm = process.env.npm_execpath;
assert(pnpm && /pnpm(?:-native|\.(?:cjs|mjs|js))$/.test(pnpm), 'Run with pnpm run test:packages');
assert.equal(process.versions.node.split('.')[0], '24', 'Use the Node 24 developer toolchain');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-package-consumer-')));
assert(!temp.startsWith(`${root}/`), 'Consumer must be outside the workspace');
for (let dir = temp; ; dir = path.dirname(dir)) {
  assert(!fs.existsSync(path.join(dir, 'node_modules')), `Ancestor dependencies at ${dir}`);
  if (dir === path.dirname(dir)) break;
}

function run(command, args, cwd, env, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 300000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 || allowFailure) resolve({ code, output });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}) in ${cwd}\n${output}`));
    });
  });
}

function dependencyFingerprint() {
  const hash = crypto.createHash('sha256');
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && /package\.json$|lock|\.modules\.yaml$|workspace-state/.test(file)) {
        // Open before checking metadata; never follow a replacement symlink.
        // Both metadata and content come from the same descriptor.
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const stat = fs.fstatSync(fd);
          assert(stat.isFile(), `Expected regular file: ${file}`);
          hash.update(`${file}:${stat.mode}:${stat.size}:${stat.mtimeMs}\n`);
          const identity = ({ dev, ino, mode, size, mtimeMs, ctimeMs }) => ({
            dev, ino, mode, size, mtimeMs, ctimeMs,
          });
          hash.update(fs.readFileSync(fd));
          assert.deepEqual(identity(fs.fstatSync(fd)), identity(stat), `File changed: ${file}`);
        } finally {
          fs.closeSync(fd);
        }
      } else {
        const stat = fs.lstatSync(file);
        hash.update(`${file}:${stat.mode}:${stat.size}:${stat.mtimeMs}\n`);
        if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
        else if (stat.isDirectory()) visit(file);
      }
    }
  }
  visit(path.join(root, 'node_modules'));
  for (const dir of fs.readdirSync(path.join(root, 'packages')))
    visit(path.join(root, 'packages', dir, 'node_modules'));
  hash.update(fs.readFileSync(path.join(root, 'pnpm-lock.yaml')));
  return hash.digest('hex');
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function installedVersion(requireFrom, name) {
  let dir = path.dirname(requireFrom.resolve(name));
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file) && json(file).name === name) return json(file).version;
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot find installed manifest for ${name}`);
}
function runPnpm(args, cwd, env) {
  return pnpm.endsWith('-native')
    ? run(pnpm, args, cwd, env)
    : run(process.execPath, [pnpm, ...args], cwd, env);
}
function inside(file, dir) {
  return file === dir || file.startsWith(`${dir}${path.sep}`);
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

async function main() {
  const discovered = fs.readdirSync(path.join(root, 'packages')).filter((dir) => {
    const file = path.join(root, 'packages', dir, 'package.json');
    return fs.existsSync(file) && !json(file).private;
  });
  assert.deepEqual(discovered.sort(), [...publicPackages].sort(), 'Audit every public workspace');
  const before = dependencyFingerprint();
  const readmePath = path.join(root, 'packages/sitemaps-cli/README.md');
  const readme = fs.readFileSync(readmePath);
  let server;
  try {
    const archives = path.join(temp, 'archives');
    const consumer = path.join(temp, 'consumer');
    const tools = path.join(temp, 'tools');
    const toolbin = path.join(temp, 'toolbin');
    const home = path.join(temp, 'home');
    for (const dir of [archives, consumer, tools, toolbin, home]) fs.mkdirSync(dir);
    fs.symlinkSync(process.execPath, path.join(toolbin, 'node'));
    // The installed bin's ordinary pnpm shell shim needs these OS utilities.
    // No global package binaries (including sitemaps-cli or tsc) are exposed.
    for (const name of ['sh', 'dirname', 'sed', 'uname', 'readlink']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${name}`], {
        encoding: 'utf8',
      }).stdout.trim();
      assert(found, `Missing OS utility ${name}`);
      fs.symlinkSync(found, path.join(toolbin, name));
    }
    const npmrc = path.join(home, '.npmrc');
    fs.writeFileSync(npmrc, 'registry=https://registry.npmjs.org/\n');
    const env = {
      PATH: toolbin,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: temp,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: path.join(temp, 'cache'),
      npm_config_userconfig: npmrc,
      npm_config_globalconfig: npmrc,
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_min_release_age: '7',
      NODE_OPTIONS: '--no-global-search-paths',
      CI: 'true',
      NO_COLOR: '1',
      LISTR_RENDERER: 'simple',
    };
    assert.equal((await runPnpm(['--version'], temp, env)).output.trim(), '12.7.0');
    const packages = new Map();
    for (const directory of publicPackages) {
      await runPnpm(
        ['--dir', `packages/${directory}`, 'pack', '--pack-destination', archives],
        root,
        { ...process.env, PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false' },
      );
      const source = json(path.join(root, 'packages', directory, 'package.json'));
      const archive = path.join(
        archives,
        `${source.name.replace('@', '').replace('/', '-')}-${source.version}.tgz`,
      );
      assert(fs.existsSync(archive), `Missing freshly packed ${archive}`);
      const extracted = path.join(temp, directory);
      fs.mkdirSync(extracted);
      await run('tar', ['-xzf', archive, '-C', extracted], root, process.env);
      const packageDir = path.join(extracted, 'package');
      const manifest = json(path.join(packageDir, 'package.json'));
      assert.equal(manifest.version, source.version);
      assert.equal(
        manifest.engines.node.replace(/\s/g, ''),
        '>=24.0.0',
        `${manifest.name} must retain Node 24 support`,
      );
      assert(!manifest.private, `${manifest.name} must be public`);
      for (const field of [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'devDependencies',
      ]) {
        for (const [name, range] of Object.entries(manifest[field] || {})) {
          assert(
            !/^(workspace:|link:|file:)/.test(range),
            `${manifest.name} leaks ${field}.${name}: ${range}`,
          );
          if (field !== 'devDependencies')
            assert(
              !/sitemaps-utils-lib|kinesis-(index|sitemap)/.test(name),
              `Private production dependency ${name}`,
            );
        }
      }
      for (const entry of [manifest.main, manifest.types || 'dist/index.d.ts'])
        assert(fs.existsSync(path.join(packageDir, entry)), `Missing ${manifest.name} ${entry}`);
      const shipped = files(packageDir).map((file) => path.relative(packageDir, file));
      assert(
        !shipped.some((file) =>
          /^(test|coverage)\/|(^|\/)(node_modules|__snapshots__|mocks|fixtures|\.agents|\.codex)\/|AGENTS\.md$|\.test\.|\.tsbuildinfo$|\.(key|pem)$|(^|\/)(tsconfig[^/]*|eslint[^/]*|\.projenrc[^/]*|bundle\.mjs)$/.test(
            file,
          ),
        ),
        `${manifest.name} includes development files`,
      );
      assert(
        shipped.some((file) => /^LICENSE(?:\.md)?$/.test(file)),
        `${manifest.name} lacks license`,
      );
      assert(shipped.includes('README.md'), `${manifest.name} lacks README`);
      assert.equal(manifest.license, 'MIT');
      assert.equal(manifest.repository.directory, `packages/${directory}`);
      assert(!JSON.stringify(manifest).includes('github.shuttercorp'), 'Stale repository metadata');
      packages.set(manifest.name, { manifest, archive, packageDir });
    }
    const cli = packages.get('@shutterstock/sitemaps-cli');
    for (const [parent, pkg] of packages) {
      for (const [name, range] of Object.entries(pkg.manifest.dependencies || {})) {
        if (!name.startsWith('@shutterstock/sitemaps-')) continue;
        assert(packages.has(name), `${parent} depends on unpublished ${name}`);
        assert.equal(
          range,
          `^${packages.get(name).manifest.version}`,
          `Incorrect sibling range ${name}`,
        );
        assert(
          [...packages.keys()].indexOf(name) < [...packages.keys()].indexOf(parent),
          'Publication order must put dependencies first',
        );
      }
    }
    assert.equal(cli.manifest.bin['sitemaps-cli'], './bin/run.js');
    assert(
      fs.statSync(path.join(cli.packageDir, 'bin/run.js')).mode & 0o111,
      'CLI bin must be executable',
    );
    const oclif = json(path.join(cli.packageDir, 'oclif.manifest.json'));
    const commands = Object.keys(oclif.commands).sort();
    assert(
      commands.includes('convert') && commands.includes('create:from-csv'),
      'Missing command discovery metadata',
    );
    assert.deepEqual(cli.manifest.oclif.plugins, ['@oclif/plugin-help', '@oclif/plugin-plugins']);
    for (const id of commands) {
      const commandPath = path.join(cli.packageDir, 'dist/commands', id.replaceAll(':', '/'));
      assert(
        fs.existsSync(`${commandPath}.js`) || fs.existsSync(path.join(commandPath, 'index.js')),
        `Missing command ${id}`,
      );
    }

    const served = new Set();
    server = http.createServer((request, response) => {
      assert(!request.headers.authorization, 'Local archive registry must not receive credentials');
      const url = new URL(request.url, 'http://localhost');
      if (request.method !== 'GET') {
        response.writeHead(405);
        response.end();
        return;
      }
      if (url.pathname.startsWith('/archives/')) {
        const name = decodeURIComponent(url.pathname.slice('/archives/'.length));
        const pkg = packages.get(name);
        if (!pkg) {
          response.writeHead(404);
          response.end('No packed public sibling');
          return;
        }
        served.add(name);
        response.setHeader('content-type', 'application/octet-stream');
        fs.createReadStream(pkg.archive).pipe(response);
        return;
      }
      const name = decodeURIComponent(url.pathname.slice(1));
      const pkg = packages.get(name);
      if (!pkg) {
        response.writeHead(404);
        response.end(`No local tarball for ${name}; registry fallback forbidden`);
        return;
      }
      const version = pkg.manifest.version;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          name,
          'dist-tags': { latest: version },
          versions: {
            [version]: {
              ...pkg.manifest,
              dist: {
                tarball: `http://127.0.0.1:${server.address().port}/archives/${encodeURIComponent(name)}`,
                integrity: `sha512-${crypto.createHash('sha512').update(fs.readFileSync(pkg.archive)).digest('base64')}`,
              },
            },
          },
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    // Public external dependencies use npmjs. The sibling scope only serves the
    // actual versions in the freshly packed archives; no overrides or hooks.
    const policy = `nodeLinker: isolated\nhoist: false\nextendNodePath: false\nminimumReleaseAge: 10080\npackageImportMethod: auto\nverifyDepsBeforeRun: false\n`;
    for (const dir of [consumer, tools]) {
      fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), policy);
      fs.writeFileSync(
        path.join(dir, '.npmrc'),
        `registry=https://registry.npmjs.org/\n@shutterstock:registry=http://127.0.0.1:${server.address().port}/\n`,
      );
    }
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          '@shutterstock/sitemaps-cli': `file:${cli.archive}`,
          '@shutterstock/sitemaps-cdk': `file:${packages.get('@shutterstock/sitemaps-cdk').archive}`,
          ...Object.fromEntries(
            [...packages]
              .filter(
                ([name]) =>
                  !['@shutterstock/sitemaps-cli', '@shutterstock/sitemaps-cdk'].includes(name),
              )
              .map(([name, pkg]) => [name, pkg.manifest.version]),
          ),
          'aws-cdk-lib': json(path.join(root, 'packages/sitemaps-cdk/package.json'))
            .devDependencies['aws-cdk-lib'],
          constructs: json(path.join(root, 'packages/sitemaps-cdk/package.json')).devDependencies
            .constructs,
        },
      }),
    );
    // Tools live in a sibling tree. Its compiler/types cannot provide modules
    // to CLI declarations via any ancestor or consumer node_modules path.
    fs.writeFileSync(
      path.join(tools, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          typescript: json(path.join(root, 'package.json')).devDependencies.typescript,
          '@types/node': json(path.join(root, 'packages/sitemaps-models-lib/package.json'))
            .devDependencies['@types/node'],
        },
      }),
    );
    for (const dir of [consumer, tools]) {
      const installed = await runPnpm(
        [
          'install',
          '--prod',
          '--ignore-scripts',
          '--store-dir',
          path.join(temp, 'store'),
          '--reporter=append-only',
        ],
        dir,
        env,
      );
      console.log(
        `${path.basename(dir)} production install: ${installed.output
          .split('\n')
          .filter((line) => /Packages:|Done in/.test(line))
          .join('; ')}`,
      );
    }
    if (process.env.SITEMAPS_AUDIT_PACKAGES === '1') {
      const result = await runPnpm(['audit', '--prod', '--json'], consumer, env);
      const audit = JSON.parse(result.output);
      assert.equal(
        Object.values(audit.metadata.vulnerabilities).reduce((total, count) => total + count, 0),
        0,
        result.output,
      );
      console.log(`Packed production audit: ${JSON.stringify(audit.metadata)}`);
    }
    assert.deepEqual(
      [...served].sort(),
      publicPackages
        .filter((name) => !['sitemaps-cli', 'sitemaps-cdk'].includes(name))
        .map((name) => `@shutterstock/${name}`)
        .sort(),
      'All siblings must come from our real local archives',
    );
    for (const dir of [consumer, tools]) {
      for (const file of files(path.join(dir, 'node_modules'))) {
        if (fs.lstatSync(file).isSymbolicLink())
          assert(inside(fs.realpathSync(file), dir), `Source or outside link: ${file}`);
      }
    }
    const consumerRequire = createRequire(path.join(consumer, 'package.json'));
    const installedCli = path.dirname(
      consumerRequire.resolve('@shutterstock/sitemaps-cli/package.json'),
    );
    const cliRequire = createRequire(path.join(installedCli, 'package.json'));
    for (const name of Object.keys(cli.manifest.dependencies))
      assert(
        inside(cliRequire.resolve(name), consumer),
        `Production dependency resolved outside consumer: ${name}`,
      );
    for (const [name, pkg] of packages) {
      const installed = path.dirname(
        (name === cli.manifest.name || name.endsWith('-cdk') || name.endsWith('-metrics-lib')
          ? consumerRequire
          : cliRequire
        ).resolve(`${name}/package.json`),
      );
      assert.deepEqual(
        json(path.join(installed, 'package.json')),
        pkg.manifest,
        `Installed ${name} differs from actual archive`,
      );
    }
    for (const name of [
      'typescript',
      'ts-node',
      '@oclif/test',
      'esbuild',
      '@shutterstock/sitemaps-utils-lib',
    ]) {
      assert.throws(
        () => cliRequire.resolve(name),
        { code: 'MODULE_NOT_FOUND' },
        `Dev dependency available: ${name}`,
      );
    }
    fs.copyFileSync(path.join(fixtures, 'consumer.ts'), path.join(consumer, 'consumer.ts'));
    fs.copyFileSync(path.join(fixtures, 'packages.ts'), path.join(consumer, 'packages.ts'));
    const declarations = [];
    const libraryImports = [];
    for (const [name, pkg] of packages) {
      const r =
        name === cli.manifest.name || name.endsWith('-cdk') || name.endsWith('-metrics-lib')
          ? consumerRequire
          : cliRequire;
      const installed = path.dirname(r.resolve(`${name}/package.json`));
      const directory = pkg.manifest.main.split('/')[0];
      for (const file of files(path.join(installed, directory)).filter((file) =>
        file.endsWith('.d.ts'),
      )) {
        declarations.push(file);
        if (name !== cli.manifest.name) {
          const module = path
            .relative(path.join(installed, directory), file)
            .replace(/\.d\.ts$/, '');
          const subpath = pkg.manifest.exports ? module : `${directory}/${module}`;
          libraryImports.push(`import '${name}/${subpath}';`);
          if (pkg.manifest.exports) {
            libraryImports.push(
              `import type * as Declaration${declarations.length} from '${name}/${subpath}.d.ts';`,
            );
          }
        }
      }
    }
    fs.writeFileSync(
      path.join(consumer, 'all-declarations.ts'),
      declarations
        .filter((file) => file.startsWith(`${installedCli}/`))
        .map(
          (file) =>
            `import '${cli.manifest.name}/${path.relative(installedCli, file).replace(/\.d\.ts$/, '')}';`,
        )
        .concat(libraryImports)
        .join('\n'),
    );
    const compiler = path.join(tools, 'node_modules/typescript/bin/tsc');
    const typeArgs = [
      compiler,
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--esModuleInterop',
      '--target',
      'ES2018',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--ignoreDeprecations',
      '6.0',
      '--types',
      'node',
      '--typeRoots',
      path.join(tools, 'node_modules/@types'),
      'consumer.ts',
      'all-declarations.ts',
      'packages.ts',
    ];
    await run(process.execPath, typeArgs, consumer, env);
    const listed = (await run(process.execPath, [...typeArgs, '--listFiles'], consumer, env))
      .output;
    for (const file of listed.trim().split('\n')) {
      assert(
        inside(fs.realpathSync(path.resolve(consumer, file)), temp),
        `TypeScript resolved outside consumer/tools: ${file}`,
      );
    }
    for (const resolution of ['Node16', 'NodeNext']) {
      const modernTypeArgs = [...typeArgs];
      modernTypeArgs[modernTypeArgs.indexOf('--module') + 1] = resolution;
      modernTypeArgs[modernTypeArgs.indexOf('--moduleResolution') + 1] = resolution;
      await run(process.execPath, modernTypeArgs, consumer, env);
    }
    console.log(
      `Strict consumer types passed for ${declarations.length} shipped public declarations (skipLibCheck=false)`,
    );
    const wrapperRequire = createRequire(cliRequire.resolve('@shutterstock/sitemaps-wrapper-lib'));
    const sdkRequire = createRequire(wrapperRequire.resolve('@aws-sdk/client-s3'));
    const parsers = files(path.join(consumer, 'node_modules'))
      .filter((file) => path.basename(file) === 'package.json')
      .map(json)
      .filter((manifest) => manifest.name === 'fast-xml-parser')
      .map((manifest) => manifest.version);
    console.log(
      `Published S3 SDK: ${installedVersion(sdkRequire, '@aws-sdk/client-s3')}; fast-xml-parser versions: ${JSON.stringify(parsers)} (no workspace overrides)`,
    );
    console.log(
      `Production versions: sitemap ${installedVersion(cliRequire, 'sitemap')}, CLI fs-extra ${installedVersion(cliRequire, 'fs-extra')}, wrapper fs-extra ${installedVersion(wrapperRequire, 'fs-extra')}`,
    );
    for (const file of declarations) {
      if (!file.startsWith(`${installedCli}/`)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.') || builtinModules.includes(specifier)) continue;
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        assert(
          cli.manifest.dependencies[name],
          `Shipped declaration ${path.relative(installedCli, file)} lacks direct dependency ${name}`,
        );
      }
    }

    const offlinePreload = path.join(temp, 'offline.cjs');
    fs.copyFileSync(path.join(fixtures, 'offline.cjs'), offlinePreload);
    const offline = { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS} --require=${offlinePreload}` };
    fs.unlinkSync(path.join(toolbin, 'node'));
    fs.symlinkSync(runtimeNode, path.join(toolbin, 'node'));
    const runtimeVersion = (await run(runtimeNode, ['--version'], consumer, offline)).output.trim();
    assert(
      Number(runtimeVersion.split('.')[0].slice(1)) >= 24,
      'Consumer runtime must satisfy Node >=24',
    );
    console.log(`Packed runtime checks: ${runtimeVersion}`);
    fs.copyFileSync(path.join(fixtures, 'exports.cjs'), path.join(consumer, 'exports.cjs'));
    console.log((await run(runtimeNode, ['exports.cjs'], consumer, offline)).output.trim());

    // Compile and execute the actual packed construct; local synthesis is offline.
    fs.cpSync(path.join(root, 'fixtures/cdk-consumer'), path.join(consumer, 'cdk'), {
      recursive: true,
    });
    const expected = {};
    for (const name of [
      'kinesis-sitemap-writer',
      'kinesis-index-writer',
      'kinesis-sitemap-freshener',
    ]) {
      expected[name] = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, 'packages/sitemaps-cdk/lib', name, 'index.js')))
        .digest('hex');
    }
    fs.writeFileSync(path.join(consumer, 'expected-bundles.json'), JSON.stringify(expected));
    const cdkArgs = typeArgs.slice(0, typeArgs.indexOf('--noEmit'));
    cdkArgs.push(
      '--strict',
      '--skipLibCheck',
      'false',
      '--esModuleInterop',
      '--target',
      'ES2022',
      '--module',
      'Node16',
      '--moduleResolution',
      'Node16',
      '--types',
      'node',
      '--typeRoots',
      path.join(tools, 'node_modules/@types'),
      '--outDir',
      'cdk-dist',
      'cdk/app.ts',
      'cdk/verify.ts',
    );
    await run(process.execPath, cdkArgs, consumer, env);
    const cdkEnv = {
      ...offline,
      CONSUMER_PACKAGE_VERSION: packages.get('@shutterstock/sitemaps-cdk').manifest.version,
    };
    console.log((await run(runtimeNode, ['cdk-dist/verify.js'], consumer, cdkEnv)).output.trim());
    const constructRoot = path.dirname(
      consumerRequire.resolve('@shutterstock/sitemaps-cdk/package.json'),
    );
    const bundle = path.join(constructRoot, 'lib/kinesis-sitemap-writer/index.js');
    fs.renameSync(bundle, `${bundle}.hidden`);
    try {
      const broken = await run(runtimeNode, ['cdk-dist/verify.js'], consumer, cdkEnv, true);
      assert.notEqual(broken.code, 0, 'Harness missed missing Lambda asset');
      assert(
        broken.output.includes('ENOENT') && broken.output.includes('kinesis-sitemap-writer'),
        broken.output,
      );
    } finally {
      fs.renameSync(`${bundle}.hidden`, bundle);
    }
    const bin = path.join(consumer, 'node_modules/.bin/sitemaps-cli');
    const version = await run(bin, ['--version'], consumer, offline);
    assert(version.output.includes(`/${cli.manifest.version} `), version.output);
    const help = await run(bin, ['--help'], consumer, offline);
    assert(help.output.includes('convert') && help.output.includes('plugins'), help.output);
    await run(bin, ['convert', '--help'], consumer, offline);
    await run(bin, ['plugins', '--help'], consumer, offline);
    const probe = path.join(consumer, 'probe.cjs');
    fs.copyFileSync(path.join(fixtures, 'probe.cjs'), probe);
    fs.copyFileSync(path.join(fixtures, 'input.xml'), path.join(consumer, 'input.xml'));
    await run(runtimeNode, [probe], consumer, offline);
    await run(bin, ['convert', '--type', 'sitemap', 'input.xml'], consumer, offline);
    assert.equal(
      fs.readFileSync(path.join(consumer, 'input.jsonl'), 'utf8'),
      fs.readFileSync(path.join(fixtures, 'expected.jsonl'), 'utf8'),
      'Converted JSONL differs from checked expected output',
    );
    console.log(
      'Installed bin, version/help, all command/plugin loading, helpers and offline XML conversion passed',
    );

    // Reproduce the former missing direct dependencies without removing the
    // siblings' own dependencies or adding consumer overrides/dev packages.
    for (const name of ['sitemap', 'fs-extra']) {
      const link = path.join(installedCli, '..', '..', name);
      assert(fs.lstatSync(link).isSymbolicLink(), `Missing direct CLI dependency ${name}`);
      fs.renameSync(link, `${link}.hidden`);
      try {
        const broken =
          name === 'sitemap'
            ? await run(process.execPath, typeArgs, consumer, env, true)
            : await run(runtimeNode, [probe], consumer, offline, true);
        assert.notEqual(broken.code, 0, `Harness missed missing ${name}`);
        assert(
          name === 'sitemap'
            ? /rotate\.d\.ts.*TS2307.*sitemap/.test(broken.output)
            : /Cannot find module 'fs-extra'/.test(broken.output),
          broken.output,
        );
      } finally {
        fs.renameSync(`${link}.hidden`, link);
      }
    }
    fs.renameSync(bin, `${bin}.hidden`);
    try {
      await assert.rejects(run(bin, ['--version'], consumer, offline), { code: 'ENOENT' });
    } finally {
      fs.renameSync(`${bin}.hidden`, bin);
    }
    console.log(
      'Negative controls caught missing sitemap (rotate TS2307), fs-extra, installed bin and Lambda bundle',
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(readmePath, readme);
    try {
      assert.equal(
        dependencyFingerprint(),
        before,
        'Packaged verification mutated root dependency trees or lock',
      );
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
