const { setup } = require('jest-dynalite');
// The pinned test helper exposes its server here; bind it before suites create
// clients so separate worktrees cannot contend for the former fixed port 8001.
const { dynaliteInstance } = require('jest-dynalite/dist/db');

module.exports = async () => {
  await new Promise((resolve, reject) => {
    dynaliteInstance.once('error', reject);
    dynaliteInstance.listen(0, () => {
      dynaliteInstance.removeListener('error', reject);
      resolve();
    });
  });
  const address = dynaliteInstance.address();
  process.env.MOCK_DYNAMODB_PORT = String(address.port);
  setup(__dirname);
};
