const fs = require('node:fs');

// Publish the existing generated construct API; no additional docs generator
// or undocumented source tree is implied by build:docs.
const api = fs.readFileSync('packages/sitemaps-cdk/API.md', 'utf8');
const escaped = api.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(
  'docs/index.html',
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Streaming Sitemaps CDK API</title>
<style>body{max-width:90ch;margin:2rem auto;padding:0 1rem;font-family:system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
</head><body><h1>Streaming Sitemaps CDK API</h1><pre>${escaped}</pre></body></html>\n`,
);
