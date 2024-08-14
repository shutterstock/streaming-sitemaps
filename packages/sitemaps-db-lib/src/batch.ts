import {
  BatchGetCommandInput,
  BatchGetCommandOutput,
  BatchWriteCommandInput,
  BatchWriteCommandOutput,
  DynamoDBDocument,
} from '@aws-sdk/lib-dynamodb';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export class DynamoDBBatch {
  private static DEFAULT_RETRIES = 11;
  private static DEFAULT_RETRY_BASE_DELAY_MS = 2000;

  /**
   * Send a BatchGetCommand and retry any failures with exponential backoff
   *
   * @param opts
   * @param args
   * @returns
   */
  public static async batchGet(
    args: BatchGetCommandInput,
    opts: { client: DynamoDBDocument; retries?: number; retryBaseDelayMS?: number },
  ): Promise<BatchGetCommandOutput> {
    const {
      client,
      retries = DynamoDBBatch.DEFAULT_RETRIES,
      retryBaseDelayMS = DynamoDBBatch.DEFAULT_RETRY_BASE_DELAY_MS,
    } = opts;

    if (args.RequestItems === undefined) {
      throw new Error('must pass in Records');
    }
    if (retryBaseDelayMS < 0) {
      throw new Error('retryBaseDelayMS must be >= 0');
    }
    if (retries < 0) {
      throw new Error('retries must be >= 0');
    }

    let retryCount = 0;
    let doAgain;

    let theResult: BatchGetCommandOutput | undefined = undefined;

    do {
      // Always have to clear the flag from prior loop
      doAgain = false;
      const result = await client.batchGet(args);

      // Setup the result if not setup already
      if (theResult === undefined) {
        theResult = { ...result };
        theResult.Responses = {};
        delete theResult.UnprocessedKeys;
      }

      // Accumulate the results
      if (result.Responses !== undefined && theResult.Responses !== undefined) {
        for (const key of Object.keys(result.Responses)) {
          if (theResult.Responses[key] === undefined) {
            // There is no array for this table, so assign the current one
            theResult.Responses[key] = result.Responses[key];
          } else {
            // There is an array for this table, so add to it
            Array.prototype.push.apply(theResult.Responses[key], result.Responses[key]);
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (result.UnprocessedKeys !== undefined && Object.keys(result.UnprocessedKeys).length > 0) {
        // Setup records for next call
        args.RequestItems = result.UnprocessedKeys;

        // Bail if out of retries
        if (retryCount > retries) {
          theResult.UnprocessedKeys = result.UnprocessedKeys;
          return theResult;
        }

        // Exponential delay with jitter
        await sleep(this.delay(++retryCount, retryBaseDelayMS));
        doAgain = true;
      }
    } while (doAgain);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return theResult!;
  }

  /**
   * Send a BatchWriteCommand and retry any failures with exponential backoff
   *
   * @param client
   * @param args
   * @returns
   */
  public static async batchWrite(
    args: BatchWriteCommandInput,
    opts: { client: DynamoDBDocument; retries?: number; retryBaseDelayMS?: number },
  ): Promise<BatchWriteCommandOutput> {
    const {
      client,
      retries = DynamoDBBatch.DEFAULT_RETRIES,
      retryBaseDelayMS = DynamoDBBatch.DEFAULT_RETRY_BASE_DELAY_MS,
    } = opts;

    if (args.RequestItems === undefined) {
      throw new Error('must pass in Records');
    }
    if (retryBaseDelayMS < 0) {
      throw new Error('retryBaseDelayMS must be >= 0');
    }
    if (retries < 0) {
      throw new Error('retries must be >= 0');
    }

    // Do the first send
    let result = await client.batchWrite(args);

    for (let retryCount = 0; retryCount < retries; retryCount++) {
      // Return if there were no failures
      if (
        result.UnprocessedItems === undefined ||
        Object.keys(result.UnprocessedItems).length === 0
      ) {
        return result;
      }

      // Exponential delay with jitter
      await sleep(this.delay(retryCount, retryBaseDelayMS));

      args.RequestItems = result.UnprocessedItems;

      // Send the retries
      result = await client.batchWrite(args);
    }

    return result;
  }

  // Source: https://dev.solita.fi/2020/05/28/kinesis-streams-part-1.html
  private static delay(attempt: number, baseDelayMS: number): number {
    const exponentialDelay = baseDelayMS * 2 ** attempt;
    return Math.floor(Math.random() * (exponentialDelay - baseDelayMS)) + baseDelayMS;
  }
}
