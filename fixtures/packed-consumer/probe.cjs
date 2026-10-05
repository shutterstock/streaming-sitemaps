const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const r = createRequire(require.resolve('@shutterstock/sitemaps-cli/package.json'));
const manifest = r('./package.json');
const commands = Object.keys(r('./oclif.manifest.json').commands);

(async () => {
  assert.equal(process.env.NODE_PATH, undefined, 'Installed shim must not inject NODE_PATH');
  const config = await r('@oclif/core').Config.load(r.resolve('./package.json'));
  for (const id of commands) {
    assert(config.findCommand(id), `Undiscovered command ${id}`);
    await config.findCommand(id).load();
  }
  for (const plugin of manifest.oclif.plugins) {
    assert(
      [...config.plugins.values()].some((p) => p.name === plugin),
      `Unloaded plugin ${plugin}`,
    );
  }
  for (const name of ['rotate', 'cleanup-sitemap-items', 'index-or-sitemap', 'file-or-url']) {
    r(`./dist/utils/${name}`);
  }
  const result = r('./dist/utils/file-or-url').getUrlOrFilePath('input.xml');
  assert.equal(result.file, 'input.xml');
  assert.equal(await r('./dist/utils/index-or-sitemap').getSitemapType('input.xml'), 'Sitemap');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
