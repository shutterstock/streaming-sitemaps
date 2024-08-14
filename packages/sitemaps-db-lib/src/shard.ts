import { PutCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { DBManager } from './manager';
import { plainToClass } from 'class-transformer';

enum SaveBy {
  Type,
}

/**
 * Represents the state of a Kinesis shard in the system,
 * such as the current file being written to, count of items, creation time, etc.
 *
 * Records are written once using the DynamoDB Single Table pattern for these uses cases:
 *
 * 1. **Single Shard Access** OR **List of Shards Access**:
 *    - PK: shardList#type#[type], SK: shardId#[shardId]
 *    - List of all shards handling a particular type, now or in the past
 *    - Enables enumerating all of the shards for all for a particular type
 *    - Metadata about the state of a particular shard sitemap file writer
 *    - Primarily used to track which sitemap file is being appended to by
 *      a particular shard when using multi-shard sitemap writing
 */
export interface IShardStateRecord {
  PK: string;
  SK: string;

  /**
   * Namespaces the ShardIds (e.g. ShardIds must be unique within a Type)
   */
  readonly Type: string;

  /**
   * ShardId of this Sitemap Writer (namespaced by type since each type goes
   * into it's own file, even if handled by a single sitemap writer instance)
   */
  readonly ShardId: number;

  /**
   * Name of the file, unique within a Type
   */
  readonly CurrentFileName: string;

  /**
   * Count of items in the current file
   */
  readonly CurrentFileItemCount: number;

  /**
   * Count of items written by this shard in total
   */
  readonly TotalItemCount: number;

  /**
   * Count of files created for this shard
   */
  readonly FileCount: number;

  /**
   * ISO timestamp string of when this shard was first seen for this type
   */
  readonly TimeFirstSeenISO: string;

  /**
   * ISO timestamp string of when a file for this shard was last written to S3
   */
  readonly TimeLastWrittenISO: string;
}

export type IShardStateRecordNoKeys = Omit<IShardStateRecord, 'PK' | 'SK'>;
export type IShardStateRecordNoKeysLoose = Partial<
  Omit<IShardStateRecord, 'PK' | 'SK' | 'Type' | 'ShardId'>
> &
  Pick<IShardStateRecord, 'Type' | 'ShardId'>;

export class ShardStateRecord implements IShardStateRecord {
  /**
   * Loads a single shard state record from the database.
   *
   * @param {DBManager} dbManager - The database manager instance.
   * @param {Pick<IShardStateRecord, 'Type' | 'ShardId'>} key - An object containing the 'Type' and 'ShardId' of the shard state record to load.
   * @returns {Promise<ShardStateRecord>} - A promise that resolves to a ShardStateRecord instance.
   *
   * @static
   * @async
   */
  public static async loadOne(
    dbManager: DBManager,
    key: Pick<IShardStateRecord, 'Type' | 'ShardId'>,
  ): Promise<ShardStateRecord> {
    const { Item } = await dbManager.ddbDocClient.get({
      TableName: dbManager.tableName,
      Key: {
        PK: `shardList#type#${key.Type.toLowerCase()}`,
        SK: `shardId#${key.ShardId}`,
      },
      ConsistentRead: true,
    });
    const record = plainToClass<ShardStateRecord, unknown>(ShardStateRecord, Item);
    return record;
  }

  /**
   * Loads all shard state records of a specific type from the database.
   *
   * @param {DBManager} dbManager - The database manager instance.
   * @param {Pick<IShardStateRecord, 'Type'>} key - An object containing the 'Type' of the shard state records to load.
   * @returns {Promise<ShardStateRecord[]>} - A promise that resolves to an array of ShardStateRecord instances.
   *
   * @static
   */
  public static async loadType(
    dbManager: DBManager,
    key: Pick<IShardStateRecord, 'Type'>,
  ): Promise<ShardStateRecord[]> {
    const records = [] as ShardStateRecord[];
    let LastEvaluatedKey:
      | {
          [key: string]: any;
        }
      | undefined = undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result: QueryCommandOutput = await dbManager.ddbDocClient.query({
        TableName: dbManager.tableName,
        KeyConditionExpression: 'PK = :pkval',
        ExpressionAttributeValues: {
          ':pkval': `shardList#type#${key.Type.toLowerCase()}`,
        },
        ExclusiveStartKey: LastEvaluatedKey,
      });
      LastEvaluatedKey = result.LastEvaluatedKey;
      const { Items } = result;

      if (Items !== undefined) {
        for (const item of Items) {
          const record = plainToClass<ShardStateRecord, unknown>(ShardStateRecord, item);
          records.push(record);
        }
      }

      if (LastEvaluatedKey === undefined) {
        break;
      }
    }

    return records;
  }

  private _keyBy: SaveBy;

  /**
   * Creates a new instance of the ShardStateRecord class.
   *
   * @param {IShardStateRecordNoKeysLoose} init - An object containing initial values for the ShardStateRecord.
   */
  public constructor(init: IShardStateRecordNoKeysLoose) {
    this._keyBy = SaveBy.Type;
    this._fileCount = 0;
    this._totalItemCount = 0;
    this._currentFileItemCount = 0;
    this._currentFileName = '';
    this._timeFirstSeenISO = new Date().toISOString();
    this._timeLastWrittenISO = new Date().toISOString();

    // Save any passed in values over the defaults
    Object.assign(this, init);
  }

  public get dbStruct(): IShardStateRecord {
    return {
      PK: this.PK,
      SK: this.SK,
      Type: this.Type,
      ShardId: this.ShardId,
      TotalItemCount: this.TotalItemCount,
      CurrentFileItemCount: this.CurrentFileItemCount,
      FileCount: this.FileCount,
      CurrentFileName: this.CurrentFileName,
      TimeFirstSeenISO: this.TimeFirstSeenISO,
      TimeLastWrittenISO: this.TimeLastWrittenISO,
    };
  }

  /**
   * Saves the current state of the shard to the database.
   *
   * @param {DBManager} dbManager - The database manager instance.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   */
  public async save(dbManager: DBManager): Promise<void> {
    // Validate that all the fields needed are present
    if (this.Type === undefined) {
      throw new TypeError('Type is required');
    }
    if (this.ShardId === undefined) {
      throw new TypeError('ShardId is required');
    }

    // Update the written timestamp
    this.ResetTimeLastWrittenISO();

    const tasks: Promise<PutCommandOutput>[] = [];

    // Save under specific key
    this._keyBy = SaveBy.Type;
    tasks.push(
      dbManager.ddbDocClient.put({
        TableName: dbManager.tableName,
        Item: this.dbStruct,
      }),
    );

    await Promise.all(tasks);

    for (const task of tasks) {
      await task;
    }
  }

  public get PK(): string {
    switch (this._keyBy) {
      case SaveBy.Type:
        return `shardList#type#${this.Type.toLowerCase()}`;
      default:
        throw new Error('Missing SaveBy handler');
    }
  }

  public get SK(): string {
    switch (this._keyBy) {
      case SaveBy.Type:
        return `shardId#${this.ShardId}`;
      default:
        throw new Error('Missing SaveBy handler');
    }
  }

  private _type: string | undefined;
  public get Type(): string {
    return this._type as string;
  }
  private set Type(value: string) {
    this._type = value;
  }

  private _shardId: number | undefined;
  public get ShardId(): number {
    return this._shardId as number;
  }
  private set ShardId(value: number) {
    this._shardId = value;
  }

  private _fileCount: number;
  public get FileCount(): number {
    return this._fileCount as number;
  }
  private set FileCount(value: number) {
    this._fileCount = value;
  }

  private _currentFileItemCount: number;
  public get CurrentFileItemCount(): number {
    return this._currentFileItemCount as number;
  }
  private set CurrentFileItemCount(value: number) {
    this._currentFileItemCount = value;
  }
  public AddFileItem(): void {
    this._currentFileItemCount++;
    this._totalItemCount++;
  }

  private _totalItemCount: number;
  public get TotalItemCount(): number {
    return this._totalItemCount as number;
  }
  private set TotalItemCount(value: number) {
    this._totalItemCount = value;
  }

  private _currentFileName: string;
  public get CurrentFileName(): string {
    return this._currentFileName as string;
  }
  private set CurrentFileName(value: string) {
    this._currentFileName = value;
  }
  /**
   * Record the new file and reset the file items count stat
   * @param filename - Name of the new file
   */
  public ChangeCurrentFile(filename: string): void {
    this._currentFileName = filename;
    this._currentFileItemCount = 0;
    this._fileCount++;
  }

  private _timeFirstSeenISO: string;
  public get TimeFirstSeenISO(): string {
    return this._timeFirstSeenISO as string;
  }
  private set TimeFirstSeenISO(value: string) {
    this._timeFirstSeenISO = value;
  }

  private _timeLastWrittenISO: string;
  public get TimeLastWrittenISO(): string {
    return this._timeLastWrittenISO as string;
  }
  private set TimeLastWrittenISO(value: string) {
    this._timeLastWrittenISO = value;
  }
  public ResetTimeLastWrittenISO(): void {
    this._timeLastWrittenISO = new Date().toISOString();
  }
}
