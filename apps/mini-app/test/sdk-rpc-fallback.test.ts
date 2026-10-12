import assert from 'node:assert/strict';
import test from 'node:test';
import { FxSdk } from '@aladdindao/fx-sdk';
import { getRpcTransport } from '../src/lib/fx/clients';
import { configuredRpcUrls } from '../src/lib/fx/config';
import { asFxSdkRpcTransport } from '../src/lib/fx/sdk';
import type { FxChainId } from '../src/lib/fx/types';

const FIXTURE_ENV = {
  NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: 'https://eth-mainnet.g.alchemy.com/v2/primary',
  NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL: 'https://mainnet.infura.io/v3/infura',
  NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL: 'https://eth-mainnet.g.alchemy.com/v2/alchemy2',
  NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/primary',
  NEXT_PUBLIC_INFURA_BASE_RPC_URL: 'https://base-mainnet.infura.io/v3/infura',
  NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/alchemy2',
  NEXT_PUBLIC_FX_SCREENSHOT_MODE: '0',
  NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE: '0',
} as const;

/** Resolve the actual app configuration, restoring the environment before any
 * asynchronous SDK work so fixture endpoints cannot leak between tests. */
function configuredFixtureUrls(chainId: FxChainId): string[] {
  const keys = Object.keys(FIXTURE_ENV) as (keyof typeof FIXTURE_ENV)[];
  const previous = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => { process.env[key] = FIXTURE_ENV[key]; });
    return configuredRpcUrls(chainId);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}

type Provider = 'primary' | 'infura' | 'alchemy2';
function provider(url: string): Provider {
  const endpoint = new URL(url);
  if (endpoint.hostname === 'mainnet.infura.io' || endpoint.hostname === 'base-mainnet.infura.io') return 'infura';
  return endpoint.pathname === '/v2/alchemy2' ? 'alchemy2' : 'primary';
}

function rpcFetch(chainId: FxChainId, failed: readonly Provider[] = [], reverted?: Provider) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push({ url, method: payload.method });
    if (payload.method === 'eth_chainId') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: `0x${chainId.toString(16)}` }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    assert.equal(payload.method, 'eth_call');
    if (failed.includes(provider(url))) throw new TypeError('fetch failed');
    const body = provider(url) === reverted
      ? { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'execution reverted' } }
      : { jsonrpc: '2.0', id: payload.id, result: `0x${'0'.repeat(63)}1${'0'.repeat(64)}` };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchFn };
}

// FxSdk's ordinary read client is a process singleton. Bridge quotes must use
// their request-local source transport; any accidental canonical read fails
// locally instead of reaching a real RPC endpoint or reusing another fixture.
const canonicalUrl = 'https://eth-mainnet.g.alchemy.com/v2/unused-canonical';
const sdk = new FxSdk({ chainId: 1, rpcUrl: canonicalUrl,
  rpcTransport: asFxSdkRpcTransport(getRpcTransport([canonicalUrl], 1, async () => {
    throw new Error('Bridge quote unexpectedly used the SDK canonical singleton');
  })),
});
function bridgeQuote(chainId: FxChainId, fetchFn: typeof fetch) {
  const urls = configuredFixtureUrls(chainId);
  return sdk.getBridgeQuote({
    sourceChainId: chainId,
    destChainId: chainId === 1 ? 8453 : 1,
    token: 'fxUSD',
    amount: 10n ** 18n,
    recipient: '0x0000000000000000000000000000000000001234',
    sourceRpcUrls: urls,
    sourceRpcTransport: asFxSdkRpcTransport(getRpcTransport(urls, chainId, fetchFn)),
  });
}

function expectedCalls(chainId: FxChainId, providers: readonly Provider[]) {
  const host = chainId === 1 ? 'eth-mainnet.g.alchemy.com' : 'base-mainnet.g.alchemy.com';
  const infura = chainId === 1 ? 'mainnet.infura.io' : 'base-mainnet.infura.io';
  return providers.flatMap(name => {
    const url = name === 'infura' ? `https://${infura}/v3/infura` : `https://${host}/v2/${name}`;
    return [{ url, method: 'eth_chainId' }, { url, method: 'eth_call' }];
  });
}

for (const chainId of [1, 8453] as const) {
  const chainName = chainId === 1 ? 'Ethereum' : 'Base';
  for (const failed of [[], ['primary'], ['primary', 'infura']] as const) {
    const reached: readonly Provider[] = failed.length === 0 ? ['primary']
      : failed.length === 1 ? ['primary', 'infura'] : ['primary', 'infura', 'alchemy2'];
    test(`SDK ${chainName} source quote follows configured ${reached.join(' → ')} order`, async () => {
      const { calls, fetchFn } = rpcFetch(chainId, failed);
      const quote = await bridgeQuote(chainId, fetchFn);
      assert.equal(quote.nativeFee, 1n);
      assert.deepEqual(calls, expectedCalls(chainId, reached), 'each attempted endpoint proves its source chain before the paid call');
    });
  }

  for (const reverted of ['primary', 'infura'] as const) {
    test(`SDK ${chainName} source quote stops at a terminal ${reverted} contract revert`, async () => {
      const failed: readonly Provider[] = reverted === 'infura' ? ['primary'] : [];
      const { calls, fetchFn } = rpcFetch(chainId, failed, reverted);
      await assert.rejects(bridgeQuote(chainId, fetchFn), /revert/i);
      assert.deepEqual(calls, expectedCalls(chainId, [...failed, reverted]));
    });
  }
}
