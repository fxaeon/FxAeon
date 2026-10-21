import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { findCloudflareRuleForHeader } from './cloudflare_headers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps', 'mini-app', 'dist');

// These are deliberately conservative release guardrails, not performance
// claims. They catch an accidental server dependency, source-map upload, or
// eager import of an unrelated SDK without tying CI to a machine-specific
// measurement. Route-level code splitting keeps the trading SDK lazy enough
// for the Telegram WebView.
const MAX_STATIC_BYTES = 12 * 1024 * 1024;
const MAX_JS_BYTES = 8 * 1024 * 1024;
const MAX_JS_GZIP_BYTES = 3 * 1024 * 1024;
const MAX_SINGLE_JS_BYTES = 2 * 1024 * 1024;
const MAX_CLOUDFLARE_HEADER_LINE_LENGTH = 2_000;

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function parseMetaCsp(html) {
  const metas = [...html.matchAll(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy'|Content-Security-Policy\b))[^>]*\/?>/gi)];
  if (metas.length !== 1) return { error: `expected one CSP meta policy; found ${metas.length}` };
  const content = metas[0][0].match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (content === undefined) return { error: 'CSP meta policy has no content attribute' };
  const policy = content
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return { policy, index: metas[0].index, end: metas[0].index + metas[0][0].length };
}

function parseDirective(policy, name) {
  return policy.split(';').map((item) => item.trim()).find((item) => item.split(/\s+/, 1)[0]?.toLowerCase() === name)?.split(/\s+/).slice(1) ?? [];
}

function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1]) hashes.add(`'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  }
  return hashes;
}

function verifyCspArtifacts(headers, htmlFiles) {
  const failures = [];
  const headerLines = headers.split(/\r?\n/);
  const tooLong = headerLines.findIndex((line) => line.length > MAX_CLOUDFLARE_HEADER_LINE_LENGTH);
  if (tooLong >= 0) failures.push(`deployed _headers line ${tooLong + 1} exceeds Cloudflare's ${MAX_CLOUDFLARE_HEADER_LINE_LENGTH}-character limit`);

  const httpCspLines = headerLines.filter((line) => /^\s*Content-Security-Policy\s*:/i.test(line));
  if (httpCspLines.length !== 1) {
    failures.push(`deployed _headers must contain exactly one CSP policy; found ${httpCspLines.length}`);
  }
  const httpPolicy = httpCspLines[0]?.replace(/^\s*Content-Security-Policy\s*:\s*/i, '') ?? '';
  if (httpPolicy && /(?:^|;\s*)(?:default-src|script-src)\b/i.test(httpPolicy)) {
    failures.push('HTTP CSP must not add default-src or script-src restrictions that can block the per-document policy');
  }
  if (httpPolicy && !/(?:^|;\s*)frame-ancestors\b/i.test(httpPolicy)) {
    failures.push('HTTP CSP must retain frame-ancestors because meta policies cannot enforce it');
  }
  const cspLineIndex = headerLines.findIndex((line) => /^\s*Content-Security-Policy\s*:/i.test(line));
  const cspRule = cspLineIndex < 0 ? null : findCloudflareRuleForHeader(headerLines, cspLineIndex);
  if (cspRule !== '/*') {
    failures.push('HTTP CSP must be in the single global /* rule');
  }
  if (htmlFiles.length === 0) failures.push('static export contains no HTML documents');

  for (const file of htmlFiles) {
    const html = file.contents;
    const meta = parseMetaCsp(html);
    if (meta.error) {
      failures.push(`${file.name}: ${meta.error}`);
      continue;
    }
    const scriptSources = parseDirective(meta.policy, 'script-src');
    if (!scriptSources.length) failures.push(`${file.name}: meta CSP has no script-src`);
    if (scriptSources.includes("'unsafe-inline'")) failures.push(`${file.name}: meta script-src must not allow unsafe-inline`);
    if (!parseDirective(meta.policy, 'default-src').includes("'self'")) failures.push(`${file.name}: meta CSP is missing default-src 'self'`);
    for (const unsupported of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) {
      if (parseDirective(meta.policy, unsupported).length || new RegExp(`(?:^|;\\s*)${unsupported}(?:\\s|;|$)`, 'i').test(meta.policy)) {
        failures.push(`${file.name}: meta CSP contains unsupported ${unsupported}`);
      }
    }
    const actualHashes = new Set(scriptSources.filter((source) => /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(source)));
    const expectedHashes = inlineScriptHashes(html);
    if (actualHashes.size !== expectedHashes.size || [...expectedHashes].some((hash) => !actualHashes.has(hash))) {
      failures.push(`${file.name}: meta CSP script hashes do not exactly cover its inline scripts`);
    }

    const charset = /<meta\b[^>]*\bcharset\s*=\s*(?:"[^"]+"|'[^']+'|[^\s/>]+)[^>]*\/?>/i.exec(html);
    const head = /<head\b[^>]*>/i.exec(html);
    const firstExecutable = /<(?:script\b|link\b(?=[^>]*\brel\s*=\s*["']?preload\b)(?=[^>]*\bas\s*=\s*["']?script\b))[^>]*>/i.exec(html);
    if (!head || !charset || charset.index < head.index + head[0].length
      || meta.index < charset.index + charset[0].length
      || (firstExecutable && meta.end > firstExecutable.index)) {
      failures.push(`${file.name}: CSP meta must follow charset and precede every script/preload`);
    }
  }
  return failures;
}

try {
  const files = await walk(dist);
  const sourceMaps = files.filter((file) => file.endsWith('.map'));
  const assets = files.filter((file) => !file.endsWith('.map'));
  const javascript = assets.filter((file) => file.endsWith('.js'));
  const assetSizes = await Promise.all(assets.map(async (file) => (await fs.stat(file)).size));
  const staticBytes = assetSizes.reduce((total, bytes) => total + bytes, 0);
  const jsSizes = await Promise.all(javascript.map(async (file) => ({
    file,
    bytes: (await fs.stat(file)).size,
  })));
  const jsBytes = jsSizes.reduce((total, item) => total + item.bytes, 0);
  const gzippedJavaScript = await Promise.all(javascript.map(async (file) => gzipSync(await fs.readFile(file), { level: 9 }).byteLength));
  const jsGzipBytes = gzippedJavaScript.reduce((total, bytes) => total + bytes, 0);
  const largest = [...jsSizes].sort((a, b) => b.bytes - a.bytes)[0];
  const deployedHeaders = await fs.readFile(path.join(dist, '_headers'), 'utf8');
  const forbiddenTelemetryPattern = /(?:sentry\.hcaptcha\.com|@hcaptcha\/sentry|@sentry\/(?:node|browser)|SENTRY_DSN)/i;
  const telemetryAssets = [];
  for (const file of javascript) {
    if (forbiddenTelemetryPattern.test(await fs.readFile(file, 'utf8'))) telemetryAssets.push(file);
  }

  const failures = [];
  if (sourceMaps.length) failures.push(`source maps must not be published (${sourceMaps.length} found)`);
  if (staticBytes > MAX_STATIC_BYTES) failures.push(`static assets exceed ${formatBytes(MAX_STATIC_BYTES)}`);
  if (jsBytes > MAX_JS_BYTES) failures.push(`JavaScript exceeds ${formatBytes(MAX_JS_BYTES)} by ${(jsBytes - MAX_JS_BYTES).toLocaleString('en-US')} bytes`);
  if (jsGzipBytes > MAX_JS_GZIP_BYTES) failures.push(`gzipped JavaScript exceeds ${formatBytes(MAX_JS_GZIP_BYTES)}`);
  if (largest && largest.bytes > MAX_SINGLE_JS_BYTES) {
    failures.push(`single JavaScript asset exceeds ${formatBytes(MAX_SINGLE_JS_BYTES)}: ${path.relative(root, largest.file)}`);
  }
  const htmlFiles = await Promise.all(assets.filter((file) => file.endsWith('.html')).map(async (file) => ({
    name: path.relative(dist, file).replaceAll('\\', '/'),
    contents: await fs.readFile(file, 'utf8'),
  })));
  failures.push(...verifyCspArtifacts(deployedHeaders, htmlFiles));
  if (telemetryAssets.length) {
    failures.push(`paid/error telemetry code or DSN found in JavaScript (${telemetryAssets.length} assets)`);
  }

  console.log(`[bundle] ${assets.length} assets, ${formatBytes(staticBytes)} total`);
  console.log(`[bundle] ${javascript.length} JavaScript assets, ${formatBytes(jsBytes)} raw, ${formatBytes(jsGzipBytes)} gzip`);
  if (largest) console.log(`[bundle] largest JavaScript asset: ${path.relative(root, largest.file)} (${formatBytes(largest.bytes)})`);
  if (htmlFiles.length) console.log(`[bundle] CSP: ${htmlFiles.length} exported documents checked; one global header rule is within Cloudflare's line limit`);
  if (failures.length) {
    console.error(`[bundle] FAIL: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('[bundle] PASS: static bundle is within release budgets');
  }
} catch (error) {
  console.error(`[bundle] unable to inspect ${path.relative(root, dist)}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
