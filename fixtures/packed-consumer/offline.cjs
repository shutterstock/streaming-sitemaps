// Installation may use the public registry; installed CLI executions must be offline.
require('node:assert/strict').equal(
  process.env.NODE_PATH,
  undefined,
  'No NODE_PATH in CLI execution',
);
const fail = () => {
  throw new Error('Packaged CLI attempted a network connection');
};
for (const name of ['http', 'https']) {
  const module = require(name);
  module.request = fail;
  module.get = fail;
}
const net = require('net');
net.connect = net.createConnection = net.Socket.prototype.connect = fail;
globalThis.fetch = fail;
