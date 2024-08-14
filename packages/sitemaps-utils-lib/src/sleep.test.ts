//sleep.test.ts
/// <reference types="jest" />
import { sleep } from './sleep';

describe('sleep', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('can complete', async () => {
    const timer = new sleep(10);
    await timer.done;
  });

  it('can cancel', (done) => {
    const timer = new sleep(1000);
    timer.cancel();
    timer.done.catch(() => {
      done();
    });
  });
});
