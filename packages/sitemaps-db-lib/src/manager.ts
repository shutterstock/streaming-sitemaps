import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommandInput,
  BatchGetCommandOutput,
  BatchWriteCommandInput,
  BatchWriteCommandOutput,
  DynamoDBDocument,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBBatch } from './batch';

export interface IDBManager {
  readonly client: DynamoDBClient;
  readonly ddbDocClient: DynamoDBDocument;
}

export class DBManager implements IDBManager {
  private _client: DynamoDBClient;
  private _ddbDocClient: DynamoDBDocument;
  private static DEFAULT_RETRIES = 11;
  private static DEFAULT_RETRY_BASE_DELAY_MS = 2000;
  private readonly _batchOptions: { retries: number; retryBaseDelayMS: number };

  public constructor(opts: {
    client: DynamoDBClient;
    tableName: string;
    batchOptions?: { retries?: number; retryBaseDelayMS?: number };
  }) {
    const { batchOptions } = opts;
    this._batchOptions = {
      retries: batchOptions?.retries ?? DBManager.DEFAULT_RETRIES,
      retryBaseDelayMS: batchOptions?.retryBaseDelayMS ?? DBManager.DEFAULT_RETRY_BASE_DELAY_MS,
    };

    this._client = opts.client;
    this._tableName = opts.tableName;
    this._ddbDocClient = DynamoDBDocument.from(this._client);
  }

  public get client(): DynamoDBClient {
    return this._client;
  }

  public get ddbDocClient(): DynamoDBDocument {
    return this._ddbDocClient;
  }

  public async batchWrite(args: BatchWriteCommandInput): Promise<BatchWriteCommandOutput> {
    return DynamoDBBatch.batchWrite(args, { client: this._ddbDocClient, ...this._batchOptions });
  }

  public async batchGet(args: BatchGetCommandInput): Promise<BatchGetCommandOutput> {
    return DynamoDBBatch.batchGet(args, { client: this._ddbDocClient, ...this._batchOptions });
  }

  private _tableName: string;
  public get tableName(): string {
    return this._tableName;
  }
  public set tableName(value: string) {
    this._tableName = value;
  }
}
