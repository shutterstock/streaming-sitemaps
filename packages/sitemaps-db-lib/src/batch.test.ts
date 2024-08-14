/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
//index.test.ts
/// <reference types="jest" />
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { DBManager } from './manager';
import { inspect } from 'util';

describe('batch get/write', () => {
  let dynamoClient: AwsClientStub<dynamodb.DynamoDBClient>;
  let ddbMock: AwsClientStub<DynamoDBDocumentClient>;

  let dbManager: DBManager;
  const tableName = 'test-table';

  beforeAll(() => {
    // console.log(`endpoint: ${process.env.MOCK_DYNAMODB_ENDPOINT}`);
  });

  beforeEach(() => {
    dynamoClient = mockClient(dynamodb.DynamoDBClient);
    ddbMock = mockClient(DynamoDBDocumentClient);
    dbManager = new DBManager({
      client: new dynamodb.DynamoDBClient({
        maxAttempts: 2,
      }),
      tableName,
      batchOptions: {
        retries: 2,
        retryBaseDelayMS: 10,
      },
    });
  });

  describe('batchGet', () => {
    it('handles 1', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(
          BatchGetCommand,
          {
            RequestItems: {
              [tableName]: {
                Keys: [{ PK: { S: 'key1' } }],
              },
            },
          },
          false,
        )
        .resolves({
          Responses: {
            [tableName]: [
              {
                PK: { S: 'key1' },
                CatName: { S: 'cat1' },
              },
            ],
          },
        });

      const result = await dbManager.batchGet({
        RequestItems: {
          [tableName]: {
            Keys: [
              {
                PK: { S: 'key1' },
              },
            ],
          },
        },
      });

      expect(ddbMock.calls().length).toBe(1);

      expect(result.UnprocessedKeys).toBeUndefined();

      expect(result.Responses).toBeDefined();
      expect(result.Responses![tableName]!).toBeDefined();
      expect(result.Responses![tableName]!.length).toBe(1);
      expect(result.Responses![tableName]![0]).toBeDefined();
      expect(result.Responses![tableName]![0].PK.S).toBe('key1');
      expect(result.Responses![tableName]![0].CatName.S).toBe('cat1');
    });

    it('handles 1 - with UnprocessedKeys', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(BatchGetCommand, {
          RequestItems: {
            [tableName]: {
              Keys: [{ PK: { S: 'key1' } }],
            },
          },
        })
        .resolvesOnce({
          UnprocessedKeys: {
            [tableName]: {
              Keys: [{ PK: { S: 'key1' } }],
            },
          },
        })
        .resolvesOnce({
          Responses: {
            [tableName]: [
              {
                PK: { S: 'key1' },
                CatName: { S: 'cat1' },
              },
            ],
          },
        })
        .rejects();

      const result = await dbManager.batchGet({
        RequestItems: {
          [tableName]: {
            Keys: [
              {
                PK: { S: 'key1' },
              },
            ],
          },
        },
      });

      expect(ddbMock.calls().length).toBe(2);

      expect(result.UnprocessedKeys).toBeUndefined();

      expect(result.Responses).toBeDefined();
      expect(result.Responses![tableName]!).toBeDefined();
      expect(result.Responses![tableName]!.length).toBe(1);
      expect(result.Responses![tableName]![0]).toBeDefined();
      expect(result.Responses![tableName]![0].PK.S).toBe('key1');
      expect(result.Responses![tableName]![0].CatName.S).toBe('cat1');
    }, 60000);

    it('handles 1 - always fails to get', async () => {
      dynamoClient.onAnyCommand().rejects();
      const inputRecords = {
        RequestItems: {
          [tableName]: {
            Keys: [{ PK: { S: 'key1' } }],
          },
        },
      };
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .rejects()
        .on(BatchGetCommand, inputRecords)
        .resolves({
          UnprocessedKeys: {
            [tableName]: {
              Keys: [{ PK: { S: 'key1' } }],
            },
          },
        });

      const result = await dbManager.batchGet({
        RequestItems: {
          [tableName]: {
            Keys: [
              {
                PK: { S: 'key1' },
              },
            ],
          },
        },
      });

      expect(ddbMock.calls().length).toBe(4);

      expect(result.UnprocessedKeys).toBeDefined();
      expect(result.UnprocessedKeys).toEqual(inputRecords.RequestItems);
    }, 60000);

    it('handles 2 - 1 always fails to get', async () => {
      dynamoClient.onAnyCommand().rejects();
      const inputRecords = {
        RequestItems: {
          [tableName]: {
            Keys: [{ PK: { S: 'key1' } }, { PK: { S: 'key2' } }],
          },
        },
      };
      const inputRecordsRetry = {
        RequestItems: {
          [tableName]: {
            Keys: inputRecords.RequestItems[tableName].Keys.slice(1),
          },
        },
      };
      const resultRecords = {
        Responses: {
          [tableName]: [
            {
              PK: { S: 'key1' },
              CatName: { S: 'cat1' },
            },
          ],
        },
      };
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .rejects()
        .on(BatchGetCommand, inputRecords)
        .resolvesOnce({
          UnprocessedKeys: {
            [tableName]: {
              Keys: [{ PK: { S: 'key2' } }],
            },
          },
          Responses: resultRecords.Responses,
        })
        .on(BatchGetCommand, inputRecordsRetry)
        .resolves({
          UnprocessedKeys: {
            [tableName]: {
              Keys: [{ PK: { S: 'key2' } }],
            },
          },
        });

      const result = await dbManager.batchGet({
        RequestItems: {
          [tableName]: {
            Keys: [{ PK: { S: 'key1' } }, { PK: { S: 'key2' } }],
          },
        },
      });

      expect(ddbMock.calls().length).toBe(4);

      expect(result.UnprocessedKeys).toBeDefined();
      expect(result.UnprocessedKeys).toEqual(inputRecordsRetry.RequestItems);
      expect(result.Responses).toBeDefined();
      expect(result.Responses).toEqual(resultRecords.Responses);
    }, 60000);

    it('handles 2 - split by UnprocessedKeys - same table', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(BatchGetCommand, {
          RequestItems: {
            [tableName]: {
              Keys: [{ PK: { S: 'key1' } }, { PK: { S: 'key2' } }],
            },
          },
        })
        .resolvesOnce({
          UnprocessedKeys: {
            [tableName]: {
              Keys: [{ PK: { S: 'key2' } }],
            },
          },
          Responses: {
            [tableName]: [
              {
                PK: { S: 'key1' },
                CatName: { S: 'cat1' },
              },
            ],
          },
        })
        .on(BatchGetCommand, {
          RequestItems: {
            [tableName]: {
              Keys: [{ PK: { S: 'key2' } }],
            },
          },
        })
        .resolvesOnce({
          Responses: {
            [tableName]: [
              {
                PK: { S: 'key2' },
                CatName: { S: 'cat2' },
              },
            ],
          },
        });

      const result = await dbManager.batchGet({
        RequestItems: {
          [tableName]: {
            Keys: [
              {
                PK: { S: 'key1' },
              },
              {
                PK: { S: 'key2' },
              },
            ],
          },
        },
      });

      expect(ddbMock.calls().length).toBe(2);

      expect(result.UnprocessedKeys).toBeUndefined();

      expect(result.Responses).toBeDefined();
      expect(result.Responses![tableName]!).toBeDefined();
      expect(result.Responses![tableName]!.length).toBe(2);

      // 1st record
      expect(result.Responses![tableName]![0]).toBeDefined();
      expect(result.Responses![tableName]![0].PK.S).toBe('key1');
      expect(result.Responses![tableName]![0].CatName.S).toBe('cat1');

      // 2nd record
      expect(result.Responses![tableName]![1]).toBeDefined();
      expect(result.Responses![tableName]![1].PK.S).toBe('key2');
      expect(result.Responses![tableName]![1].CatName.S).toBe('cat2');
    }, 60000);
  });

  describe('batchWrite', () => {
    it('handles 1', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(BatchWriteCommand, {
          RequestItems: {
            [tableName]: [
              {
                PutRequest: { Item: [{ PK: { S: 'key1' } }] },
              },
            ],
          },
        })
        .resolvesOnce({});

      const result = await dbManager.batchWrite({
        RequestItems: {
          [tableName]: [
            {
              PutRequest: { Item: [{ PK: { S: 'key1' } }] },
            },
          ],
        },
      });

      expect(result.UnprocessedItems).toBeUndefined();
      expect(ddbMock.calls().length).toBe(1);
    });

    it('handles 1 - always fails to write', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(
          BatchWriteCommand,
          {
            RequestItems: {
              [tableName]: [
                {
                  PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
                },
              ],
            },
          },
          false,
        )
        .resolves({
          UnprocessedItems: {
            [tableName]: [
              { PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] } },
            ],
          },
        });

      const result = await dbManager.batchWrite({
        RequestItems: {
          [tableName]: [
            {
              PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
            },
          ],
        },
      });

      expect(ddbMock.calls().length).toBe(3);

      expect(result.UnprocessedItems).toBeDefined();
      expect(result.UnprocessedItems![tableName].length).toBe(1);
      expect(result.UnprocessedItems).toEqual({
        [tableName]: [{ PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] } }],
      });
    });

    it('handles 1 - with UnprocessedItems', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(
          BatchWriteCommand,
          {
            RequestItems: {
              [tableName]: [
                {
                  PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
                },
              ],
            },
          },
          false,
        )
        .resolvesOnce({
          UnprocessedItems: {
            [tableName]: [
              { PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] } },
            ],
          },
        })
        .resolvesOnce({});

      const result = await dbManager.batchWrite({
        RequestItems: {
          [tableName]: [
            {
              PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
            },
          ],
        },
      });

      expect(ddbMock.calls().length).toBe(2);

      expect(result.UnprocessedItems).toBeUndefined();
    });

    it('handles 2 - split by UnprocessedItems - same table', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(
          BatchWriteCommand,
          {
            RequestItems: {
              [tableName]: [
                {
                  PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
                },
                {
                  PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] },
                },
              ],
            },
          },
          false,
        )
        .resolvesOnce({
          UnprocessedItems: {
            [tableName]: [
              { PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] } },
            ],
          },
        })
        .on(
          BatchWriteCommand,
          {
            RequestItems: {
              [tableName]: [
                {
                  PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] },
                },
              ],
            },
          },
          false,
        )
        .resolvesOnce({});

      const result = await dbManager.batchWrite({
        RequestItems: {
          [tableName]: [
            {
              PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
            },
            {
              PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] },
            },
          ],
        },
      });

      expect(ddbMock.calls().length).toBe(2);

      expect(result.UnprocessedItems).toBeUndefined();
    });

    it('handles 2 - 1 always fails to write - same table', async () => {
      dynamoClient.onAnyCommand().rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
        })
        .on(
          BatchWriteCommand,
          {
            RequestItems: {
              [tableName]: [
                {
                  PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
                },
                {
                  PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] },
                },
              ],
            },
          },
          false,
        )
        .resolvesOnce({
          UnprocessedItems: {
            [tableName]: [
              { PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] } },
            ],
          },
        })
        .on(
          BatchWriteCommand,
          {
            RequestItems: {
              [tableName]: [
                {
                  PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] },
                },
              ],
            },
          },
          false,
        )
        .resolves({
          UnprocessedItems: {
            [tableName]: [
              { PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] } },
            ],
          },
        });

      const result = await dbManager.batchWrite({
        RequestItems: {
          [tableName]: [
            {
              PutRequest: { Item: [{ PK: { S: 'key1' }, CatName: { S: 'cat1' } }] },
            },
            {
              PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] },
            },
          ],
        },
      });

      expect(ddbMock.calls().length).toBe(3);

      expect(result.UnprocessedItems).toBeDefined();
      expect(result.UnprocessedItems![tableName].length).toBe(1);
      expect(result.UnprocessedItems).toEqual({
        [tableName]: [{ PutRequest: { Item: [{ PK: { S: 'key2' }, CatName: { S: 'cat2' } }] } }],
      });
    });
  });
});
