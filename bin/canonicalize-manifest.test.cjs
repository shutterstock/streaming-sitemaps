const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { canonicalizeManifest } = require('../packages/sitemaps-cli/bin/prepare-pack.cjs');

test('command discovery permutations yield identical manifests without changing command/flag metadata', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-manifest-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'oclif.manifest.json');
  const commands = {
    upload: {
      flags: { zebra: {}, alpha: {} },
      flagsOrder: ['zebra', 'alpha'],
      aliases: ['second', 'first'],
    },
    convert: { args: [{ name: 'input' }], flags: {} },
    create: { flags: { type: { options: ['sitemap-index', 'sitemap'] } } },
  };
  const orders = [
    ['upload', 'convert', 'create'],
    ['create', 'upload', 'convert'],
    ['convert', 'create', 'upload'],
  ];
  let expected;
  for (const order of orders) {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: '1.2.3',
        commands: Object.fromEntries(order.map((name) => [name, commands[name]])),
      }),
    );
    canonicalizeManifest(file);
    const bytes = fs.readFileSync(file);
    if (expected) assert.deepEqual(bytes, expected);
    expected = bytes;
    const result = JSON.parse(bytes);
    assert.deepEqual(result.commands, commands);
    assert.deepEqual(Object.keys(result.commands.upload.flags), ['zebra', 'alpha']);
    canonicalizeManifest(file);
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  for (const invalid of [{}, { commands: [] }, { commands: null }]) {
    const source = JSON.stringify(invalid);
    fs.writeFileSync(file, source);
    assert.throws(() => canonicalizeManifest(file), /command manifest/);
    assert.equal(fs.readFileSync(file, 'utf8'), source);
  }
});
