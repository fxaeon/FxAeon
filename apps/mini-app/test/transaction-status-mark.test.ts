import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import type { TransactionStepResult } from '../src/lib/fx';

const require = createRequire(import.meta.url);
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (loaded, filename) => {
  loaded.exports = Object.fromEntries([...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]));
};
const { TransactionStatusMark, statusMarkState } = require('../src/components/review/TransactionStatusMark') as typeof import('../src/components/review/TransactionStatusMark');
after(() => {
  if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css'];
  if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React');
});

const HASH = `0x${'a'.repeat(64)}` as const;
const action = { kind: 'action', to: '0x2', data: '0x', value: 0n } as unknown as TransactionStepResult['transaction'];
const step = (fields: Partial<TransactionStepResult>): TransactionStepResult => ({ index: 0, transaction: action, status: 'submitted', ...fields });

test('the status mark shows only the waiting the runner reports', () => {
  assert.equal(statusMarkState('awaiting-user', [], false), 'wallet');
  assert.equal(statusMarkState('awaiting-user', [], true), 'network', 'a network switch is not a wallet prompt');
  assert.equal(statusMarkState('submitted', [step({ hash: HASH })], false), 'pending');
  assert.equal(statusMarkState('confirming', [step({ hash: HASH, status: 'confirming' })], false), 'pending');
  assert.equal(statusMarkState('planning', [], false), 'preparing');
  assert.equal(statusMarkState('submitted', [step({ hash: HASH, status: 'failed' })], false), 'uncertain', 'an unknown confirmation never reads as progress');
});

test('the mark is a single decorative glyph that names its state for styling only', () => {
  for (const state of ['wallet', 'network', 'pending', 'uncertain', 'preparing'] as const) {
    const html = render(React.createElement(TransactionStatusMark, { state }));
    assert.match(html, new RegExp(`^<span class="mark" data-status-mark="${state}" aria-hidden="true"><svg`));
    assert.equal((html.match(/<svg/g) ?? []).length, 1);
  }
});
