const fs = require('node:fs');
const zlib = require('node:zlib');

// Keep readable XML fixtures in Git and recreate compressed input bytes.
// Missing inputs previously left mocked download streams waiting indefinitely.
for (const name of ['index', 'sitemap', 'sitemap1', 'sitemap2']) {
  const file = `packages/sitemaps-cli/test/data/${name}.xml`;
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(fs.readFileSync(file)));
}

// Upload tests use these canonical inputs through paths relative to their cwd.
const uploadDirectory = 'packages/sitemaps-cli/test/commands/upload-to-s3/data';
fs.mkdirSync(uploadDirectory, { recursive: true });
for (const name of ['index.xml', 'sitemap.xml', 'sitemap1.xml.gz', 'sitemap2.xml.gz']) {
  fs.copyFileSync(`packages/sitemaps-cli/test/data/${name}`, `${uploadDirectory}/${name}`);
}
