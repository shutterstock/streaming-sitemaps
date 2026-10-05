const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const cli = createRequire(require.resolve('@shutterstock/sitemaps-cli/package.json'));

async function main() {
  for (const dir of ['models', 'db', 'metrics', 'wrapper']) {
    const name = `@shutterstock/sitemaps-${dir}-lib`;
    const r = dir === 'metrics' ? require : cli;
    const root = path.dirname(r.resolve(`${name}/package.json`));
    const publicExports = r(name);
    const esm = await import(name);
    for (const key of Object.keys(publicExports)) assert(key in esm || key in esm.default, key);
    for (const file of fs.readdirSync(path.join(root, 'dist')).filter((f) => f.endsWith('.js'))) {
      const subpath = dir === 'wrapper' ? `dist/${file.slice(0, -3)}` : file.slice(0, -3);
      const extensionless = r(`${name}/${subpath}`);
      assert.deepEqual(extensionless, r(`${name}/${subpath}.js`));
      const deepEsm = await import(`${name}/${subpath}${dir === 'wrapper' ? '.js' : ''}`);
      assert.equal(deepEsm.default, (await import(`${name}/${subpath}.js`)).default);
      assert(deepEsm.default, `Missing native ESM CJS interop for ${name}/${subpath}`);
    }
  }
  assert.equal(
    require('@shutterstock/sitemaps-metrics-lib').SitemapWriterMetrics.MsgReceived,
    'MsgReceived',
  );
  assert.equal(typeof cli('@shutterstock/sitemaps-db-lib').DBManager, 'function');
  assert.equal(typeof cli('@shutterstock/sitemaps-wrapper-lib').SitemapFileWrapper, 'function');
  const wrapperRequire = createRequire(cli.resolve('@shutterstock/sitemaps-wrapper-lib'));
  const { S3Client, GetObjectCommand } = wrapperRequire('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'offline', secretAccessKey: 'offline' },
    requestHandler: {
      handle: async () => ({
        response: {
          statusCode: 404,
          headers: { 'content-type': 'application/xml' },
          body: require('node:stream').Readable.from([
            Buffer.from('<Error><Code>NoSuchKey</Code><Message>offline fixture</Message></Error>'),
          ]),
        },
      }),
      destroy() {},
    },
  });
  try {
    await assert.rejects(client.send(new GetObjectCommand({ Bucket: 'offline', Key: 'missing' })), {
      name: 'NoSuchKey',
      message: 'offline fixture',
    });
  } finally {
    client.destroy();
  }
  console.log('Published SDK resolves and deserializes a synthetic S3 XML error offline');
  console.log('Every public library entry and deep module loads with CommonJS and native ESM');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
