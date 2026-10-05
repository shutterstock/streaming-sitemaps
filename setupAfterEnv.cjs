const nock = require('nock');

// Jest isolates module registries, while HTTP interceptors patch shared Node
// builtins. Dispose each suite's interceptor before another registry loads it.
afterAll(() => {
  nock.cleanAll();
  nock.restore();
});
