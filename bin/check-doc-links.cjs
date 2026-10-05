const fs = require('node:fs');
const path = require('node:path');

const documents = [
  'README.md',
  'OPERATIONS.md',
  'TESTING.md',
  'packages/sitemaps-cli/README.md',
  'packages/sitemaps-cdk/README.md',
  'packages/sitemaps-cdk/API.md',
  'packages/cdk/README.md',
];
const anchorCache = new Map();
function anchors(filename) {
  if (anchorCache.has(filename)) return anchorCache.get(filename);
  const markdown = fs.readFileSync(filename, 'utf8');
  const result = new Set();
  const occurrences = new Map();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/);
    if (!heading) continue;
    const slug = heading[1].replace(/<[^>]*>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = occurrences.get(slug) || 0;
    occurrences.set(slug, count + 1);
    result.add(count ? `${slug}-${count}` : slug);
  }
  for (const match of markdown.matchAll(/<(?:a|[^>]+)\s[^>]*(?:name|id)=["']([^"']+)["']/g)) {
    result.add(match[1]);
  }
  anchorCache.set(filename, result);
  return result;
}
let links = 0;
const failures = [];
for (const document of documents) {
  const markdown = fs.readFileSync(document, 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const [filename, fragment] = target.split('#');
    const resolved = filename ? path.resolve(path.dirname(document), decodeURIComponent(filename)) : path.resolve(document);
    links++;
    if (!fs.existsSync(resolved)) {
      failures.push(`${document}: missing file ${target}`);
    } else if (fragment && resolved.endsWith('.md') && !anchors(resolved).has(decodeURIComponent(fragment))) {
      failures.push(`${document}: missing anchor ${target}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`Broken local documentation links:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${links} local file/anchor links in ${documents.length} documents.\n`);
}
