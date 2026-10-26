import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import type { ReactElement, ReactNode } from 'react';
import { collateralScenarioLtv } from '../src/lib/borrowSensitivity';
import { tradeSensitivity, tradeScenarioPrice, tradeMarketReference } from '../src/lib/tradeSensitivity';

const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as { transformSync: (source: string, options: object) => { code: string } };
const MissingValue = () => null;
const chartRef = () => undefined;
let shock = -20;
let liveStatus = 'paused';
let priceStatus = 'unavailable';
const imports: Record<string, unknown> = {
  react: { useState: () => [shock, () => undefined] },
  'next/link': { default: () => null },
  './PriceProvider': { useLiveMarketQuote: () => ({ status: liveStatus, isFresh: false }), useUsdPrices: () => ({ status: priceStatus, prices: {}, updatedAt: null }) },
  './MissingValue': { MissingValue }, './InfoHelp': { MetricLabel: () => null },
  './TokenIcon': { ChainIcon: () => null },
  './useChartWidth': { useChartWidth: () => ({ ref: chartRef, width: 260 }) },
  '@/lib/borrowSensitivity': { collateralScenarioLtv },
  '@/lib/tradeSensitivity': { tradeSensitivity, tradeScenarioPrice, tradeMarketReference },
  '@/lib/fx/useBorrowFundingRate': { useBorrowFundingRate: () => ({ rate: null, status: 'unavailable' }) },
  '@/lib/fx/usePoolCapacity': { usePoolCapacity: () => ({ value: null, status: 'unavailable' }) },
  '@/lib/fx/useOracleObservation': { useOracleObservation: () => ({ value: null, status: 'unavailable' }) },
  '@/lib/fx/useOracleMarketDifference': { useOracleMarketDifference: () => null },
  '@/lib/fx/poolCapacity': { poolCapacityUnits: () => ({ collateralSymbol: 'ETH', debtSymbol: 'fxUSD' }) },
  '@/lib/fx/borrowFunding': { borrowFundingDisplay: () => null },
};
function load(name: string) {
  const source = readFileSync(new URL('../src/components/' + name + '.tsx', import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
  const module = { exports: {} as Record<string, (props: object) => ReactElement> };
  runInNewContext(code, { module, exports: module.exports, require: (path: string) => path.endsWith('.css') ? { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) } : imports[path] ?? require(path), Date });
  return module.exports;
}
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object' && 'props' in node) return text((node as ReactElement<{ children?: ReactNode }>).props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

test('Borrow empty state is a compact prompt and restores its retained shock only with usable amounts', () => {
  const { BorrowSensitivity } = load('BorrowSensitivity');
  const unit = 10n ** 18n;
  shock = -20;
  const empty = BorrowSensitivity({ debt: 0n, collateralUsd: unit, limitBps: 8550n });
  assert.match(text(empty), /Enter collateral and debt/);
  assert.doesNotMatch(text(empty), /Estimated LTV|Collateral change|0%/);
  assert.equal(elements(empty).filter(node => node.type === 'svg' || node.type === 'input').length, 0);
  assert.equal(elements(empty).some(node => (node.props as { className?: string }).className === 'empty'), false);
  const populated = BorrowSensitivity({ debt: unit, collateralUsd: 2n * unit, limitBps: 8550n });
  const slider = elements(populated).find(node => node.type === 'input')!;
  assert.equal((slider.props as { value: number }).value, -20);
  assert.match(text(populated), /62.50%/);
});

test('Borrow SVG measures its unpadded plot wrapper rather than the padded section', () => {
  const { BorrowSensitivity } = load('BorrowSensitivity');
  const tree = BorrowSensitivity({ debt: 1n, collateralUsd: 2n, limitBps: 8550n });
  const measured = elements(tree).filter(node => (node.props as { ref?: unknown }).ref === chartRef);
  assert.equal(measured.length, 1);
  assert.equal(measured[0].type, 'div');
  assert.equal((measured[0].props as { className?: string }).className, undefined);
  const svg = elements((measured[0].props as { children: ReactNode }).children).find(node => node.type === 'svg')!;
  assert.equal((svg.props as { viewBox: string }).viewBox, '0 0 260 148');
});

test('Trade shows terminal price unavailability for a paused socket, and loading only for a pending source', () => {
  const { TradeContext } = load('TradeContext');
  for (const [socket, prices, expected] of [['paused', 'unavailable', 'unavailable'], ['paused', 'ready', 'unavailable'], ['paused', 'loading', 'loading'], ['connecting', 'unavailable', 'loading'], ['unavailable', 'unavailable', 'unavailable']]) {
    liveStatus = socket; priceStatus = prices;
    const tree = TradeContext({ market: 'ETH', side: 'long', leverage: 2, openPositions: null, positionsStatus: 'disconnected' });
    const metric = elements(tree).find(node => node.type === MissingValue && (node.props as { label: string }).label === 'Scenario price')!;
    assert.equal((metric.props as { status: string }).status, expected, socket + '/' + prices);
  }
});
