import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

const require = createRequire(import.meta.url);
const globals = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globals.React;
globals.React = React;
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (module, path) => {
  const names = [...readFileSync(path, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  module.exports = Object.fromEntries(names.map(name => [name, `test-${name}`]));
};
// Display-only wallet context. No wallet request or network call is made.
const walletPath = require.resolve('../src/lib/wallet');
const previousWallet = require.cache[walletPath];
require.cache[walletPath] = { id: walletPath, filename: walletPath, loaded: true,
  exports: { usePrivyWallet: () => ({ address: undefined, isEmbedded: false }) },
} as NodeJS.Module;
const { default: MobileMoreMenu } = require('../src/components/MobileMoreMenu') as typeof import('../src/components/MobileMoreMenu');
after(() => {
  if (previousCss) require.extensions['.css'] = previousCss;
  else delete require.extensions['.css'];
  if (previousWallet) require.cache[walletPath] = previousWallet;
  else delete require.cache[walletPath];
  if (previousReact) globals.React = previousReact;
  else Reflect.deleteProperty(globals, 'React');
});

const unexpected = () => { throw new Error('Directory rendering must not navigate or request accounts'); };
const router: AppRouterInstance = { bfcacheId: 'more-directory-test', back: unexpected, forward: unexpected, refresh: unexpected, push: unexpected, replace: unexpected, prefetch: unexpected };
const render = () => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(MobileMoreMenu)));
test('the directory renders all six real options without redundant section headings or subtitles', () => {
  const html = render();
  assert.deepEqual([...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]),
    ['Wallet &amp; account', 'History', 'Transaction settings', 'FxAeon docs', 'Protocol docs', 'Support on X']);
  assert.doesNotMatch(html, /<h2|<small|Account &amp; preferences|Help &amp; resources/);
  assert.match(html, /0\.5%/);
  assert.match(html, /aria-label="Account"/);
  assert.match(html, /aria-label="Resources"/);
  assert.doesNotMatch(html, /Search|Manage Accounts|Security &amp; Privacy|Connected Apps/);
});
test('directory destinations, external-link disclosure and settings button semantics are retained', () => {
  const html = render();
  for (const href of ['/settings', '/history', '/docs', 'https://fxprotocol.gitbook.io/fx-docs', 'https://x.com/FxAeonxyz']) {
    assert.ok(html.includes(`href="${href}"`), `Missing destination ${href}`);
  }
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
  assert.equal((html.match(/opens in a new tab/g) ?? []).length, 2);
  assert.match(html, /<button[^>]*type="button"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
});
test('desktop and mobile directories keep the same real options and destination order', () => {
  const mobile = readFileSync(new URL('../src/components/MobileMoreMenu.tsx', import.meta.url), 'utf8');
  const desktop = readFileSync(new URL('../src/app/more/page.tsx', import.meta.url), 'utf8');
  const rows = (source: string) => [...source.matchAll(/<(?:ActionRow|TransactionSettings) [^>]+\/>/g)].map(match => match[0]);
  assert.deepEqual(rows(desktop), rows(mobile));
  assert.doesNotMatch(desktop, /<h2|description=/);
});
test('route-owned style keeps touch targets, neutral icons and visible keyboard focus', () => {
  const css = readFileSync(new URL('../src/app/more/More.module.css', import.meta.url), 'utf8');
  assert.match(css, /min-height: 64px/);
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--focus-ring\)/);
  assert.match(css, /svg:first-child[^}]+color: var\(--mut\)/);
  assert.match(css, /max-width: 360px/);
  const hiddenHeading = css.match(/\.workspace > h1\[data-page-heading\] \{([^}]+)\}/);
  assert.ok(hiddenHeading, 'the mobile page title retains a screen-reader-only rule');
  assert.match(hiddenHeading[1], /width: 1px; height: 1px/);
  assert.match(hiddenHeading[1], /clip: rect\(0, 0, 0, 0\)/);
  // Screen-reader-only headings need nowrap; visible directory rows must wrap.
  assert.doesNotMatch(css.replace(hiddenHeading[0], ''), /overflow: ellipsis|text-overflow|white-space: nowrap/);
});
