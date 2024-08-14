import { IConfig } from '../../config/config';
import { ExtractItemIDs, SitemapItemAndItemID } from './extract-itemids';

/**
 * Validate the itemIDRegexStr against an existing sitemap.xml on S3 by
 * confirming that it extracts the ItemIDs from the sitemap.xml.
 *
 * Return a RegExp if the validation succeeds, otherwise throw.
 *
 * @param opts
 * @returns
 */
export async function ValidateItemIDRegex(opts: {
  readonly config: IConfig;
  readonly filename: string;
  readonly itemIDRegexStr?: string;
  readonly quiet?: boolean;
  readonly type?: string;
}): Promise<{ itemIDRegex: RegExp; itemsWithIDs: SitemapItemAndItemID[] }> {
  const { config, filename, itemIDRegexStr, quiet = false, type } = opts;

  if (!itemIDRegexStr) {
    throw new Error('`itemIDRegexStr` is required');
  }
  if (!itemIDRegexStr.includes('(?<ItemID>')) {
    throw new Error('`itemIDRegex` must contain the `(?<ItemID>...)` placeholder');
  }

  const itemIDRegex = new RegExp(itemIDRegexStr);
  const itemIDs = await ExtractItemIDs({ config, filename, itemIDRegex, type });

  if (itemIDs.length === 0) {
    if (!quiet) {
      throw new Error(`Sitemap ${filename} is empty, cannot test \`itemIDRegex\``);
    }
  }

  return { itemIDRegex, itemsWithIDs: itemIDs };
}
