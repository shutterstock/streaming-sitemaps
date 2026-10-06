const fs = require('node:fs');

// Open without following a replacement symlink. Metadata and contents must
// describe the same opened file even if its pathname changes during the read.
function readFingerprintFile(file, includeContents) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    const contents = includeContents ? fs.readFileSync(descriptor) : undefined;
    return { stat, contents };
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { readFingerprintFile };
