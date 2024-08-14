import {
  SitemapAlreadyFull,
  SitemapFileWrapper,
  SitemapIndexWrapper,
  SitemapWriteWouldOverflow,
} from '@shutterstock/sitemaps-wrapper-lib';
import { SitemapItemLoose } from 'sitemap';

export interface ISitemapState {
  count: number;
}

// TODO: This function should be in a common library used by CLI and kinesis-sitemap-writer
/**
 * Attempt to write to the current sitemap file.
 * If the write throws an exception because the new item would exceed the allowed byte length,
 * then create a new file, push the old file into the upload queue, write the item
 * to the new file, and return a handle to the new file.
 *
 * @param opts
 * @returns
 */
export async function writeOrRotateAndWrite(opts: {
  currentSitemap?: SitemapFileWrapper;
  index: SitemapIndexWrapper;
  item: SitemapItemLoose;
  siteBaseURL: string;
  compress: boolean;
  state: ISitemapState;
  fileNameRoot: string;
  localDirectory: string;
  disregardByteLimit?: boolean;
}): Promise<SitemapFileWrapper> {
  const {
    currentSitemap,
    index,
    item,
    siteBaseURL,
    compress,
    state,
    fileNameRoot,
    localDirectory,
    disregardByteLimit = false,
  } = opts;

  let sitemap: SitemapFileWrapper | undefined = currentSitemap;
  // Initialize if no sitemap
  if (sitemap === undefined) {
    state.count = 1;
    sitemap = await createSitemapAddToIndex(
      sitemap,
      siteBaseURL,
      compress,
      fileNameRoot,
      state,
      index,
      localDirectory,
    );
  }

  try {
    await sitemap.write({ item, disregardByteLimit });
  } catch (error: any) {
    if (error instanceof SitemapWriteWouldOverflow || error instanceof SitemapAlreadyFull) {
      // Close the old sitemap, open a new one
      await sitemap.end();

      // Increment the sitemap count for the filenames
      state.count++;

      sitemap = await createSitemapAddToIndex(
        sitemap,
        siteBaseURL,
        compress,
        fileNameRoot,
        state,
        index,
        localDirectory,
      );

      // Write the item to the new sitemap
      await sitemap.write({ item });

      return sitemap;
    } else {
      throw error;
    }
  }
  return sitemap;
}

/**
 * Create a new sitemap file and add it to the sitemap index
 * @param sitemap
 * @param siteBaseURL
 * @param compress
 * @param fileNameRoot
 * @param state
 * @param index
 * @returns
 */
async function createSitemapAddToIndex(
  sitemap: SitemapFileWrapper | undefined,
  siteBaseURL: string,
  compress: boolean,
  fileNameRoot: string,
  state: ISitemapState,
  index: SitemapIndexWrapper,
  localDirectory: string,
) {
  sitemap = new SitemapFileWrapper({
    siteBaseURL,
    compress,
    filenameRoot: `${fileNameRoot}-${state.count.toString().padStart(5, '0')}`,
    localDirectory,
    limitCount: 50000,
    limitBytes: 50 * 1024 * 1024,
  });
  await index.write({
    item: {
      url: new URL(sitemap.filename, siteBaseURL).toString(),
      lastmod: new Date().toISOString(),
    },
  });
  return sitemap;
}
