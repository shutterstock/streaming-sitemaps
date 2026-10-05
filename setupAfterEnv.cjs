const nock = require('nock');
const { stopDb } = require('jest-dynalite');

// Jest isolates module registries, while HTTP interceptors patch shared Node
// builtins. Dispose each suite's interceptor before another registry loads it.
afterAll(async () => {
  try {
    // setupBeforeEnv starts a private server for every suite. withDb's own stop
    // hook remains safe to call again after this shared teardown.
    await stopDb();
  } finally {
    nock.cleanAll();
    nock.restore();
  }
});

// oclif Command.catch sets the shared process.exitCode even when a test
// correctly expects the command to reject. Restore that deliberate test side
// effect; Jest decides its own exit status from failed tests.
let exitCode;
beforeEach(() => {
  exitCode = process.exitCode;
});
afterEach(() => {
  process.exitCode = exitCode;
});
