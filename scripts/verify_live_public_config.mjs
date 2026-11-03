import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRevision, verifyReleaseRevision } from './release_revision.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ORIGIN = 'https://fxaeon.com';
const WALLET_CONFIG_PROBE_PATH = '/portfolio';
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_MATCHES = 16;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateChunkPath(path) {
  if (typeof path !== 'string' || path.length > 300
    || path.split('/').some(segment => segment === '.' || segment === '..')
    || !/^\/_next\/static\/chunks\/(?:(?:[A-Za-z0-9_.-]+|\[[A-Za-z0-9_-]+\])\/)*[A-Za-z0-9_-]+[.-][a-f0-9]{8,64}\.js$/.test(path)) {
    throw new Error('Invalid hashed artifact chunk path');
  }
  return path;
}

/** Discover only local build chunks; remote HTML/runtime code never supplies fallback paths. */
export async function discoverConfigChunks(artifactDir, expectedValue, revision) {
  if (typeof expectedValue !== 'string' || !/^[a-z0-9]{20,64}$/i.test(expectedValue)) throw new Error('Invalid public app ID');
  const root = resolve(artifactDir);
  if (await realpath(root) !== root) throw new Error('Artifact directory must not resolve through a symlink');
  const marker = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
  if (marker.revision !== validateRevision(revision)) throw new Error('Local artifact revision mismatch');
  const matches = [];
  let entries = 0;
  let bytes = 0;
  async function walk(directory, prefix) {
    if (await realpath(directory) !== directory) throw new Error('Artifact chunks must not resolve through a symlink');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 4096) throw new Error('Artifact entry limit exceeded');
      if (entry.isSymbolicLink()) throw new Error('Artifact symlink rejected');
      const file = join(directory, entry.name);
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(file, path);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        validateChunkPath(path);
        const size = (await lstat(file)).size;
        bytes += size;
        if (size > MAX_CHUNK_BYTES || bytes > 128 * 1024 * 1024) throw new Error('Artifact byte limit exceeded');
        const source = await readFile(file);
        if (source.includes(expectedValue)) {
          matches.push({ path, sha256: digest(source) });
          if (matches.length > MAX_MATCHES) throw new Error('Too many public configuration chunks');
        }
      }
    }
  }
  await walk(join(root, '_next', 'static', 'chunks'), '/_next/static/chunks');
  if (!matches.length) throw new Error('Local artifact has no public configuration chunks');
  return matches;
}

async function fetchBytes(url, fetchImpl, maxBytes) {
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'User-Agent': 'FxAeon-live-config-verifier' }, signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200 || response.redirected || (response.url && response.url !== url.href)) {
    throw new Error('Deployment returned an unexpected response');
  }
  if (!response.body) throw new Error('Deployment returned an empty response');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Deployment response byte limit exceeded'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

export async function verifyLivePublicConfig({ expectedValue, revision, artifactDir = join(REPO_ROOT, 'apps/mini-app/dist'),
  fetchImpl = globalThis.fetch } = {}) {
  const chunks = await discoverConfigChunks(artifactDir, expectedValue, revision);
  // Also enforce ordering here, independently of the preceding deployment workflow gate.
  await verifyReleaseRevision(revision, { fetchImpl, attempts: 1 });
  const walletConfigUrl = new URL(WALLET_CONFIG_PROBE_PATH, APP_ORIGIN);
  walletConfigUrl.searchParams.set('deployment', revision);
  const html = (await fetchBytes(walletConfigUrl, fetchImpl, 2 * 1024 * 1024)).toString('utf8');
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/giu)];
  if (!/<html[\s>]/i.test(html) || references.length === 0 || references.length > 100
    || !references.some(([, path]) => {
      const url = new URL(path, walletConfigUrl);
      return url.origin === APP_ORIGIN && url.pathname.startsWith('/_next/static/chunks/');
    })) throw new Error('Portfolio HTML did not reference the wallet JavaScript bundle');
  for (const chunk of chunks) {
    const url = new URL(validateChunkPath(chunk.path), APP_ORIGIN);
    const live = await fetchBytes(url, fetchImpl, MAX_CHUNK_BYTES);
    if (digest(live) !== chunk.sha256) throw new Error('Live configuration chunk differs from the release artifact');
  }
  return { verified: true, chunkCount: chunks.length };
}

export async function main(env = process.env) {
  if (env.LIVE_APP_URL && ![APP_ORIGIN, `${APP_ORIGIN}/`].includes(env.LIVE_APP_URL)) throw new Error('LIVE_APP_URL must be https://fxaeon.com');
  const attempts = Number(env.LIVE_CONFIG_ATTEMPTS ?? 18);
  const intervalMs = Number(env.LIVE_CONFIG_INTERVAL_MS ?? 10_000);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 20
    || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 30_000) throw new Error('Invalid retry limits');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await verifyLivePublicConfig({ expectedValue: env.EXPECTED_PUBLIC_PRIVY_APP_ID, revision: env.GITHUB_SHA });
      console.log('Live FxAeon wallet configuration matches the verified release artifact.');
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, intervalMs));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Live deployment configuration check failed.');
    process.exitCode = 1;
  });
}
