import path from 'path';

/**
 * `new URL()` will not escape some chars in the path.
 * This function escapes those chars.
 *
 * Google rejects URLs in sitemaps that have a `:` in the path.
 *
 * Additionally, % that is not a %-escape will cause a 400, such as:
 *   https://www.example.com/search/55%+off
 *
 * $ - not escaped by new URL()
 * [ ] - not escaped by new URL()
 * { } - escaped by new URL()
 * < > - escaped by new URL()
 *
 */
export function escapeProhibitedPathChars(url: URL): URL {
  if (url.pathname !== undefined && url.pathname !== '') {
    const dirtypath = url.pathname;
    url.pathname = dirtypath
      .replace(/:/g, '%3a')
      .replace(/\$/g, '%24')
      .replace(/\[/g, '%5b')
      .replace(/\]/g, '%5d');
    return url;
  } else {
    return url;
  }
}

/**
 * A % that is not a %-escape will cause a 400, such as:
 *   https://www.example.com/search/55%+off
 *
 * % - %25
 */
export function escapePercentInPathInput(path: string): string {
  return path.replace(/%/g, '%25');
}

export function escapeColonInPathInput(path: string): string {
  return path.replace(/:/g, '%3a');
}

/**
 * Legacy paths may have uncoded the path with `escape`, which encodes
 * to ANSI instead of UTF-8.
 *
 * `decodeURIComponent` will throw if it encounters continuation bytes (such as %e1 or %e9)
 * that are not followed by additional bytes to finish the codepoint.
 *
 * If `decodeURIComponent` throws we will try to decode the path with `unescape` then
 * re-encode with encodeURIComponent.
 * @param pathIn
 */
export function utf8EncodePath(pathIn: string): string {
  try {
    decodeURIComponent(pathIn);

    // Return original path if it is valid UTF-8
    return pathIn;
  } catch (e) {
    // Try to decode with unescape
    const pathParts = pathIn.split('/');
    const pathPartsEncoded: string[] = [];
    pathParts.forEach((part) => {
      if (part) {
        pathPartsEncoded.push(encodeURIComponent(unescape(part)));
      } else {
        pathPartsEncoded.push('');
      }
    });

    const pathEncoded = path.posix.join(...pathPartsEncoded).toLowerCase();
    return pathIn.startsWith('/') && !pathEncoded.startsWith('/') ? `/${pathEncoded}` : pathEncoded;
  }
}
