import 'jest-dynalite/withDb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DBManager, FileRecord } from '@shutterstock/sitemaps-db-lib';

describe('FileRecord tests', () => {
  let client: DynamoDBClient;
  let dbManager: DBManager;

  beforeAll(() => {
    client = new DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
    dbManager = new DBManager({ client, tableName: 'sitemaps' });
  });

  afterAll(() => {
    client.destroy();
  });

  it('should create a new FileRecord', async () => {
    const recordInput = new FileRecord({
      FileName: 'test-file.xml',
      Type: 'test-type',
      FileStatus: 'dirty',
      CountWritten: 1,
    });

    await recordInput.save(dbManager);

    const recordOutput = await FileRecord.loadOne(dbManager, {
      FileName: 'test-file.xml',
      Type: 'test-type',
    });

    expect(recordOutput).toBeDefined();
    expect(recordOutput!.FileName).toEqual(recordInput.FileName);
    expect(recordOutput!.Type).toEqual(recordInput.Type);
  });
});
