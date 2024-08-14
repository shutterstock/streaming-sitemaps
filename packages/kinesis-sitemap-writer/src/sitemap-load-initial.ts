import { Unit as metricUnit } from 'aws-embedded-metrics';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import path from 'path';
import { DBManager, ShardStateRecord, FileRecord } from '@shutterstock/sitemaps-db-lib';
import { SitemapWriterTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import {
  SitemapFileAndStats,
  SitemapFileAndStatsFileRecordFailed,
  SitemapFileAndStatsS3LoadFailed,
} from './sitemap-file-stats';
import { createNewSitemap } from './sitemap-rotate';
import { IConfig } from './config/config';
import { log } from './utils/log';

/**
 * Load a prior sitemap file from S3 when starting processing of a type.
 * If the last file was full, let the in-loop rotate logic handle it.
 *
 * @param shardState
 * @param type
 * @param flatMetricsTyped
 * @returns
 */
export async function loadInitialSitemapFile(opts: {
  config: IConfig;
  dbManager: DBManager;
  shardState: ShardStateRecord;
  flatMetricsTyped: FlatCountMetrics;
}): Promise<SitemapFileAndStats> {
  const { config, shardState, flatMetricsTyped, dbManager } = opts;

  let currentSitemap: SitemapFileAndStats;
  const initalFilenameRoot = path.basename(
    shardState.CurrentFileName,
    config.compressSitemapFiles ? '.xml.gz' : '.xml',
  );

  // Lambda seems to kill the first invoke of a new deploy without warning within about 2.5 seconds
  // That means we write the record to DynamoDB, but never write the file to S3,
  // then we get re-invoked with the same payload a second later.
  // In that case the file in the DB will have state of `empty`, so we just create a file with that name
  if (shardState.FileCount === 1) {
    // Check if the file state is `empty`
    const fileRecord = await FileRecord.loadOne(dbManager, {
      Type: shardState.Type,
      FileName: shardState.CurrentFileName,
    });

    if (fileRecord.FileStatus === 'empty' && fileRecord.CountWritten === 0) {
      // This is the special case where we reuse the first filename that was never written to S3

      const shardStateRedux = new ShardStateRecord({
        ...shardState,
        FileCount: 0, // Reset the file count so we get `1` again
        CurrentFileName: '',
        Type: shardState.Type,
        ShardId: shardState.ShardId,
      });

      // There is no last sitemap file, create a new one
      currentSitemap = await createNewSitemap({
        sitemapFileNamingScheme: config.sitemapFileNamingScheme,
        shardState: shardStateRedux,
        config,
        dbManager,
      });
      flatMetricsTyped.putMetric(
        SitemapWriterTypedMetrics.SitemapFile1Recreated,
        1,
        metricUnit.Count,
      );
      flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapLast1Empty, 1, metricUnit.Count);

      log.warn('File 1 was empty - replacing that file', {
        type: shardState.Type,
        usingSitemapFilename: currentSitemap.sitemap.filename,
      });

      return currentSitemap;
    }
  }

  // If we get here we are either on the first file and it's non-empty or we're on some other file
  if (shardState.FileCount > 0) {
    try {
      flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapLastFetch, 1, metricUnit.Count);

      // The saved state knows about a file
      // Fetch the last sitemap file
      currentSitemap = await SitemapFileAndStats.fromS3(
        {
          bucketName: config.s3SitemapsBucketName,
          compress: config.compressSitemapFiles,
          s3Directory: path.join(config.s3Directory, shardState.Type),
          filenameRoot: initalFilenameRoot,
          siteBaseURL: config.siteBaseURL,
          localDirectory: config.localDirectory,
        },
        { dbManager, key: { Type: shardState.Type } },
      );

      flatMetricsTyped.putMetric(
        SitemapWriterTypedMetrics.SitemapLastFetchDone,
        1,
        metricUnit.Count,
      );
    } catch (error: any) {
      if (error.code === 'ERR_UNHANDLED_ERROR') {
        // The SAXStream could not write one of the items in the file back to the new file
        // This is a weird corner case fixed by this PR: https://github.com/ekalinin/sitemap.js/pull/375
        // TODO: Find out why the item in the XML file is invalid to begin with

        // This can happen if the last sitemap push to S3 failed (e.g. Lambda crashed before pushing the file)
        log.error('last sitemap file could not be parsed cleanly - skipping to next filename', {
          error,
          type: shardState.Type,
          shardId: shardState.ShardId,
          lastSitemapWasExisting: false,
          lastSitemapFilename: initalFilenameRoot,
        });
        flatMetricsTyped.putMetric(
          SitemapWriterTypedMetrics.SitemapLastParseFailed,
          1,
          metricUnit.Count,
        );

        try {
          // Write that the file is malformed in DynamoDB
          const fileRecord = await FileRecord.loadOne(dbManager, {
            Type: shardState.Type,
            FileName: shardState.CurrentFileName,
          });
          fileRecord.MarkAsMalformed();
          await fileRecord.save(dbManager);
        } catch (error) {
          log.error(
            'last sitemap file could not be parsed cleanly - failed marking as malformed in DB',
            {
              error,
              type: shardState.Type,
              shardId: shardState.ShardId,
              lastSitemapWasExisting: false,
              lastSitemapFilename: initalFilenameRoot,
            },
          );
        }

        // Note: because we update the Shard State everytime a new S3 file name is allocated,
        // even if the S3 push later fails, the Shard State filename should still be the
        // "last in use" filename... so just going to the next filename is sufficient
        currentSitemap = await createNewSitemap({
          sitemapFileNamingScheme: config.sitemapFileNamingScheme,
          shardState,
          config,
          dbManager,
        });
      } else if (
        error instanceof SitemapFileAndStatsS3LoadFailed ||
        error instanceof SitemapFileAndStatsFileRecordFailed
      ) {
        // The file was unable to be fetched from S3 or state failed to load from DynamoDB

        // This can happen if the last sitemap push to S3 failed (e.g. Lambda crashed before pushing the file)
        log.error('fetching last sitemap failed when it should exist - skipping to next filename', {
          error,
          type: shardState.Type,
          shardId: shardState.ShardId,
          lastSitemapWasExisting: false,
          lastSitemapFilename: initalFilenameRoot,
        });
        flatMetricsTyped.putMetric(
          SitemapWriterTypedMetrics.SitemapLastFetchFailed,
          1,
          metricUnit.Count,
        );

        // Note: because we update the Shard State everytime a new S3 file name is allocated,
        // even if the S3 push later fails, the Shard State filename should still be the
        // "last in use" filename... so just going to the next filename is sufficient
        currentSitemap = await createNewSitemap({
          sitemapFileNamingScheme: config.sitemapFileNamingScheme,
          shardState,
          config,
          dbManager,
        });
      } else {
        throw error;
      }
    }

    if (currentSitemap.sitemap.full) {
      flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapFileCreated, 1, metricUnit.Count);
      flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapLastFull, 1, metricUnit.Count);

      // This can happen often when batches are full and the item limit is divisible
      // by the batch size (e.g. 50k item limit, 10k per batch, 5 writes will exactly fill a file)
      log.warn('last sitemap was full on startup - will start new file', {
        type: shardState.Type,
        lastSitemapWasExisting: currentSitemap.existing,
        lastSitemapFilename: currentSitemap.sitemap.filename,
        lastSitemapCount: currentSitemap.sitemap.count,
        lastSitemapSizeUncompressed: currentSitemap.sitemap.sizeUncompressed,
      });
    } else {
      // Keep using the old sitemap if it's not full yet
      flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapLastNotFull, 1, metricUnit.Count);

      log.info('last sitemap was NOT full on startup - continuing with file', {
        type: shardState.Type,
        lastSitemapWasExisting: currentSitemap.existing,
        lastSitemapFilename: currentSitemap.sitemap.filename,
        usingSitemapFilename: currentSitemap.sitemap.filename,
      });
    }
  } else {
    // There is no last sitemap file, create a new one
    currentSitemap = await createNewSitemap({
      sitemapFileNamingScheme: config.sitemapFileNamingScheme,
      shardState,
      config,
      dbManager,
    });
    flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapFileCreated, 1, metricUnit.Count);
    flatMetricsTyped.putMetric(SitemapWriterTypedMetrics.SitemapLastNone, 1, metricUnit.Count);

    log.warn('index did not specify a last sitemap filename - starting new file', {
      type: shardState.Type,
      usingSitemapFilename: currentSitemap.sitemap.filename,
    });
  }

  return currentSitemap;
}
