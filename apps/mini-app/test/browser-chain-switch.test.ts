import assert from 'node:assert/strict';
import { test } from 'node:test';
import { switchBrowserChain } from '../src/lib/wallet/switchBrowserChain';
import type { FxChainId } from '../src/lib/fx/types';

type Request = { method: string; params?: unknown[] };
const ETH_RPC = 'https://eth-mainnet.g.alchemy.com/v2/test-browser-key';
const BASE_RPC = 'https://base-mainnet.g.alchemy.com/v2/test-browser-key';
const unknownChain = { code: 4902, message: 'Unknown chain' };
const nestedUnknownChain = { code: -32603, data: { originalError: unknownChain } };

test('known wallet networks switch without resolving any app RPC metadata', async () => {
  for (const [chainId, hexChainId] of [[1, '0x1'], [8453, '0x2105']] as const) {
    const requests: Request[] = [];
    await switchBrowserChain({ request: async (request) => { requests.push(request); return null; } }, chainId, () => {
      assert.fail('A known wallet network must not read or validate RPC configuration');
    });
    assert.deepEqual(requests, [{ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] }]);
  }
});

test('user rejection and non-4902 errors propagate unchanged without adding a network', async () => {
  for (const rejection of [{ code: 4001, message: 'Rejected by user' }, { code: -32002 }, { code: '4902' }, new Error('Provider unavailable'), null]) {
    const requests: Request[] = [];
    await assert.rejects(switchBrowserChain({ request: async (request) => { requests.push(request); throw rejection; } }, 1, () => {
      assert.fail('A rejection must not trigger metadata resolution');
    }), (cause: unknown) => cause === rejection);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'wallet_switchEthereumChain');
  }
});

test('4902 lazily validates metadata and adds then switches the requested network', async () => {
  for (const [chainId, hexChainId, rpcUrl, chainName, explorer] of [
    [1, '0x1', ETH_RPC, 'Ethereum Mainnet', 'https://etherscan.io'],
    [8453, '0x2105', BASE_RPC, 'Base', 'https://basescan.org'],
  ] as const) {
    const requests: Request[] = [];
    let resolutions = 0;
    await switchBrowserChain({ request: async (request) => {
      requests.push(request);
      if (requests.length === 1) throw unknownChain;
      return null;
    } }, chainId, () => {
      resolutions += 1;
      assert.equal(requests.length, 1, 'Metadata must resolve only after the initial switch failed');
      return { configuredRpcUrl: rpcUrl };
    });
    assert.equal(resolutions, 1);
    assert.deepEqual(requests, [
      { method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] },
      { method: 'wallet_addEthereumChain', params: [{ chainId: hexChainId, chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [explorer], rpcUrls: [rpcUrl] }] },
      { method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] },
    ]);
  }
});

test('MetaMask Mobile nested 4902 adds and switches only the requested supported network', async () => {
  for (const [chainId, hexChainId, rpcUrl] of [[1, '0x1', ETH_RPC], [8453, '0x2105', BASE_RPC]] as const) {
    const requests: Request[] = [];
    let resolutions = 0;
    await switchBrowserChain({ request: async (request) => {
      requests.push(request);
      if (requests.length === 1) throw nestedUnknownChain;
      return null;
    } }, chainId, () => {
      resolutions += 1;
      assert.equal(requests.length, 1, 'Nested errors must still resolve metadata lazily');
      return { configuredRpcUrl: rpcUrl };
    });
    assert.equal(resolutions, 1);
    assert.deepEqual(requests.map((request) => request.method), [
      'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain',
    ]);
    assert.deepEqual(requests[0].params, [{ chainId: hexChainId }]);
    assert.deepEqual(requests[2].params, [{ chainId: hexChainId }]);
    const metadata = requests[1].params?.[0] as { chainId: string; rpcUrls: string[] };
    assert.equal(metadata.chainId, hexChainId);
    assert.deepEqual(metadata.rpcUrls, [rpcUrl]);
  }
});

test('nested rejection, generic errors, and malformed lookalikes never add a network', async () => {
  for (const rejection of [
    { code: 4001, data: { originalError: unknownChain } },
    { code: -32603, data: { originalError: { code: 4001 } } },
    { code: -32603, data: { originalError: { code: -32002 } } },
    { code: -32603, data: { originalError: { code: '4902' } } },
    { code: -32603, data: { originalError: null } },
    { code: -32603, data: { originalError: '4902' } },
    { code: -32603, data: null },
    { code: -32603, data: '4902' },
    { code: -32603, data: { code: 4902 } },
    { code: -32603, cause: unknownChain },
    new Error('Unknown chain 4902'),
  ]) {
    const requests: Request[] = [];
    await assert.rejects(switchBrowserChain({ request: async (request) => {
      requests.push(request);
      throw rejection;
    } }, 1, () => assert.fail('Only an explicit supported unknown-chain error may resolve metadata')),
    (cause: unknown) => cause === rejection);
    assert.deepEqual(requests, [{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }]);
  }
});

test('nested 4902 still rejects missing or unreviewed RPC metadata before network add', async () => {
  for (const configuredRpcUrl of [undefined, 'https://example.com/rpc', BASE_RPC]) {
    const requests: Request[] = [];
    await assert.rejects(switchBrowserChain({ request: async (request) => {
      requests.push(request);
      throw nestedUnknownChain;
    } }, 1, () => ({ configuredRpcUrl })), /Add Ethereum or Base in the wallet/);
    assert.equal(requests.length, 1);
  }
});

test('4902 with missing or unvalidated RPC metadata never asks the wallet to add a network', async () => {
  for (const configuredRpcUrl of [undefined, '', 'https://example.com/rpc', BASE_RPC, ETH_RPC.replace('https:', 'http:'), `${ETH_RPC}?private=value`, 'https://user:secret@eth-mainnet.g.alchemy.com/v2/key']) {
    const requests: Request[] = [];
    await assert.rejects(switchBrowserChain({ request: async (request) => { requests.push(request); throw unknownChain; } }, 1, () => ({ configuredRpcUrl })), (cause: unknown) => {
      assert.ok(cause instanceof Error);
      assert.match(cause.message, /Add Ethereum or Base in the wallet/);
      assert.doesNotMatch(cause.message, /example\.com|test-browser-key|private=value|user:secret/);
      return true;
    });
    assert.equal(requests.length, 1);
  }
});

test('unknown networks receive the full validated provider list without duplicate URLs', async () => {
  const requests: Request[] = [];
  const infura = 'https://mainnet.infura.io/v3/test-project';
  const secondAlchemy = 'https://eth-mainnet.g.alchemy.com/v2/second-key';
  await switchBrowserChain({ request: async (request) => {
    requests.push(request);
    if (requests.length === 1) throw unknownChain;
    return null;
  } }, 1, () => ({ configuredRpcUrls: [ETH_RPC, secondAlchemy, infura, ETH_RPC] }));
  assert.deepEqual((requests[1].params?.[0] as { rpcUrls: string[] }).rpcUrls, [ETH_RPC, secondAlchemy, infura]);

  for (const urls of [[], [ETH_RPC, BASE_RPC], [ETH_RPC, 'https://evil.infura.io/v3/key']]) {
    let calls = 0;
    await assert.rejects(switchBrowserChain({ request: async () => {
      calls += 1;
      throw unknownChain;
    } }, 1, () => ({ configuredRpcUrls: urls })), /Add Ethereum or Base/);
    assert.equal(calls, 1, 'Invalid fallback metadata must not reach wallet_addEthereumChain');
  }
});

test('explicit disposable-fork metadata remains localhost-only before add and switch', async () => {
  const requests: Request[] = [];
  await switchBrowserChain({ request: async (request) => {
    requests.push(request);
    if (requests.length === 1) throw unknownChain;
    return null;
  } }, 1, () => ({ localForkRpcUrl: 'http://127.0.0.1:8545/' }));
  assert.equal(requests[1].method, 'wallet_addEthereumChain');
  assert.deepEqual((requests[1].params?.[0] as { rpcUrls: string[] }).rpcUrls, ['http://127.0.0.1:8545']);
  assert.equal(requests[2].method, 'wallet_switchEthereumChain');

  let invalidRequests = 0;
  await assert.rejects(switchBrowserChain({ request: async () => { invalidRequests += 1; throw unknownChain; } }, 1, () => ({
    localForkRpcUrl: 'http://example.com:8545', configuredRpcUrl: ETH_RPC,
  })), /Add Ethereum or Base/);
  assert.equal(invalidRequests, 1, 'An invalid explicit fork URL must not silently fall back to production RPC metadata');
});

test('network-add rejection propagates without attempting a second switch', async () => {
  const rejection = { code: 4001, message: 'Add rejected' };
  const requests: Request[] = [];
  await assert.rejects(switchBrowserChain({ request: async (request) => {
    requests.push(request);
    throw requests.length === 1 ? unknownChain : rejection;
  } }, 1, () => ({ configuredRpcUrl: ETH_RPC })), (cause: unknown) => cause === rejection);
  assert.deepEqual(requests.map((request) => request.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain']);
});

test('a failed switch after adding the network is not reported as success', async () => {
  const rejection = { code: 4001, message: 'Final switch rejected' };
  const requests: Request[] = [];
  await assert.rejects(switchBrowserChain({ request: async (request) => {
    requests.push(request);
    if (requests.length === 1) throw unknownChain;
    if (requests.length === 3) throw rejection;
    return null;
  } }, 1, () => ({ configuredRpcUrl: ETH_RPC })), (cause: unknown) => cause === rejection);
  assert.equal(requests.length, 3);
});

test('unsupported chain IDs fail before any wallet request or metadata lookup', async () => {
  await assert.rejects(switchBrowserChain({ request: async () => assert.fail('Unsupported chain must not reach the wallet') }, 137 as FxChainId, () => {
    assert.fail('Unsupported chain must not resolve metadata');
  }), /Unsupported FxAeon chain/);
});
