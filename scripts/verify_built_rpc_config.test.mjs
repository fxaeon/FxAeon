import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { verifyBuiltRpcConfig } from './verify_built_rpc_config.mjs';

const primary = {
  NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: 'https://eth-mainnet.g.alchemy.com/v2/fake-primary-ethereum',
  NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/fake-primary-base',
};
const optional = {
  NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL: 'https://eth-mainnet.g.alchemy.com/v2/fake-fallback-ethereum',
  NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/fake-fallback-base',
  NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL: 'https://mainnet.infura.io/v3/fake-project-ethereum',
  NEXT_PUBLIC_INFURA_BASE_RPC_URL: 'https://base-mainnet.infura.io/v3/fake-project-base',
};
const config = { ...primary, ...optional };
const browserChunk = '_next/static/chunks/app/portfolio.js';
const literals = (values) => values.map((value) => JSON.stringify(value)).join(';');

async function artifact(t, files = {}) {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(resolve(temporaryRoot, 'fxaeon-rpc-build-'));
  t.after(async () => {
    assert.equal(dirname(directory), temporaryRoot);
    assert.ok(directory.startsWith(resolve(temporaryRoot, 'fxaeon-rpc-build-')));
    await rm(directory, { recursive: true, force: true });
  });
  for (const [name, source] of Object.entries(files)) {
    const path = resolve(directory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  return directory;
}

test('all configured providers must appear as complete browser string literals', async (t) => {
  const directory = await artifact(t, { [browserChunk]: literals(Object.values(config)) });
  assert.deepEqual(await verifyBuiltRpcConfig(directory, config), {
    inspected: 1, configured: 6, missingNames: [],
  });
});

test('each supplied optional endpoint is checked independently of the primary providers', async (t) => {
  for (const name of Object.keys(optional)) {
    const directory = await artifact(t, {
      [browserChunk]: literals(Object.entries(config).filter(([key]) => key !== name).map(([, value]) => value)),
    });
    assert.deepEqual((await verifyBuiltRpcConfig(directory, config)).missingNames, [name]);
  }
});

test('absent optional inputs stay optional and surrounding input whitespace is ignored', async (t) => {
  const directory = await artifact(t, { [browserChunk]: literals([
    ` ${primary.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL} `,
    primary.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL,
  ]) });
  const result = await verifyBuiltRpcConfig(directory, {
    ...primary,
    NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: ` ${primary.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL} `,
    NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL: '',
    NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL: '   ',
    NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL: undefined,
  });
  assert.deepEqual(result, { inspected: 1, configured: 2, missingNames: [] });
});

test('single quotes and escaped slashes retain the same configured endpoint', async (t) => {
  const values = Object.values(config);
  const directory = await artifact(t, {
    [browserChunk]: [
      ...values.slice(0, 2).map((value) => `'${value}'`),
      ...values.slice(2, 4).map((value) => JSON.stringify(value).replaceAll('/', '\\/')),
      ...values.slice(4).map((value) => `'${value.replaceAll('/', '\\/')}'`),
    ].join(';'),
  });
  assert.deepEqual((await verifyBuiltRpcConfig(directory, config)).missingNames, []);
});

test('a longer replacement key does not satisfy the configured key', async (t) => {
  const name = 'NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL';
  const directory = await artifact(t, { [browserChunk]: JSON.stringify(`${optional[name]}-replacement`) });
  assert.deepEqual((await verifyBuiltRpcConfig(directory, { [name]: optional[name] })).missingNames, [name]);
});

test('source maps, server output, HTML and manifests cannot satisfy browser inclusion', async (t) => {
  const source = literals(Object.values(optional));
  const directory = await artifact(t, {
    [browserChunk]: 'console.log("app");',
    [`${browserChunk}.map`]: source,
    'server/app/page.js': source,
    'portfolio.html': source,
    '_next/static/config.json': source,
  });
  assert.deepEqual((await verifyBuiltRpcConfig(directory, optional)).missingNames, Object.keys(optional));
});

test('missing or empty browser output fails even when optional configuration is absent', async (t) => {
  const directory = await artifact(t);
  await assert.rejects(verifyBuiltRpcConfig(directory, {}));
  await mkdir(resolve(directory, '_next/static/chunks'), { recursive: true });
  await assert.rejects(verifyBuiltRpcConfig(directory, {}), /Browser JavaScript output is missing/);
});

test('CLI fails with names-only diagnostics when supplied endpoints are missing', async (t) => {
  const directory = await artifact(t, { [browserChunk]: literals(Object.values(primary)) });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./verify_built_rpc_config.mjs', import.meta.url)), directory], {
    encoding: 'utf8', env: { ...process.env, ...config }, windowsHide: true,
  });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  for (const name of Object.keys(optional)) assert.ok(output.includes(name));
  for (const value of Object.values(config)) assert.ok(!output.includes(value));
});
