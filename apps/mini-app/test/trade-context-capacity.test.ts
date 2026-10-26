import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import ts from 'typescript';
import { formatUnits, parseUnits } from 'viem';
import { formatBalanceDecimal } from '../src/lib/amount';
import { tradeSensitivity, tradeScenarioPrice, tradeMarketReference } from '../src/lib/tradeSensitivity';
import { formatUsdPrice, USD_PRICE_MAX_AGE_MS } from '../src/lib/prices';

const file = ts.createSourceFile('TradeContext.tsx', readFileSync(new URL('../src/components/TradeContext.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
function evaluate(names: string[], expression: string, bindings = {}) {
  const code = names.map(name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(file).replace(/^export /, '')).join('\n');
  return runInNewContext(ts.transpileModule(code + '\n' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText, { React, formatUnits, formatBalanceDecimal, ...bindings });
}
const format = evaluate(['formatCapacityDisplay'], 'formatCapacityDisplay;') as (amount: bigint, decimals: number) => string;
test('capacity copy truncates large amounts and preserves magnitude, zero and positive dust', () => {
  for (const [value, expected] of [
    ['494685.3288', '≈ 494.68K'], ['140289268.9555', '≈ 140.28M'], ['999.999', '≈ 999.99'],
    ['1000', '1K'], ['999999.999', '≈ 999.99K'], ['0', '0'], ['0.000000000000000001', '<0.0001'],
    ['9007199254740993.123', '≈ 9,007,199.25B'],
  ]) assert.equal(format(parseUnits(value, 18), 18), expected, value);
  assert.equal(format(123456789n, 8), '≈ 1.23');
});

test('Trade retains exact capacity units in titles and keeps price sensitivity independent of compact copy', () => {
  const value = { collateralRemaining: parseUnits('494685.3288', 18), debtRemaining: parseUnits('140289268.9555', 18) };
  const before = { ...value };
  const nothing = () => null;
  const tree = evaluate(['formatCapacityDisplay', 'TradeContext'], "TradeContext({ market: 'ETH', side: 'short', leverage: 2, openPositions: null, positionsStatus: 'disconnected' });", {
    useState: () => [-10, nothing], useLiveMarketQuote: () => ({ isFresh: true, quote: { price: 2000 }, status: 'ready' }),
    useUsdPrices: () => ({ status: 'ready', prices: {}, updatedAt: null }), useBorrowFundingRate: () => ({ rate: null, status: 'unavailable' }),
    usePoolCapacity: () => ({ value, status: 'ready' }), poolCapacityUnits: () => ({ collateralDecimals: 18, debtDecimals: 18, collateralSymbol: 'fxUSD', debtSymbol: 'stETH' }),
    useOracleObservation: () => ({ value: null, status: 'unavailable' }), useOracleMarketDifference: () => null,
    borrowFundingDisplay: nothing, tradeSensitivity, tradeScenarioPrice, tradeMarketReference, formatUsdPrice, USD_PRICE_MAX_AGE_MS,
    styles: {}, MissingValue: nothing, MetricLabel: nothing, Link: nothing, ShieldCheck: nothing, ChevronRight: nothing, ChartNoAxesCombined: nothing, ArrowRight: nothing, TrendingDown: nothing,
  }) as React.ReactElement;
  const elements = (node: any): any[] => Array.isArray(node) ? node.flatMap(elements) : node?.props ? [node, ...elements(node.props.children)] : [];
  const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  const nodes = elements(tree);
  assert.ok(nodes.some(node => node.type === 'dd' && node.props.title === '494685.3288 fxUSD'));
  assert.ok(nodes.some(node => node.type === 'small' && node.props.title === '140289268.9555 stETH'));
  assert.match(text(tree), /≈ 494\.68K fxUSD/);
  assert.match(text(tree), /Debt room: ≈ 140\.28M stETH/);
  assert.match(text(tree), /Short · 2× initial leverage/);
  assert.match(text(tree), /\$1,800\.00/);
  assert.match(text(tree), /\+20\.0%/);
  assert.doesNotMatch(text(tree), /Explore how your selected|SensitivityExplore/);
  assert.deepEqual(value, before, 'display formatting never changes raw capacities');
});
