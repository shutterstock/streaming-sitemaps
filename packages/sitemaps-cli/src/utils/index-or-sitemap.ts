import { createReadStream } from 'fs';
import { pipeline, Transform } from 'stream';
import { promisify } from 'util';
import zlib from 'zlib';

export enum SitemapType {
  Sitemap = 'Sitemap',
  Index = 'Index',
}

export async function getSitemapType(filePath: string): Promise<SitemapType | undefined> {
  const limit = 10240;
  const pipelineAsync = promisify(pipeline);
  // Limit decompressed bytes, not compressed input: truncating a .gz file at
  // 10 KB makes valid larger files fail with an unexpected EOF.
  const readStream = createReadStream(filePath);
  let data = '';
  let bytes = 0;
  const inspected = new Error('sitemap header inspected');
  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const portion = chunk.subarray(0, limit - bytes);
      data += portion.toString();
      bytes += portion.length;
      if (bytes >= limit || data.includes('<urlset') || data.includes('<sitemapindex')) {
        // Intentional early completion: pipeline closes input and gzip too.
        callback(inspected);
      } else callback();
    },
  });

  try {
    if (filePath.endsWith('.gz')) {
      await pipelineAsync(readStream, zlib.createGunzip(), inspect);
    } else {
      await pipelineAsync(readStream, inspect);
    }
  } catch (error) {
    if (error !== inspected) throw error;
  }

  if (data.includes('<urlset')) return SitemapType.Sitemap;
  if (data.includes('<sitemapindex')) return SitemapType.Index;
  return undefined;
}
