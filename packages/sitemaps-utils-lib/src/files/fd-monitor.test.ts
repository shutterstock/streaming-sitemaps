//fd-monitor.test.ts
/// <reference types="jest" />

import { fdMonitor } from './fd-monitor';
import { createWriteStream } from 'fs';
import { promisify } from 'util';
import { finished } from 'stream';
const finishedAsync = promisify(finished);
import fetch from 'node-fetch';

describe('file descriptor monitor', () => {
  it('manual', async () => {
    const monitor = new fdMonitor({
      // eslint-disable-next-line no-console
      logger: { info: console.info, warn: console.warn, error: console.error },
    });
    // Leave body unread for inUse
    const promise1 = fetch('https://www.example.com');
    // Read body for free
    const promise2 = fetch('https://www.example.com');

    const stats = monitor.manual();

    expect(stats.socketStatsHttps.all.total).toBe(2);
    expect(stats.socketStatsHttps.all.inUse).toBe(2);

    const result1 = await promise1;
    const result2 = await promise2;

    const blackhole1 = createWriteStream('/dev/null');
    result1.body.pipe(blackhole1);
    await finishedAsync(blackhole1);

    const blackhole2 = createWriteStream('/dev/null');
    result2.body.pipe(blackhole2);
    await finishedAsync(blackhole2);

    await monitor.shutdownAndFlush();
  }, 15000);

  it('manualSimple', async () => {
    const monitor = new fdMonitor({
      // eslint-disable-next-line no-console
      logger: { info: console.info, warn: console.warn, error: console.error },
    });
    // Leave body unread for inUse
    const promise1 = fetch('https://www.example.com');
    // Read body for free
    const promise2 = fetch('https://www.example.com');

    const stats = monitor.manualSimple();

    expect(stats.socketStatsHttps.all.total).toBe(2);
    expect(stats.socketStatsHttps.all.inUse).toBe(2);
    expect(stats.handleCount).toBeGreaterThan(3);

    const result1 = await promise1;
    const result2 = await promise2;

    const blackhole1 = createWriteStream('/dev/null');
    result1.body.pipe(blackhole1);
    await finishedAsync(blackhole1);

    const blackhole2 = createWriteStream('/dev/null');
    result2.body.pipe(blackhole2);
    await finishedAsync(blackhole2);

    await monitor.shutdownAndFlush();
  }, 15000);
});
