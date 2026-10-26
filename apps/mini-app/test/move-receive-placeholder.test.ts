import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { MissingValue } from '../src/components/MissingValue';

const source = ts.createSourceFile('move.tsx', readFileSync(new URL('../src/app/move/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ReceiveAmountPlaceholder')!;
const render = runInNewContext(ts.transpileModule(node.getText(source) + '\nReceiveAmountPlaceholder;', { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText, { React, MissingValue, moveStyles: { receiveAmount: 'receiveAmount' } }) as (props: { amount: string; loading: boolean }) => React.ReactElement;

test('Move Receive uses 0.00 only when the send amount is empty or zero', () => {
  for (const amount of ['', '0', '0.00', '.0']) {
    const html = renderToStaticMarkup(render({ amount, loading: false }));
    assert.match(html, />0\.00<\/strong>/);
    assert.doesNotMatch(html, /—|unavailable|missing-value/);
  }
});

test('a pending or unavailable receive quote never masquerades as zero', () => {
  for (const loading of [true, false]) {
    const html = renderToStaticMarkup(render({ amount: '12.5', loading }));
    assert.match(html, /role="status"/);
    assert.match(html, loading ? /aria-label="Loading receive amount"/ : /aria-label="Receive amount unavailable"/);
    assert.doesNotMatch(html, /0\.00|—/);
    assert.equal(html.includes('missing-value-unavailable'), !loading);
  }
  const invalid = renderToStaticMarkup(render({ amount: 'invalid', loading: false }));
  assert.doesNotMatch(invalid, /0\.00|—/);
  assert.match(invalid, /Receive amount unavailable/);
});
