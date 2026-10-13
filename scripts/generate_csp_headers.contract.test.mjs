import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  CLOUDFLARE_MAX_HEADER_LINE_LENGTH,
  generateCspArtifacts,
  generate,
  rewriteHeaderPolicy,
} from './generate_csp_headers.mjs';

const sourceHeaders = `/*
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors https://web.telegram.org; script-src 'self' https://telegram.org https://auth.privy.io https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.example.test; worker-src 'self'; manifest-src 'self'; report-uri /csp-report; upgrade-insecure-requests

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
`;

function fixtureHtml() {
  return '<!doctype html><html><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width"/><link rel="preload" as="script" href="/bootstrap.js"/><script>window.__next_f = [];</script><script>window.__next_f.push([0]);</script></head><body></body></html>';
}

test('isolated export generation leaves the concurrently served default export untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fxaeon-csp-output-'));
  try {
    await Promise.all(['public', 'dist', 'dist-preview'].map(name => mkdir(join(root, name))));
    await writeFile(join(root, 'public', '_headers'), sourceHeaders);
    await writeFile(join(root, 'dist', 'index.html'), fixtureHtml());
    await writeFile(join(root, 'dist-preview', 'index.html'), fixtureHtml());
    await generate(root, 'dist-preview');
    assert.equal(await readFile(join(root, 'dist', 'index.html'), 'utf8'), fixtureHtml());
    assert.match(await readFile(join(root, 'dist-preview', 'index.html'), 'utf8'), /data-fxaeon-generated-csp/);
    assert.match(await readFile(join(root, 'dist-preview', '_headers'), 'utf8'), /Content-Security-Policy:/);
    await assert.rejects(generate(root, '../dist'), /simple directory name/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  }
});

test('splits CSP into a short HTTP policy and a strict early per-document meta policy', () => {
  const html = fixtureHtml();
  const generated = generateCspArtifacts(sourceHeaders, html);
  const headerLine = rewriteHeaderPolicy(sourceHeaders, generated.headerPolicy)
    .split(/\r?\n/).find((line) => /Content-Security-Policy:/i.test(line));
  const meta = generated.html.match(/<meta\b[^>]*\bhttp-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  const content = meta?.match(/\bcontent="([^"]*)"/i)?.[1];
  const decoded = content?.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  assert.ok(headerLine);
  assert.ok(headerLine.length <= CLOUDFLARE_MAX_HEADER_LINE_LENGTH);
  assert.match(generated.headerPolicy, /frame-ancestors https:\/\/web\.telegram\.org/);
  assert.doesNotMatch(generated.headerPolicy, /(?:^|;\s*)(?:default-src|script-src)\b/i);
  assert.ok(decoded);
  assert.match(decoded, /default-src 'self'/);
  assert.match(decoded, /script-src 'self' https:\/\/telegram\.org https:\/\/auth\.privy\.io https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(decoded.match(/(?:^|;\s*)script-src\s+([^;]+)/i)?.[1] ?? '', /'unsafe-inline'/);
  assert.doesNotMatch(decoded, /(?:^|;\s*)(?:frame-ancestors|report-uri|report-to|sandbox)\b/i);

  const expectedHashes = [...new Set([
    'window.__next_f = [];',
    'window.__next_f.push([0]);',
  ].map((source) => `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`))].sort();
  const emittedHashes = [...decoded.matchAll(/'sha256-[A-Za-z0-9+/]+={0,2}'/g)].map((match) => match[0]).sort();
  assert.deepEqual(emittedHashes, expectedHashes);

  const charsetEnd = generated.html.indexOf('/>', generated.html.indexOf('<meta charSet')) + 2;
  const metaIndex = generated.html.indexOf('<meta http-equiv="Content-Security-Policy"');
  const firstScript = generated.html.search(/<(?:script\b|link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="script"))/i);
  assert.equal(metaIndex, charsetEnd);
  assert.ok(metaIndex < firstScript);
});

test('generation is idempotent and replaces only the generator-owned meta element', () => {
  const first = generateCspArtifacts(sourceHeaders, fixtureHtml());
  const second = generateCspArtifacts(sourceHeaders, first.html);
  assert.equal(second.html, first.html);
  assert.equal(second.metaPolicy, first.metaPolicy);
  assert.equal(second.headerPolicy, first.headerPolicy);
  assert.equal((second.html.match(/http-equiv="Content-Security-Policy"/g) ?? []).length, 1);
});

test('Cloudflare header contract rejects oversized lines and unmanaged CSP metas', () => {
  const valid = generateCspArtifacts(sourceHeaders, fixtureHtml());
  const rewritten = rewriteHeaderPolicy(sourceHeaders, valid.headerPolicy);
  assert.equal(rewritten.split(/\r?\n/).filter((line) => /Content-Security-Policy:/i.test(line)).length, 1);
  assert.ok(rewritten.split(/\r?\n/).every((line) => line.length <= CLOUDFLARE_MAX_HEADER_LINE_LENGTH));
  assert.throws(() => rewriteHeaderPolicy(sourceHeaders, 'x'.repeat(CLOUDFLARE_MAX_HEADER_LINE_LENGTH)), /exceeds 2000 characters/);
  assert.throws(
    () => generateCspArtifacts(sourceHeaders, '<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><script>1</script></head></html>'),
    /unmanaged Content-Security-Policy meta/,
  );
});
