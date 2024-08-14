import { Transform, TransformOptions, TransformCallback } from 'stream';
import { SitemapItemLoose } from 'sitemap';

export class CleanupSitemapItems extends Transform {
  /**
   * Remove blank arrays (img, video, links, news) from sitemap items
   * @param opts
   */
  constructor(opts: TransformOptions = {}) {
    opts.objectMode = true;
    super(opts);
  }

  _transform(item: SitemapItemLoose, encoding: string, callback: TransformCallback): void {
    if (item.img !== undefined && Array.isArray(item.img) && item.img.length === 0) {
      delete item.img;
    }
    if (item.video !== undefined && Array.isArray(item.video) && item.video.length === 0) {
      delete item.video;
    }
    if (item.news !== undefined && Array.isArray(item.news) && item.news.length === 0) {
      delete item.news;
    }
    if (item.links !== undefined && Array.isArray(item.links) && item.links.length === 0) {
      delete item.links;
    }
    callback(undefined, item);
  }
}
