import { SitemapFileWrapper } from '@shutterstock/sitemaps-wrapper-lib';
import path from 'path';
import { SitemapItemLoose } from 'sitemap';
import { IConfig } from '../../config/config';

export type SitemapItemAndItemID = {
  item: SitemapItemLoose;
  itemID: string;
};

/**
 * Get all the ItemIDs and SitemapItems for the given Sitemap
 * @param opts
 * @returns
 */
export async function ExtractItemIDs(opts: {
  readonly config: IConfig;
  readonly filename: string;
  readonly itemIDRegex: RegExp;
  readonly type?: string;
}): Promise<SitemapItemAndItemID[]> {
  const { config, filename, itemIDRegex, type = '' } = opts;

  // Throws if the file does not exist
  const { items } = await SitemapFileWrapper.itemsFromS3({
    bucketName: config.s3SitemapsBucketName,
    s3Directory: path.posix.join(config.s3Directory, type),
    filenameRoot: filename.replace('.xml', '').replace('.gz', ''),
    compress: filename.endsWith('.gz'),
  });

  const itemsWithIDs: SitemapItemAndItemID[] = [];
  for (const item of items) {
    const matches = item.url.match(itemIDRegex);
    if (matches === null) {
      throw new Error(`\`${item.url}\` does not match \`itemIDRegex\``);
    }
    if (matches.groups === undefined) {
      throw new Error(`\`itemIDRegex\` did not capture any groups at all from \`${item.url}\``);
    }
    if (matches.groups.ItemID === undefined) {
      throw new Error(`\`itemIDRegex\` did not capture \`ItemID\` group from \`${item.url}\``);
    }
    itemsWithIDs.push({ itemID: matches.groups.ItemID, item });
  }

  return itemsWithIDs;
}
