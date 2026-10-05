/// <reference types="jest" />
import type { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBBatch as BatchClass } from './batch';

// batch.ts captures setTimeout when it creates the promisified sleeper.
// Load it after fake timers are installed so retries require no real waiting.
let DynamoDBBatch: typeof BatchClass;
beforeAll(() => {
  jest.useFakeTimers();
  jest.isolateModules(() => {
    DynamoDBBatch = jest.requireActual('./batch').DynamoDBBatch;
  });
});
beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  jest.useRealTimers();
});

describe('bounded batch retries', () => {
  it.each([0, 1, 2])('batchGet makes one initial request plus %s retries', async (retries) => {
    const pending = { table: { Keys: [{ PK: 'remaining' }] } };
    const batchGet = jest.fn().mockResolvedValue({ UnprocessedKeys: pending, $metadata: {} });
    const result = DynamoDBBatch.batchGet(
      { RequestItems: pending },
      { client: { batchGet } as unknown as DynamoDBDocument, retries, retryBaseDelayMS: 10 },
    );
    await jest.runAllTimersAsync();
    expect((await result).UnprocessedKeys).toEqual(pending);
    expect(batchGet).toHaveBeenCalledTimes(retries + 1);
  });

  it.each([0, 1, 2])('batchWrite makes one initial request plus %s retries', async (retries) => {
    const pending = { table: [{ PutRequest: { Item: { PK: 'remaining' } } }] };
    const batchWrite = jest.fn().mockResolvedValue({ UnprocessedItems: pending, $metadata: {} });
    const result = DynamoDBBatch.batchWrite(
      { RequestItems: pending },
      { client: { batchWrite } as unknown as DynamoDBDocument, retries, retryBaseDelayMS: 10 },
    );
    await jest.runAllTimersAsync();
    expect((await result).UnprocessedItems).toEqual(pending);
    expect(batchWrite).toHaveBeenCalledTimes(retries + 1);
  });

  it('retries only pending keys, accumulating responses across tables and empty pages', async () => {
    const pending = { first: { Keys: [{ PK: 'two' }] }, second: { Keys: [{ PK: 'three' }] } };
    const batchGet = jest
      .fn()
      .mockResolvedValueOnce({ Responses: { first: [{ PK: 'one' }] }, UnprocessedKeys: pending })
      .mockResolvedValueOnce({ UnprocessedKeys: pending })
      .mockResolvedValueOnce({
        Responses: { first: [{ PK: 'two' }], second: [{ PK: 'three' }] },
        UnprocessedKeys: {},
      });
    const result = DynamoDBBatch.batchGet(
      { RequestItems: { first: { Keys: [{ PK: 'one' }, { PK: 'two' }] }, second: pending.second } },
      { client: { batchGet } as unknown as DynamoDBDocument, retries: 2, retryBaseDelayMS: 10 },
    );
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({
      Responses: { first: [{ PK: 'one' }, { PK: 'two' }], second: [{ PK: 'three' }] },
    });
    expect((await result).UnprocessedKeys).toBeUndefined();
    expect(batchGet).toHaveBeenCalledTimes(3);
  });

  it('returns success without scheduling a retry', async () => {
    const batchGet = jest.fn().mockResolvedValue({ Responses: { table: [] } });
    await DynamoDBBatch.batchGet(
      { RequestItems: {} },
      { client: { batchGet } as unknown as DynamoDBDocument, retries: 2 },
    );
    expect(jest.getTimerCount()).toBe(0);
    expect(batchGet).toHaveBeenCalledTimes(1);
  });

  it.each(['batchGet', 'batchWrite'] as const)(
    '%s propagates transport failures without another request',
    async (method) => {
      const failure = new Error('transport failed');
      const request = jest.fn().mockRejectedValue(failure);
      await expect(
        DynamoDBBatch[method](
          { RequestItems: {} },
          { client: { [method]: request } as unknown as DynamoDBDocument, retries: 2 },
        ),
      ).rejects.toBe(failure);
      expect(request).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each(['batchGet', 'batchWrite'] as const)(
    '%s validates inputs without sending',
    async (method) => {
      const request = jest.fn();
      const client = { [method]: request } as unknown as DynamoDBDocument;
      await expect(DynamoDBBatch[method]({ RequestItems: undefined }, { client })).rejects.toThrow(
        'Records',
      );
      await expect(
        DynamoDBBatch[method]({ RequestItems: {} }, { client, retries: -1 }),
      ).rejects.toThrow('retries');
      await expect(
        DynamoDBBatch[method]({ RequestItems: {} }, { client, retryBaseDelayMS: -1 }),
      ).rejects.toThrow('retryBaseDelayMS');
      expect(request).not.toHaveBeenCalled();
    },
  );
});
