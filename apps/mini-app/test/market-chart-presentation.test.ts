import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { formatUsdPrice } from '../src/lib/prices';
import { scrubChangePercent } from '../src/lib/chartTime';

const file = ts.createSourceFile('MarketChart.tsx', readFileSync(new URL('../src/components/MarketChart.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
function component(name: string, bindings: object) {
  const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const code = ts.transpileModule(declaration.getText(file).replace(/^export /, '') + `\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  return runInNewContext(code, { React, formatUsdPrice, ...bindings }) as (props: object) => React.ReactElement<any>;
}
const candles = [{ time: 100, open: 1000, close: 1100 }, { time: 200, open: 1100, close: 1200 }, { time: 300, open: 1200, close: 1300 }];
const snapshot = { market: 'ETH', range: '7D', currentPrice: 1300, high: 1400, low: 900, percentChange: 30, candles };
const nothing = () => null;
function header(range: string, fresh: boolean, history = snapshot) {
  let nullState = 0;
  const Chart = component('TradeMarketChart', {
    useState: (initial: unknown) => [initial === '1D' ? range : initial === null ? nullState++ === 0 ? false : null : initial, nothing],
    useId: () => 'chart', useEffect: nothing, useChartStyle: () => ['line', nothing], useLiveCandles: () => ({ status: 'ready', snapshot: history }),
    useUsdPrices: () => ({ prices: {}, status: 'ready' }), useLiveMarketQuote: () => ({ isFresh: fresh, status: 'ready', quote: { price: 1500, percentChange24h: 5, high24h: 1600, low24h: 1450 } }),
    styles: {}, TokenIcon: nothing, RollingFigure: ({ value }: { value: unknown }) => value,
    ValueOrSkeleton: ({ value }: { value: unknown }) => value, LazyPriceChart: nothing, ChartSkeleton: nothing,
    BarChart3: nothing, ChevronDown: nothing, RANGE_OPTIONS: [], CHART_STYLES: [], liveQuotePending: () => false,
  });
  return renderToStaticMarkup(Chart({ market: 'ETH' }));
}
test('selected-range history labels never masquerade as 24-hour statistics', () => {
  const html = header('7D', false);
  assert.match(html, /30\.00% 7D/);
  assert.match(html, /7D high/);
  assert.match(html, /7D low/);
  assert.doesNotMatch(html, /24h/);
  assert.match(header('1D', false, { ...snapshot, range: '1D' }), /24h high/);
});
test('fresh ticker remains explicitly 24-hour even with a longer chart range', () => {
  const html = header('7D', true);
  assert.match(html, /5\.00% 24h/);
  assert.match(html, /24h high/);
  assert.match(html, /1,600\.00/);
  assert.doesNotMatch(html, /7D high/);
});
test('previous range or market data cannot appear under the newly selected range labels', () => {
  assert.doesNotMatch(header('30D', false), /30\.00%|1,400\.00|900\.00/);
  assert.doesNotMatch(header('7D', false, { ...snapshot, market: 'BTC' }), /30\.00%|1,400\.00|900\.00/);
});
test('keyboard inspection moves the real crosshair, announces exact bars and returns to live on blur', () => {
  let selected: number | null = null;
  let refs = 0;
  const positions: unknown[][] = [];
  const readings: unknown[] = [];
  let clears = 0;
  const state = { shift: 3600, entry: { series: {} }, chart: { setCrosshairPosition: (...args: unknown[]) => positions.push(args), clearCrosshairPosition: () => { clears++; } } };
  const Chart = component('LazyPriceChart', {
    useState: (initial: unknown) => initial === null ? [selected, (value: number | null) => { selected = value; }] : [false, nothing],
    useRef: (initial: unknown) => ({ current: ++refs === 6 ? state : initial }), useEffect: nothing,
    scrubChangePercent, formatScrubTime: (time: number) => `time ${time}`,
  });
  const render = () => { refs = 0; return Chart({ snapshot, chartStyle: 'line', onScrub: (value: unknown) => readings.push(value) }); };
  let node = render();
  assert.equal(node.props.role, 'slider'); assert.equal(node.props.tabIndex, 0);
  const key = (value: string) => { let prevented = false; node.props.onKeyDown({ key: value, preventDefault: () => { prevented = true; } }); node = render(); return prevented; };
  assert.equal(key('Home'), true);
  assert.equal(node.props['aria-valuenow'], 0);
  assert.match(node.props['aria-valuetext'], /time 100.*1,100\.00/);
  assert.equal(positions.at(-1)![1], 3700, 'crosshair uses the existing display time shift');
  key('ArrowRight'); assert.equal(node.props['aria-valuenow'], 1);
  key('End'); assert.equal(node.props['aria-valuenow'], 2);
  key('ArrowRight'); assert.equal(node.props['aria-valuenow'], 2);
  assert.equal(key('Tab'), false, 'normal focus navigation is not trapped');
  node.props.onBlur();
  assert.equal(clears, 1); assert.equal(readings.at(-1), null);
});
