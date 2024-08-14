import { PutCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { DBManager } from './manager';
import { plainToClass } from 'class-transformer';

enum SaveBy {
  FileList,
}

/**
 * Status of an Item
 *
 * @written Item is present in the sitemap on S3
 * @dirty Some items have changes, the sitemap should be rewritten
 */
export type FileStatus = 'written' | 'dirty' | 'empty' | 'malformed';

/**
 * `IFileRecord` is an interface that represents a sitemap XML file.
 *
 * Records are written once using the DynamoDB Single Table pattern for these uses cases:
 *
 * 1. **Single File Access** OR **List of Files Access**:
 *    - PK: filelist#type#[type], SK: [filename]
 *    - List of all files in the sitemap index for a particular type
 *    - Enables enumerating all of the records for all of the files in a sitemap index
 *    - Used as the source of record for index file generation / updating
 *    - Metadata about last update time for any item in a particular file
 *      (for identifying which files need to be refreshed)
 *    - Note: We do not need to store this twice with fileName/type as the key
 *      because there are only 50k file names per type and we always know the
 *      type and filename, so we can get one record within an index if we want
 */
export interface IFileRecord {
  readonly PK: string;
  readonly SK: string;

  /**
   * Namespaces the FileNames (e.g. FileNames must be unique within a Type)
   */
  readonly Type: string;

  /**
   * Name of the file, unique within a Type
   */
  readonly FileName: string;

  /**
   * Status of the file
   */
  readonly FileStatus: FileStatus;

  /**
   * Count of items in the written file
   */
  readonly CountWritten: number;

  /**
   * ISO timestamp string of when the item was first recorded
   */
  readonly TimeFirstSeenISO: string;

  /**
   * ISO timestamp string of when the most recent dirtying of an item in the file happened
   */
  readonly TimeDirtiedISO?: string;

  /**
   * ISO timestamp string of when the item was last written to S3
   */
  readonly TimeLastWrittenISO: string;
}
export type IFileRecordNoKeys = Omit<IFileRecord, 'PK' | 'SK'>;

export type IFileRecordNoKeysLoose = Partial<Omit<IFileRecord, 'PK' | 'SK' | 'Type' | 'FileName'>> &
  Pick<IFileRecord, 'Type' | 'FileName'>;

export class FileRecord implements IFileRecord {
  /**
   * Loads a single file record from the database.
   *
   * @static
   * @param {DBManager} dbManager - The database manager to use for loading the file.
   * @param {Pick<IFileRecord, 'Type' | 'FileName'>} key - An object that specifies the type and file name of the file to load.
   * @returns {Promise<FileRecord>} A promise that resolves to the loaded file record.
   * @throws {Error} If the file record is not found in the database, an Error is thrown.
   */
  public static async loadOne(
    dbManager: DBManager,
    key: Pick<IFileRecord, 'Type' | 'FileName'>,
  ): Promise<FileRecord> {
    const { Item } = await dbManager.ddbDocClient.get({
      TableName: dbManager.tableName,
      Key: {
        PK: `fileList#type#${key.Type.toLowerCase()}`,
        SK: `fileName#${key.FileName.toLowerCase()}`,
      },
      ConsistentRead: true,
    });
    const record = plainToClass<FileRecord, unknown>(FileRecord, Item);
    return record;
  }

  /**
   * Loads all file records of a specific type from the database.
   *
   * @static
   * @param {DBManager} dbManager - The database manager to use for loading the files.
   * @param {Pick<IFileRecord, 'Type'>} key - An object that specifies the type of the files to load.
   * @returns {Promise<FileRecord[]>} A promise that resolves to an array of the loaded file records.
   * @throws {Error} If there are any issues during the database query operation, an Error is thrown.
   *
   * This method uses a loop to continuously query the database until all records of the specified type have been loaded.
   * It uses the `LastEvaluatedKey` from the previous query as the `ExclusiveStartKey` for the next query to ensure that all records are loaded.
   * The loaded records are converted from plain objects to `FileRecord` instances using the `plainToClass` function before being added to the returned array.
   */
  public static async loadType(
    dbManager: DBManager,
    key: Pick<IFileRecord, 'Type'>,
  ): Promise<FileRecord[]> {
    const records = [] as FileRecord[];
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
          ':pkval': `fileList#type#${key.Type.toLowerCase()}`,
        },
        ExclusiveStartKey: LastEvaluatedKey,
      });
      LastEvaluatedKey = result.LastEvaluatedKey;
      const { Items } = result;

      if (Items !== undefined) {
        for (const item of Items) {
          const record = plainToClass<FileRecord, unknown>(FileRecord, item);
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
   * Constructs a new FileRecord instance.
   *
   * @param {IFileRecordNoKeysLoose} [init] - An optional object containing initial values for the file record. If provided, these values will override the default values.
   *
   * The default values are:
   * - `keyBy` is set to `SaveBy.FileList`.
   * - `timeFirstSeenISO` and `timeLastWrittenISO` are set to the current date and time in ISO format.
   * - `fileStatus` is set to `'empty'`.
   * - `countWritten` is set to `0`.
   */
  public constructor(init?: IFileRecordNoKeysLoose) {
    this._keyBy = SaveBy.FileList;
    this._timeFirstSeenISO = new Date().toISOString();
    this._timeLastWrittenISO = new Date().toISOString();
    this._fileStatus = 'empty';
    this._countWritten = 0;

    // Save any passed in values over the defaults
    Object.assign(this, init);
  }

  public get dbStruct(): IFileRecord {
    const record: IFileRecord = {
      PK: this.PK,
      SK: this.SK,
      Type: this.Type,
      FileName: this.FileName,
      FileStatus: this.FileStatus,
      CountWritten: this.CountWritten,
      TimeFirstSeenISO: this.TimeFirstSeenISO,
      TimeLastWrittenISO: this.TimeLastWrittenISO,
      ...(this.TimeDirtiedISO !== undefined && {
        TimeDirtiedISO: this.TimeDirtiedISO,
      }),
    };

    return record;
  }

  /**
   * Saves the current file record to the database.
   *
   * @param {DBManager} dbManager - The database manager to use for saving the file.
   * @returns {Promise<void>} A promise that resolves when the file record has been saved.
   * @throws {TypeError} If the `Type` or `FileName` fields are `undefined`, a TypeError is thrown.
   * @throws {Error} If there are any issues during the database write operation, an Error is thrown.
   *
   * This method first validates that the `Type` and `FileName` fields are present.
   * If the file status is 'empty' and the write count is greater than 0, it sets the file status to 'written'.
   * If the file status is not 'malformed', it resets the last written timestamp.
   * It then saves the file record to the database under a specific key.
   * The method waits for all database write operations to complete before resolving.
   */
  public async save(dbManager: DBManager): Promise<void> {
    // Validate that all the fields needed are present
    if (this.Type === undefined) {
      throw new TypeError('Type is required');
    }
    if (this.FileName === undefined) {
      throw new TypeError('FileName is required');
    }

    if (this._fileStatus === 'empty' && this._countWritten > 0) {
      this._fileStatus = 'written';
    }

    // Update that we wrote this now
    // If the file is malformed we don't update the timestamp since we can't write the file
    if (this._fileStatus !== 'malformed') {
      this.ResetTimeLastWrittenISO();
    }

    const tasks: Promise<PutCommandOutput>[] = [];

    // Save under specific key
    this._keyBy = SaveBy.FileList;
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
      case SaveBy.FileList:
        return `fileList#type#${this.Type.toLowerCase()}`;
      default:
        throw new Error('Missing SaveBy handler');
    }
  }

  public get SK(): string {
    switch (this._keyBy) {
      case SaveBy.FileList:
        return `fileName#${this.FileName.toLowerCase()}`;
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

  private _fileName: string | undefined;
  public get FileName(): string {
    return this._fileName as string;
  }
  private set FileName(value: string) {
    this._fileName = value;
  }

  private _fileStatus: FileStatus | undefined;
  public get FileStatus(): FileStatus {
    return this._fileStatus as FileStatus;
  }
  private set FileStatus(value: FileStatus) {
    this._fileStatus = value;
  }
  public MarkAsMalformed(): void {
    this._timeDirtiedISO = new Date().toISOString();
    this._fileStatus = 'malformed';
  }

  private _countWritten: number;
  public get CountWritten(): number {
    return this._countWritten as number;
  }
  public set CountWritten(value: number) {
    this._countWritten = value;
  }
  public AddFileItem(): void {
    this._countWritten++;
  }
  public RemoveFileItem(): void {
    this._countWritten--;
  }

  private _timeFirstSeenISO: string | undefined;
  public get TimeFirstSeenISO(): string {
    return this._timeFirstSeenISO as string;
  }
  private set TimeFirstSeenISO(value: string) {
    this._timeFirstSeenISO = value;
  }

  private _timeDirtiedISO: string | undefined;
  public get TimeDirtiedISO(): string {
    return this._timeDirtiedISO as string;
  }
  private set TimeDirtiedISO(value: string) {
    this._timeDirtiedISO = value;
  }
  public ResetTimeDirtiedISO(): void {
    this._timeDirtiedISO = new Date().toISOString();
    this._fileStatus = 'dirty';
  }
  public ClearTimeDirtiedISO(): void {
    delete this._timeDirtiedISO;

    if (this._countWritten === 0) {
      this._fileStatus = 'empty';
    } else {
      this._fileStatus = 'written';
    }
  }

  private _timeLastWrittenISO: string | undefined;
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
