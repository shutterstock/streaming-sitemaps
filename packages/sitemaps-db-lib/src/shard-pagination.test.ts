/// <reference types="jest" />
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DBManager } from './manager';
import { ShardStateRecord } from './shard';

it('continues through an empty query page and hydrates subsequent shard state', async () => {
  const client = new DynamoDBClient({ region: 'test' });
  const mock = mockClient(DynamoDBDocumentClient);
  const firstKey = { PK: 'shardList#type#widget', SK: 'shardId#1' };
  const secondKey = { PK: 'shardList#type#widget', SK: 'shardId#2' };
  mock
    .on(QueryCommand)
    .resolvesOnce({ Items: [], LastEvaluatedKey: firstKey })
    .resolvesOnce({ LastEvaluatedKey: secondKey })
    .resolvesOnce({
      Items: [
        new ShardStateRecord({
          Type: 'widget',
          ShardId: 3,
          FileCount: 2,
          TotalItemCount: 9,
          CurrentFileName: 'last.xml',
        }).dbStruct,
      ],
    });
  try {
    const records = await ShardStateRecord.loadType(new DBManager({ client, tableName: 'table' }), {
      Type: 'WIDGET',
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toBeInstanceOf(ShardStateRecord);
    expect(records[0].CurrentFileName).toBe('last.xml');
    const requests = mock.commandCalls(QueryCommand).map((call) => call.args[0].input);
    expect(requests.map((request) => request.ExclusiveStartKey)).toEqual([
      undefined,
      firstKey,
      secondKey,
    ]);
    expect(
      requests.every(
        (request) => request.ExpressionAttributeValues?.[':pkval'] === 'shardList#type#widget',
      ),
    ).toBe(true);
  } finally {
    mock.restore();
    client.destroy();
  }
});

it('rotation resets current-file counts and preserves cumulative shard counts', () => {
  const state = new ShardStateRecord({ Type: 'widget', ShardId: 0 });
  state.ChangeCurrentFile('first.xml');
  state.AddFileItem();
  state.AddFileItem();
  state.ChangeCurrentFile('second.xml');
  expect(state.CurrentFileItemCount).toBe(0);
  expect(state.TotalItemCount).toBe(2);
  state.AddFileItem();
  expect(state.dbStruct).toMatchObject({
    SK: 'shardId#0',
    FileCount: 2,
    CurrentFileItemCount: 1,
    TotalItemCount: 3,
    CurrentFileName: 'second.xml',
  });
});
