const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { listenLocalRegistry } = require('./listen-local-registry.cjs');

test('rejects asynchronous bind failures so the caller reaches cleanup', async () => {
  const server = new EventEmitter();
  const failure = Object.assign(new Error('listen EPERM'), { code: 'EPERM' });
  server.listen = (port, host) => {
    assert.equal(port, 0);
    assert.equal(host, '127.0.0.1');
    process.nextTick(() => server.emit('error', failure));
  };
  let cleaned = false;
  await assert.rejects(async () => {
    try {
      await listenLocalRegistry(server);
    } finally {
      cleaned = true;
    }
  }, failure);
  assert.equal(cleaned, true);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});

test('resolves successful startup and removes the startup error listener', async () => {
  const server = new EventEmitter();
  server.listen = () => process.nextTick(() => server.emit('listening'));
  await listenLocalRegistry(server);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});
