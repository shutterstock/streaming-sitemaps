//heapdump.test.ts
/// <reference types="jest" />

import { promisify } from 'util';
import { heapdump } from './heap-dump';
const sleep = promisify(setTimeout);

describe('heapdump', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('do not take a dump', async () => {
    const dumper = new heapdump({});

    const result = await dumper.shutdownAndFlush();
    expect(result).toBe(false);
  });

  it.skip('do take a dump', async () => {
    const dumper = new heapdump({ dumpAtBytes: 1024, intervalMS: 10 });

    await sleep(10);

    const result = await dumper.shutdownAndFlush();
    expect(result).toBe(true);
  }, 30000);
});
