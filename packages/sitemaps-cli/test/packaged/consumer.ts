import { run } from '@shutterstock/sitemaps-cli';
import { CleanupSitemapItems } from '@shutterstock/sitemaps-cli/dist/utils/cleanup-sitemap-items';
import { getUrlOrFilePath } from '@shutterstock/sitemaps-cli/dist/utils/file-or-url';
import {
  getSitemapType,
  SitemapType,
} from '@shutterstock/sitemaps-cli/dist/utils/index-or-sitemap';
import { ISitemapState, writeOrRotateAndWrite } from '@shutterstock/sitemaps-cli/dist/utils/rotate';

const state: ISitemapState = { count: 0 };
const item: Parameters<typeof writeOrRotateAndWrite>[0]['item'] = {
  url: 'https://example.com/one',
  priority: 0.5,
};
const cleanup = new CleanupSitemapItems();
cleanup.write(item);
const path = getUrlOrFilePath('https://example.com/input.xml');
const detected: Promise<SitemapType | undefined> = getSitemapType('input.xml');
const rotate: typeof writeOrRotateAndWrite = writeOrRotateAndWrite;
void [run, state, path, detected, rotate];
