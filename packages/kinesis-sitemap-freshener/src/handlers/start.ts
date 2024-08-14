import { DBManager, FileRecord, ShardStateRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapFreshenerTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import {
  ISitemapFreshenerFreshenFileMessage,
  ISitemapFreshenerStartMessage,
  ISitemapFreshenerStartResult,
} from '@shutterstock/sitemaps-models-lib';
import keyBy from 'lodash/keyBy';
import { ValidateItemIDRegex } from './helpers/validate-itemid-regex';
import { log } from '../utils/log';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { Unit as metricUnit } from 'aws-embedded-metrics';
import { Chunker } from '@shutterstock/chunker';
import * as kinesis from '@aws-sdk/client-kinesis';
import { IConfig } from '../config/config';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * Handles the start message for the sitemap freshener. This function is responsible for reading all filenames for a given type,
 * validating the regex against the first Sitemap on S3 if repairDB is true, loading all the shard states for the given type,
 * and dumping a `freshenFile` message into the stream for each file.
 *
 * @param {Object} opts - The options for the function.
 * @param {Chunker<kinesis.PutRecordsRequestEntry>} opts.chunkerStream - The chunker stream.
 * @param {IConfig} opts.config - The configuration object.
 * @param {boolean} opts.dryRun - A flag indicating whether this is a dry run.
 * @param {boolean} opts.dryRunDB - A flag indicating whether this is a dry run for the DB.
 * @param {DBManager} opts.dbManager - The DB manager.
 * @param {FlatCountMetrics} opts.flatMetricsTyped - FlatMetricsCount for the typed metrics.
 * @param {ISitemapFreshenerStartMessage} opts.message - The start message.
 * @param {string} opts.type - The type of the operation.
 *
 * @returns {Promise<ISitemapFreshenerStartResult>} - A promise that resolves to the result of the start operation.
 *
 * @throws {Error} - Throws an error if no files are found for the given type.
 */
export async function handleStartMessage(opts: {
  readonly chunkerStream: Chunker<kinesis.PutRecordsRequestEntry>;
  readonly config: IConfig;
  readonly dryRun: boolean;
  readonly dryRunDB: boolean;
  readonly dbManager: DBManager;
  readonly flatMetricsTyped: FlatCountMetrics;
  readonly message: ISitemapFreshenerStartMessage;
  readonly type: string;
}): Promise<ISitemapFreshenerStartResult> {
  const { chunkerStream, config, dbManager, dryRun, dryRunDB, flatMetricsTyped, message, type } =
    opts;
  const result: Writeable<ISitemapFreshenerStartResult> = { message };

  // Read all the filenames for this type
  const files = await FileRecord.loadType(dbManager, {
    Type: type,
  });
  if (files.length === 0) {
    throw new Error('No files found for type: ' + type);
  }
  result.filesOfType = files.length;

  // Validate the regex against first Sitemap on S3
  if (message.repairDB) {
    const validateResult = await ValidateItemIDRegex({
      config,
      itemIDRegexStr: message.itemIDRegex,
      filename: files[0].FileName,
      type,
    });

    result.urlRegexValid = true;
    result.itemIDsSample = validateResult.itemsWithIDs
      .map((item) => ({
        itemID: item.itemID,
        url: item.item.url,
      }))
      .slice(0, 10);

    log.info('validated itemIDRegex', {
      filename: files[0].FileName,
      itemIDRegexStr: message.itemIDRegex,
      itemIDsSample: result.itemIDsSample,
    });
  }

  // Load all the shard states for this type
  // We use this to skip file that are both:
  // - The `CurrentFile` for a shard
  // - `LastWritten` within the last 24 hours
  const shardStates = await ShardStateRecord.loadType(dbManager, {
    Type: type,
  });
  const shardStateByFileName = keyBy(shardStates, (shardState) => shardState.CurrentFileName);
  result.filesWritten = 0;
  result.filesSkippedActive = 0;

  // Dump a `freshenFile` message into this stream for each file
  for (const file of files) {
    log.options.meta.filename = file.FileName;

    const item: ISitemapFreshenerFreshenFileMessage = {
      operation: 'freshenFile',
      dryRun,
      dryRunDB,
      type,
      filename: file.FileName,
      s3DirectoryOverride: message.s3DirectoryOverride,
      itemIDRegex: message.itemIDRegex,
      repairDB: message.repairDB,
    };

    // Check if file is being actively written to by a shard
    const shardState = shardStateByFileName[file.FileName];
    if (shardState !== undefined) {
      if (Date.now() - new Date(shardState.TimeLastWrittenISO).getTime() < 1000 * 60 * 60 * 24) {
        result.filesSkippedActive++;

        log.info('skipping file because it is being actively written to by a shard', {
          shardState: shardState.dbStruct,
        });

        flatMetricsTyped.putMetric(
          SitemapFreshenerTypedMetrics.FileOpSkippedActive,
          1,
          metricUnit.Count,
        );
        continue;
      }
    }

    // Write back to our own stream
    // Tell the chunker to write the item, eventually
    const dataBuffer = Buffer.from(JSON.stringify(item), 'utf-8');
    await chunkerStream.enqueue({
      Data: dataBuffer,
      PartitionKey: `operation#${item.operation}#type#${item.type}#filename#${file.FileName}#`,
    });

    flatMetricsTyped.putMetric(SitemapFreshenerTypedMetrics.FileOpWritten, 1, metricUnit.Count);
    result.filesWritten++;
  }

  return result;
}
