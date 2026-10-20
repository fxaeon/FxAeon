import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { positionCollateralDecimals, positionDebtDecimals, type UiPosition } from '../src/app/trade/fxUi';
import { positionCollateralSymbol } from '../src/lib/positionUnits';
import { positionTokenPresentation } from '../src/lib/positionPresentation';
import { pairVerifiedPositionFacts } from '../src/components/review/actionReviewModel';

const filename = new URL('../src/app/borrow/page.tsx', import.meta.url);
const source = ts.createSourceFile('borrow-page.tsx', readFileSync(filename, 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
// Execute the actual small render expressions without mounting wallet/router hooks.
// This is not a whole-page or interaction test.
function evaluate<T>(snippet: string, bindings: object): T {
  const js = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(js, { React, positionTokenPresentation, positionCollateralDecimals, positionDebtDecimals, positionCollateralSymbol, ...bindings }) as T;
}
function position(): UiPosition {
  return { market: 'ETH', side: 'long', info: { positionId: 42, rawColls: 10n ** 12n, rawDebts: 10n ** 15n, rawCollsDecimals: 18, rawDebtsDecimals: 18, rawCollsToken: 'ETH', rawDebtsToken: 'fxUSD', currentLeverage: 0, lsdLeverage: 0 } };
}

test('Borrow review-before and repay hint execute exact source formatters without changing position state', () => {
  const declarations = ['formatPositionCollateral', 'formatPositionDebt'].map(name => {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `${name} exists`);
    return declaration.getText(source);
  });
  const p = position();
  const before = structuredClone(p);
  const [collateral, debt] = evaluate<string[]>(`${declarations.join('\n')}\n[formatPositionCollateral(position), formatPositionDebt(position)];`, { position: p });
  assert.equal(collateral, '0.000001 stETH');
  assert.equal(debt, '0.001 fxUSD');
  assert.deepEqual(p, before);
  const paired = pairVerifiedPositionFacts([{ label: 'Collateral', value: collateral }, { label: 'Debt', value: debt }], [{ label: 'Estimated collateral', value: '0.000001 stETH' }, { label: 'Estimated debt', value: '0.0005 fxUSD' }]);
  assert.equal(paired.paired[0].before, '0.000001 stETH');
  assert.equal(paired.paired[1].before, '0.001 fxUSD');
  const tiny = { ...p, market: 'BTC' as const, info: { ...p.info, rawColls: 1n, rawDebts: 1n, rawCollsToken: 'WBTC' } };
  const exact = evaluate<string[]>(`${declarations.join('\n')}\n[formatPositionCollateral(position), formatPositionDebt(position)];`, { position: tiny });
  assert.equal(exact[0], '0.000000000000000001 WBTC');
  assert.equal(exact[1], '0.000000000000000001 fxUSD');
});

test('Borrow before→after source rows show exact tiny debt without changing repayment arithmetic', () => {
  const rows: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.getText(source).startsWith('<div><dt>Total debt</dt>')) rows.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(rows.length, 2);
  const inputs = { existingDebt: 10n ** 15n, debtAfter: 10n ** 15n + 1n, repayPreviewWei: 1n };
  const before = structuredClone(inputs);
  const markup = rows.map(row => renderToStaticMarkup(evaluate<React.ReactNode>(`(${row});`, inputs)));
  assert.match(markup[0], /<span>0\.001<\/span>/);
  assert.match(markup[0], /<strong>0\.001000000000000001 fxUSD<\/strong>/);
  assert.match(markup[1], /<span>0\.001<\/span>/);
  assert.match(markup[1], /<strong>0\.000999999999999999 fxUSD<\/strong>/);
  assert.deepEqual(inputs, before);
});
