/// <reference types="jest" />

import { readFileSync } from 'fs';
import https from 'https';
import { AddressInfo } from 'net';
import path from 'path';
import fetch from 'node-fetch';
import { fdMonitor } from './fd-monitor';

describe('file descriptor monitor', () => {
  let server: https.Server;
  let previousAgent: https.Agent;
  let endpoint: string;

  beforeEach(async () => {
    // Synthetic test credentials, used only by this loopback HTTPS server.
    server = https.createServer(
      {
        key: readFileSync(path.join(__dirname, 'fixtures', 'localhost.key')),
        cert: readFileSync(path.join(__dirname, 'fixtures', 'localhost.crt')),
      },
      (_request, response) => response.end('socket monitor fixture'),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    previousAgent = https.globalAgent;
    // Isolate counts from earlier suites and Node 24's default keep-alive agent.
    https.globalAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });
  });

  afterEach(async () => {
    https.globalAgent.destroy();
    https.globalAgent = previousAgent;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it.each(['manual', 'manualSimple'] as const)(
    '%s counts two active HTTPS requests',
    async (method) => {
      const monitor = new fdMonitor({
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      try {
        const requests = [fetch(endpoint), fetch(endpoint)];
        const stats = monitor[method]();
        expect(stats.socketStatsHttps.all.total).toBe(2);
        expect(stats.socketStatsHttps.all.inUse).toBe(2);
        if ('handleCount' in stats) expect(stats.handleCount).toBeGreaterThan(3);
        const responses = await Promise.all(requests);
        await Promise.all(responses.map(async (response) => response.text()));
      } finally {
        await monitor.shutdownAndFlush();
      }
    },
    15000,
  );
});
