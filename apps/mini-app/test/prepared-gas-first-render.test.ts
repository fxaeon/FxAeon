import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useRouteGasCost } from '../src/lib/fx/useGasCost';
import { routeGasCostCache } from '../src/lib/fx/gasCost';
import type { FxPublicClient, PlannedRoute } from '../src/lib/fx/types';

const wallet = '0x1111111111111111111111111111111111111111' as const;
const route: PlannedRoute = { operation: 'depositAndMint', chainId: 1, walletAddress: wallet,
  transactions: [{ chainId: 1, from: wallet, to: '0x2222222222222222222222222222222222222222', data: '0x12345678', value: 0n, kind: 'action', operation: 'depositAndMint' }] };

function Snapshot() {
  const gas = useRouteGasCost(route);
  return createElement('output', { 'data-checking': gas.checking, 'data-current': gas.estimateIsCurrent }, gas.estimate?.status ?? 'empty');
}

test('completed exact-route gas is visible on the first render before effects run', async () => {
  routeGasCostCache.clear();
  const client = { chain: { id: 1 }, getChainId: async () => 1,
    estimateGas: async () => 21_000n, estimateFeesPerGas: async () => ({ maxFeePerGas: 3n, maxPriorityFeePerGas: 1n }) } as unknown as FxPublicClient;
  await routeGasCostCache.refresh(route, { client });
  const html = renderToString(createElement(Snapshot));
  assert.match(html, /data-checking="false"/);
  assert.match(html, /data-current="true"/);
  assert.match(html, />current</);
  routeGasCostCache.clear();
});

test('a resolved unavailable estimate is final on the first frame, without an initial loading flash', async () => {
  routeGasCostCache.clear();
  const client = { chain: { id: 8453 }, getChainId: async () => 8453 } as unknown as FxPublicClient;
  await routeGasCostCache.refresh(route, { client });
  const html = renderToString(createElement(Snapshot));
  assert.match(html, /data-checking="false"/);
  assert.match(html, /data-current="false"/);
  assert.match(html, />unavailable</);
  routeGasCostCache.clear();
});
