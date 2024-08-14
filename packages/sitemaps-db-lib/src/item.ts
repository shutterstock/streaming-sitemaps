import {
  BatchGetCommandInput,
  PutCommandOutput,
  BatchWriteCommandInput,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { DBManager } from './manager';
import { plainToClass } from 'class-transformer';
import { SitemapItemLoose } from 'sitemap';

enum SaveBy {
  FileName,
  ItemID,
}

/**
 * Status of an Item
 *
 * @written Item is present in the sitemap on S3
 * @towrite Item was removed but now should be readded to the sitemap
 * @toremove Item was present in the sitemap, but now should be removed from the sitemap
 * @removed Item is no longer present in the sitemap on S3
 */
export type ItemStatus = 'written' | 'towrite' | 'toremove' | 'removed';

/**
 * `IItemRecord` is an interface that represents a record for a sitemap item.
 *
 * This record contains the sitemap item to be written to the XML sitemap as
 * well as metadata about the item, the state of the item, and known state of
 * the item in the sitemap file (e.g. deleted, to be deleted, etc.).
 *
 * Records are written twice using the DynamoDB Single Table pattern for these uses cases:
 *
 * 1. **Single Item Access**:
 *    - PK: `itemID#[itemID]#type#[type]`, SK: `'item'`
 *    - This is used to access data for a particular item id in a sitemap of a particular type.
 *    - It also provides metadata about the item state.
 *    - It is used to find which file a given item is in when reading the data stream.
 *    - In our usage, `itemID` is defined as `type:[type]:id\:[id]`.
 *
 * 2. **List per File Access**:
 *    - PK: `fileName#[filename]#type#[type]`, SK: `id:[id]`
 *    - This is used to access a list of items in a sitemap.
 *    - It also provides metadata about the item state.
 *    - It is used to refresh the data in a given sitemap file.
 */
export interface IItemRecord {
  readonly PK: string;
  readonly SK: string;

  /**
   * Namespaces the ItemIDs (e.g. ItemIDs must be unique within a Type)
   */
  readonly Type: string;

  /**
   * Consumer provided ItemID that is unique within a Type
   */
  readonly ItemID: string;

  /**
   * Name of the file, unique within a Type
   */
  readonly FileName: string;

  /**
   * written - Sitemap data present in the file on S3
   * towrite - The most up to date data for the item, newer than what is on S3
   * toremove - The most up to date data for the item, possibly newer than what is on S3
   * removed - The most up to date data for the item at the time it was removed from the sitemap written to S3
   */
  readonly SitemapItem: SitemapItemLoose;

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

  /**
   * Status of the item
   */
  readonly ItemStatus: ItemStatus;
}
export type IItemRecordNoKeys = Omit<IItemRecord, 'PK' | 'SK'>;
export type IItemRecordNoKeysLoose = Partial<
  Omit<IItemRecord, 'PK' | 'SK' | 'Type' | 'ItemID' | 'FileName' | 'SitemapItem'>
> &
  Pick<IItemRecord, 'Type' | 'ItemID' | 'FileName' | 'SitemapItem'>;

const FieldsWithoutSitemapItem: string[] = [
  'PK',
  'SK',
  'Type',
  'ItemID',
  'FileName',
  'TimeFirstSeenISO',
  'TimeDirtiedISO',
  'TimeLastWrittenISO',
  'ItemStatus',
];

/**
 * @inheritdoc IItemRecord
 */
export class ItemRecord implements IItemRecord {
  /**
   * Loads a single item record from the database.
   *
   * @static
   * @param {DBManager} dbManager - The database manager to use for loading the item.
   * @param {Pick<IItemRecord, 'Type' | 'ItemID'>} key - An object that specifies the type and ID of the item to load.
   * @param {boolean} [includeSitemapItem=false] - A flag that indicates whether to include the sitemap item in the loaded item. Defaults to `false`.
   * @param {boolean} [consistentRead=false] - A flag that indicates whether to use consistent read when loading the item. Defaults to `false`.
   * @returns {Promise<ItemRecord>} A promise that resolves to the loaded item record.
   */
  public static async loadOne(
    dbManager: DBManager,
    key: Pick<IItemRecord, 'Type' | 'ItemID'>,
    includeSitemapItem = false,
    consistentRead = false,
  ): Promise<ItemRecord> {
    const fields = FieldsWithoutSitemapItem.slice();
    if (includeSitemapItem) fields.push('SitemapItem');
    const { Item } = await dbManager.ddbDocClient.get({
      TableName: dbManager.tableName,
      Key: {
        PK: `itemID#${key.ItemID.toLowerCase()}#type#${key.Type.toLowerCase()}`,
        SK: 'item',
      },
      AttributesToGet: fields,
      ConsistentRead: consistentRead,
    });
    const record = plainToClass<ItemRecord, unknown>(ItemRecord, Item);
    return record;
  }

  /**
   * Loads multiple item records from the database.
   *
   * @static
   * @param {DBManager} dbManager - The database manager to use for loading the items.
   * @param {Pick<IItemRecord, 'Type' | 'ItemID'>[]} items - An array of objects that specify the types and IDs of the items to load.
   * @param {boolean} [includeSitemapItem=false] - A flag that indicates whether to include the sitemap items in the loaded items. Defaults to `false`.
   * @param {boolean} [consistentRead=false] - A flag that indicates whether to use consistent read when loading the items. Defaults to `false`.
   * @returns {Promise<ItemRecord[]>} A promise that resolves to an array of the loaded item records.
   * @throws {TypeError} If the number of items to load is more than 100, a TypeError is thrown because DynamoDB BatchGet allows no more than 100 items per batch.
   * @throws {Error} If there are any unprocessed keys in the response from DynamoDB, an Error is thrown.
   */
  public static async loadMany(
    dbManager: DBManager,
    items: Pick<IItemRecord, 'Type' | 'ItemID'>[],
    includeSitemapItem = false,
    consistentRead = false,
  ): Promise<ItemRecord[]> {
    const fields = FieldsWithoutSitemapItem.slice();
    if (includeSitemapItem) fields.push('SitemapItem');

    if (items.length > 100) {
      throw new TypeError('DynamoDB BatchGet allows no more than 100 items per batch');
    }

    const batchGetCommand: BatchGetCommandInput = {
      RequestItems: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    batchGetCommand.RequestItems![dbManager.tableName] = {
      ConsistentRead: consistentRead,
      Keys: [],
      AttributesToGet: fields,
    };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const requestItems = batchGetCommand.RequestItems![dbManager.tableName];
    for (const item of items) {
      requestItems.Keys?.push({
        PK: `itemID#${item.ItemID.toLowerCase()}#type#${item.Type.toLowerCase()}`,
        SK: 'item',
      });
    }

    const { UnprocessedKeys, Responses } = await dbManager.batchGet(batchGetCommand);

    const records: ItemRecord[] = [];
    if (Responses !== undefined) {
      for (const response of Responses[dbManager.tableName]) {
        const record = plainToClass<ItemRecord, unknown>(ItemRecord, response);
        records.push(record);
      }
    }

    if (UnprocessedKeys !== undefined && Object.keys(UnprocessedKeys).length > 0) {
      // Got some unprocessed items
      throw new Error('Unprocessed items from DynamoDB in ItemRecord.loadMany');
    }

    return records;
  }

  /**
   * Loads all items for a specified file from the database.
   *
   * @param {DBManager} dbManager - The database manager instance.
   * @param {Pick<IItemRecord, 'Type' | 'FileName'>} key - An object containing the 'Type' and 'FileName' of the item to load.
   * @param {boolean} [includeSitemapItem=false] - A flag indicating whether to include the 'SitemapItem' field in the returned records.
   * @param {boolean} [consistentRead=false] - A flag indicating whether to use consistent read when loading the items.
   * @returns {Promise<ItemRecord[]>} - A promise that resolves to an array of ItemRecord instances.
   *
   * @static
   */
  public static async loadFile(
    dbManager: DBManager,
    key: Pick<IItemRecord, 'Type' | 'FileName'>,
    includeSitemapItem = false,
    consistentRead = false,
  ): Promise<ItemRecord[]> {
    const fields = FieldsWithoutSitemapItem.map((value) => {
      if (value === 'Type') {
        return '#Type';
      }
      return value;
    });
    if (includeSitemapItem) fields.push('SitemapItem');

    const records = [] as ItemRecord[];
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
          ':pkval': `fileName#${key.FileName.toLowerCase()}#type#${key.Type.toLowerCase()}`,
        },
        ExpressionAttributeNames: {
          '#Type': 'Type',
        },
        ProjectionExpression: fields.join(),
        ExclusiveStartKey: LastEvaluatedKey,
        ConsistentRead: consistentRead,
      });

      LastEvaluatedKey = result.LastEvaluatedKey;
      const { Items } = result;

      if (Items !== undefined) {
        for (const item of Items) {
          const record = plainToClass<ItemRecord, unknown>(ItemRecord, item);
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
   * Creates a new instance of the ItemRecord class.
   *
   * @param {IItemRecordNoKeysLoose} init - An object containing initial values for the ItemRecord.
   */
  public constructor(init: IItemRecordNoKeysLoose) {
    this._keyBy = SaveBy.ItemID;
    this._timeFirstSeenISO = new Date().toISOString();
    this._itemStatus = 'written';

    // Save any passed-in values over the defaults
    Object.assign(this, init);
  }

  public get dbStruct(): IItemRecord {
    return {
      PK: this.PK,
      SK: this.SK,
      Type: this.Type,
      ItemID: this.ItemID,
      FileName: this.FileName,
      SitemapItem: this.SitemapItem,
      ItemStatus: this.ItemStatus,
      TimeFirstSeenISO: this.TimeFirstSeenISO,
      ...(this.TimeDirtiedISO !== undefined && {
        TimeDirtiedISO: this.TimeDirtiedISO,
      }),
      TimeLastWrittenISO: this.TimeLastWrittenISO,
    };
  }

  /**
   * Saves multiple item records to the database.
   *
   * @static
   * @param {DBManager} dbManager - The database manager to use for saving the items.
   * @param {ItemRecord[]} items - An array of item records to save.
   * @param {boolean} [byFileOnly=false] - A flag that indicates whether to save the items under the all Items in File key only. If `false`, the items are saved under both the specific ItemID key and the all Items in File key. Defaults to `false`.
   * @returns {Promise<void>} A promise that resolves when the items have been saved.
   * @throws {TypeError} If any of the required fields (`ItemID`, `Type`, `FileName`, `SitemapItem`) are `undefined` in any of the items, a TypeError is thrown.
   * @throws {TypeError} If the number of items to save is more than 25, a TypeError is thrown because DynamoDB BatchWriteItem allows no more than 25 items per batch.
   * @throws {Error} If there are any unprocessed items in the response from DynamoDB, an Error is thrown.
   */
  public static async saveMany(
    dbManager: DBManager,
    items: ItemRecord[],
    byFileOnly = false,
  ): Promise<void> {
    if (items.length > 25) {
      throw new TypeError('DynamoDB BatchWriteItem allows no more than 25 items per batch');
    }

    const batchGetCommandByItemID: BatchWriteCommandInput = {
      RequestItems: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    batchGetCommandByItemID.RequestItems![dbManager.tableName] = [];

    const batchGetCommandByFileName: BatchWriteCommandInput = {
      RequestItems: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    batchGetCommandByFileName.RequestItems![dbManager.tableName] = [];

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for (const item of items) {
      // Validate that all the fields needed are present
      if (item.ItemID === undefined) {
        throw new TypeError('ItemID is required');
      }
      if (item.Type === undefined) {
        throw new TypeError('Type is required');
      }
      if (item.FileName === undefined) {
        throw new TypeError('FileName is required');
      }
      if (item.SitemapItem === undefined) {
        throw new TypeError('SitemapItem is required');
      }

      // Update that we wrote this now
      item.ResetTimeLastWrittenISO();

      item._keyBy = SaveBy.FileName;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      batchGetCommandByFileName.RequestItems![dbManager.tableName].push({
        PutRequest: { Item: item.dbStruct },
      });

      if (!byFileOnly) {
        item._keyBy = SaveBy.ItemID;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        batchGetCommandByItemID.RequestItems![dbManager.tableName].push({
          PutRequest: { Item: item.dbStruct },
        });
      }
    }

    if (!byFileOnly) {
      const { UnprocessedItems } = await dbManager.batchWrite(batchGetCommandByItemID);

      if (UnprocessedItems !== undefined && Object.keys(UnprocessedItems).length > 0) {
        // Got some unprocessed items after retrier
        throw new Error('UnprocessedItems after retrier');
      }
    }

    {
      const { UnprocessedItems } = await dbManager.batchWrite(batchGetCommandByFileName);

      if (UnprocessedItems !== undefined && Object.keys(UnprocessedItems).length > 0) {
        // Got some unprocessed items after retrier
        throw new Error('UnprocessedItems after retrier');
      }
    }
  }

  /**
   * Saves the current item record to the database.
   *
   * @param {DBManager} dbManager - The database manager to use for saving the item.
   * @param {boolean} [byFileOnly=false] - A flag that indicates whether to save the item under the all Items in File key only. If `false`, the item is saved under both the specific ItemID key and the all Items in File key. Defaults to `false`.
   * @returns {Promise<void>} A promise that resolves when the item record has been saved.
   * @throws {TypeError} If any of the required fields (`ItemID`, `Type`, `FileName`, `SitemapItem`) are `undefined`, a TypeError is thrown.
   * @throws {Error} If there are any issues during the database write operation, an Error is thrown.
   *
   * This method first validates that all the required fields are present.
   * It then updates the last written timestamp and prepares two tasks for saving the item record to the database:
   * one under a specific ItemID key (if `byFileOnly` is `false`), and one under the all Items in File key.
   * The method waits for all database write operations to complete before resolving.
   */
  public async save(dbManager: DBManager, byFileOnly = false): Promise<void> {
    // Validate that all the fields needed are present
    if (this.ItemID === undefined) {
      throw new TypeError('ItemID is required');
    }
    if (this.Type === undefined) {
      throw new TypeError('Type is required');
    }
    if (this.FileName === undefined) {
      throw new TypeError('FileName is required');
    }
    if (this.SitemapItem === undefined) {
      throw new TypeError('SitemapItem is required');
    }

    // Update that we wrote this now
    this.ResetTimeLastWrittenISO();

    const tasks: Promise<PutCommandOutput>[] = [];

    // Save under specific ItemID key
    if (!byFileOnly) {
      this._keyBy = SaveBy.ItemID;
      tasks.push(
        dbManager.ddbDocClient.put({
          TableName: dbManager.tableName,
          Item: this.dbStruct,
        }),
      );
    }

    // Save under the all Items in File key
    this._keyBy = SaveBy.FileName;
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
      case SaveBy.FileName:
        return `fileName#${this.FileName.toLowerCase()}#type#${this.Type.toLowerCase()}`;
      case SaveBy.ItemID:
        return `itemID#${this.ItemID.toLowerCase()}#type#${this.Type.toLowerCase()}`;
      default:
        throw new Error('Missing SaveBy handler');
    }
  }

  public get SK(): string {
    switch (this._keyBy) {
      case SaveBy.FileName:
        return `itemID#${this.ItemID.toLowerCase()}`;
      case SaveBy.ItemID:
        return 'item';
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

  private _itemID: string | undefined;
  public get ItemID(): string {
    return this._itemID as string;
  }
  private set ItemID(value: string) {
    this._itemID = value;
  }

  private _fileName: string | undefined;
  public get FileName(): string {
    return this._fileName as string;
  }
  public set FileName(value: string) {
    this._fileName = value;
  }

  private _sitemapItem: SitemapItemLoose | undefined;
  public get SitemapItem(): SitemapItemLoose {
    return this._sitemapItem as SitemapItemLoose;
  }
  public set SitemapItem(value: SitemapItemLoose) {
    this._sitemapItem = value;
  }

  private _itemStatus: ItemStatus | undefined;
  public get ItemStatus(): ItemStatus {
    return this._itemStatus as ItemStatus;
  }
  private set ItemStatus(value: ItemStatus) {
    this._itemStatus = value;
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
  public ResetTimeDirtiedISO(opts: { toRemove?: boolean } = {}): void {
    const { toRemove = false } = opts;
    this._timeDirtiedISO = new Date().toISOString();
    this._itemStatus = toRemove ? 'toremove' : 'towrite';
  }
  public ClearTimeDirtiedISO(): void {
    delete this._timeDirtiedISO;
    if (this._itemStatus === 'towrite') {
      this._itemStatus = 'written';
    } else if (this._itemStatus === 'toremove') {
      this._itemStatus = 'removed';
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
