const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readFingerprintFile } = require('./read-fingerprint-file.cjs');

test('fingerprints the opened file when its pathname is replaced before reading', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-fingerprint-'));
  const file = path.join(directory, 'package.json');
  const originalRead = fs.readFileSync;
  fs.writeFileSync(file, 'original contents');
  try {
    fs.readFileSync = (descriptor) => {
      assert.equal(typeof descriptor, 'number');
      fs.renameSync(file, path.join(directory, 'original.json'));
      fs.writeFileSync(file, 'replacement');
      return originalRead(descriptor);
    };
    const fingerprint = readFingerprintFile(file, true);
    assert.equal(fingerprint.contents.toString(), 'original contents');
    assert.equal(fingerprint.stat.size, Buffer.byteLength('original contents'));
    assert.equal(originalRead(file, 'utf8'), 'replacement');
  } finally {
    fs.readFileSync = originalRead;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a pathname replaced with a symlink instead of reading its target', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemaps-fingerprint-'));
  const target = path.join(directory, 'target.json');
  const file = path.join(directory, 'package.json');
  try {
    fs.writeFileSync(target, 'must not be read');
    fs.symlinkSync(target, file);
    assert.throws(() => readFingerprintFile(file, true), { code: 'ELOOP' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
