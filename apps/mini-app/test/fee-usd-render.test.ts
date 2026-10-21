import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const require = createRequire(import.meta.url);
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (loaded, file) => {
  const names = [...readFileSync(file, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  loaded.exports = Object.fromEntries(names.map(name => [name, name]));
};
after(() => {
  if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css'];
  if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React');
});
test('standalone fee conversion explicitly shows unavailable without a fresh provider', async () => {
  const { AmountUsd, FeeUsd } = await import('../src/components/review/AmountUsd');
  for (const component of [React.createElement(AmountUsd, { amount: '0.00024', symbol: 'ETH', receipt: true }), React.createElement(FeeUsd, { fact: { value: 'Unavailable' } }), React.createElement(AmountUsd, { amount: '0', symbol: 'ETH' })]) {
    const html = renderToStaticMarkup(component);
    assert.match(html, /USD value unavailable/);
    assert.match(html, /data-usd-state="unavailable"/);
    assert.doesNotMatch(html, /\$0\.00/);
  }
});
