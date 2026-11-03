import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverConfigChunks, validateChunkPath, verifyLivePublicConfig } from './verify_live_public_config.mjs';

const revision = 'a'.repeat(40);
const expectedValue = 'cmtilj7rl00in0cl1k68af32t';
const path = '/_next/static/chunks/3935.3d87bd4d858551d6.js';
const source = `self.config=${JSON.stringify(expectedValue)};`;
async function fixture(t, contents = source) {
  const artifactDir = await mkdtemp(join(tmpdir(), 'fxaeon-live-config-'));
  t.after(() => rm(artifactDir, { recursive: true, force: true }));
  const directory = join(artifactDir, '_next/static/chunks');
  await mkdir(directory, { recursive: true });
  await writeFile(join(artifactDir, 'release.json'), JSON.stringify({ revision }));
  await writeFile(join(artifactDir, path), contents);
  return { artifactDir, directory };
}
function remote(overrides = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(url.origin, 'https://fxaeon.com');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    const body = url.pathname === '/release.json' ? JSON.stringify({ revision })
      : url.pathname === '/portfolio' ? '<html><script src="/_next/static/chunks/layout-12345678.js"></script></html>'
        : source;
    return new Response(overrides[url.pathname] ?? body);
  } };
}

test('lazy config absent from HTML is verified against exact local hashed chunk bytes after release and route', async t => {
  const local = await fixture(t);
  const live = remote();
  assert.deepEqual(await verifyLivePublicConfig({ ...local, ...live, expectedValue, revision }), { verified: true, chunkCount: 1 });
  assert.deepEqual(live.calls.map(url => url.pathname), ['/release.json', '/portfolio', path]);
});

test('matching ID alone cannot pass altered bytes, wrong release, missing route, or missing live chunk', async t => {
  const local = await fixture(t);
  for (const [overrides, error, requests] of [
    [{ [path]: `${source}//different` }, /differs/, 3],
    [{ '/release.json': JSON.stringify({ revision: 'b'.repeat(40) }) }, /release verification failed/, 1],
    [{ '/portfolio': `<html>${expectedValue}</html>` }, /Portfolio HTML/, 2],
    [{ [path]: '<html>not found</html>' }, /differs/, 3],
  ]) {
    const live = remote(overrides);
    await assert.rejects(verifyLivePublicConfig({ ...local, ...live, expectedValue, revision }), error);
    assert.equal(live.calls.length, requests);
  }
});

test('local artifact requires expected ID, matching release, bounded match count and hashed paths', async t => {
  const local = await fixture(t, 'no configuration');
  await assert.rejects(discoverConfigChunks(local.artifactDir, expectedValue, revision), /no public configuration/);
  await assert.rejects(discoverConfigChunks(local.artifactDir, expectedValue, 'b'.repeat(40)), /revision mismatch/);
  await writeFile(join(local.directory, 'unhashed.js'), source);
  await assert.rejects(discoverConfigChunks(local.artifactDir, expectedValue, revision), /Invalid hashed/);
  await rm(join(local.directory, 'unhashed.js'));
  for (let i = 0; i < 17; i++) await writeFile(join(local.directory, `${i}-12345678.js`), source);
  await assert.rejects(discoverConfigChunks(local.artifactDir, expectedValue, revision), /Too many/);
});

test('chunk paths reject origins, traversal, encoding, queries, backslashes and unhashed names', () => {
  for (const invalid of ['https://attacker.test/a-12345678.js', '//attacker.test/a-12345678.js',
    '/_next/static/chunks/../a-12345678.js', '/_next/static/chunks/%2e%2e/a-12345678.js',
    `${path}?secret=x`, `${path}#fragment`, '/_next/static/chunks/a\\b-12345678.js', '/_next/static/chunks/plain.js']) {
    assert.throws(() => validateChunkPath(invalid), /Invalid hashed/);
  }
  assert.equal(validateChunkPath(path), path);
  for (const valid of ['/_next/static/chunks/app/docs/sdk/[topic]/page-12345678.js',
    '/_next/static/chunks/app/docs/search-index.json/route-12345678.js']) assert.equal(validateChunkPath(valid), valid);
});

test('every matching artifact chunk must match and external HTML script URLs are never fetched', async t => {
  const local = await fixture(t);
  const second = '/_next/static/chunks/second-12345678.js';
  await writeFile(join(local.artifactDir, second), source);
  const live = remote({ '/portfolio': '<html><script src="https://attacker.test/private.js"></script><script src="/_next/static/chunks/layout-12345678.js"></script></html>',
    [second]: `${source}//different` });
  await assert.rejects(verifyLivePublicConfig({ ...local, ...live, expectedValue, revision }), /differs/);
  assert.deepEqual(live.calls.map(url => url.pathname), ['/release.json', '/portfolio', path, second]);
});

test('redirects, non-200 responses and oversized live chunks fail closed', async t => {
  const local = await fixture(t);
  for (const reply of [() => new Response('', { status: 302 }), () => new Response('', { status: 404 }),
    () => new Response('x'.repeat(8 * 1024 * 1024 + 1)),
    () => ({ status: 200, redirected: true }),
    () => ({ status: 200, url: 'https://attacker.test/chunk.js' })]) {
    const live = remote();
    const fetchImpl = (url, init) => url.pathname === path ? reply() : live.fetchImpl(url, init);
    await assert.rejects(verifyLivePublicConfig({ ...local, fetchImpl, expectedValue, revision }), /unexpected response|byte limit/);
  }
});
