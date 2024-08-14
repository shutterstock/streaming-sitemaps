import { createReadStream } from 'fs';
import { pipeline, Transform } from 'stream';
import { promisify } from 'util';
import zlib from 'zlib';

export enum SitemapType {
  Sitemap = 'Sitemap',
  Index = 'Index',
}

export async function getSitemapType(filePath: string): Promise<SitemapType | undefined> {
  const pipelineAsync = promisify(pipeline);
  const readStream = createReadStream(filePath, { end: 10240 }); // Read up to 10 KB
  let data = '';

  const transformStream = new Transform({
    transform(chunk, encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });

  if (filePath.endsWith('.gz')) {
    await pipelineAsync(readStream, zlib.createGunzip(), transformStream);
  } else {
    await pipelineAsync(readStream, transformStream);
  }

  if (data.includes('<urlset')) {
    return SitemapType.Sitemap;
  } else if (data.includes('<sitemapindex')) {
    return SitemapType.Index;
  } else {
    return;
  }
}
