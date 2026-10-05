/// <reference types="jest" />

import { readFileSync } from 'fs';
import https from 'https';
import { ServerResponse } from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import fetch from 'node-fetch';
import nock from 'nock';
import { fdMonitor } from './fd-monitor';

describe('file descriptor monitor', () => {
  let server: https.Server;
  let previousAgent: https.Agent;
  let endpoint: string;
  let responses: ServerResponse[];
  let requestsReceived: Promise<void>;
  let receiveRequests: () => void;

  beforeEach(async () => {
    // This fixture measures native Agent sockets, not intercepted HTTP sockets.
    nock.restore();
    responses = [];
    requestsReceived = new Promise<void>((resolve) => {
      receiveRequests = resolve;
    });
    // Synthetic test credentials, used only by this loopback HTTPS server.
    server = https.createServer(
      {
        key: readFileSync(path.join(__dirname, 'fixtures', 'localhost.key')),
        cert: readFileSync(path.join(__dirname, 'fixtures', 'localhost.crt')),
      },
      (_request, response) => {
        responses.push(response);
        if (responses.length === 2) receiveRequests();
      },
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
    nock.activate();
  });

  it.each(['manual', 'manualSimple'] as const)(
    '%s counts two active HTTPS requests',
    async (method) => {
      const monitor = new fdMonitor({
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      const requests = Promise.all([
        fetch(endpoint, { agent: https.globalAgent }),
        fetch(endpoint, { agent: https.globalAgent }),
      ]);
      try {
        // Modern HTTP interceptors start requests asynchronously. Keep both
        // responses open until the real sockets are observable.
        await Promise.race([requestsReceived, requests]);
        const stats = monitor[method]();
        expect(stats.socketStatsHttps.all.total).toBe(2);
        expect(stats.socketStatsHttps.all.inUse).toBe(2);
        if ('handleCount' in stats) expect(stats.handleCount).toBeGreaterThan(3);
      } finally {
        try {
          for (const response of responses) response.end('socket monitor fixture');
          const completed = await requests;
          await Promise.all(completed.map(async (response) => response.text()));
        } finally {
          await monitor.shutdownAndFlush();
        }
      }
    },
    15000,
  );
});
