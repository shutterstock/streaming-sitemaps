import { getSitemapType, SitemapType } from '../../src/utils/index-or-sitemap';

describe('getSitemapType', () => {
  it('should return SitemapType.Sitemap for a sitemap file', async () => {
    const type = await getSitemapType(`${__dirname}/../data/sitemap.xml`);
    expect(type).toBe(SitemapType.Sitemap);
  });

  it('should return SitemapType.Sitemap for a gzipped sitemap file', async () => {
    const type = await getSitemapType(`${__dirname}/../data/sitemap1.xml.gz`);
    expect(type).toBe(SitemapType.Sitemap);
  });

  it('should return SitemapType.Index for an index file', async () => {
    const type = await getSitemapType(`${__dirname}/../data/index.xml`);
    expect(type).toBe(SitemapType.Index);
  });

  it('should return SitemapType.Index for a gzipped index file', async () => {
    const type = await getSitemapType(`${__dirname}/../data/index.xml.gz`);
    expect(type).toBe(SitemapType.Index);
  });

  it('should return undefined for a file that is neither a sitemap nor an index', async () => {
    const type = await getSitemapType(`${__dirname}/../data/other.xml`);
    expect(type).toBeUndefined();
  });
});
