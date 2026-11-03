import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const globals = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globals.React;
globals.React = React;
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (module, path) => {
  module.exports = Object.fromEntries([...readFileSync(path, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
};
type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null | 'auto' };
const links: Array<{ href: string; prefetch: LinkProps['prefetch'] }> = [];
const linkPath = require.resolve('next/link');
const previousLink = require.cache[linkPath];
// Observe the actual props handed to Next Link, not an invented DOM
// prefetch attribute. This does not simulate Next's network scheduler.
require.cache[linkPath] = { id: linkPath, filename: linkPath, loaded: true, exports: ({ prefetch, ...props }: LinkProps) => {
  links.push({ href: props.href, prefetch });
  return React.createElement('a', props);
} } as NodeJS.Module;
const { DesktopSidebar } = require('../src/components/DesktopSidebar') as typeof import('../src/components/DesktopSidebar');

after(() => {
  if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css'];
  if (previousLink) require.cache[linkPath] = previousLink; else delete require.cache[linkPath];
  if (previousReact) globals.React = previousReact; else Reflect.deleteProperty(globals, 'React');
});

function render(loading?: boolean) {
  links.length = 0;
  const html = renderToStaticMarkup(React.createElement(DesktopSidebar, { pathname: '/trade', loading }));
  assert.deepEqual(links.map(link => link.href), ['/', '/', '/trade', '/earn', '/borrow', '/move', '/more']);
  assert.match(html, /href="\/trade"[^>]+aria-current="page"/);
  const aside = html.match(/^<aside\b[^>]*>/);
  assert.ok(aside);
  return aside[0];
}

test('loading sidebar disables Next prefetch for the brand and every destination', () => {
  const html = render(true);
  assert.ok(links.every(link => link.prefetch === false));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /inert=""/);
});

test('resolved sidebar restores Next default prefetch rather than forcing eager prefetch', () => {
  render(true);
  const html = render(false);
  assert.ok(links.every(link => link.prefetch === undefined));
  assert.doesNotMatch(html, /aria-hidden="true"|inert=""/);
});

test('ordinary sidebar callers keep default prefetch without supplying loading', () => {
  render();
  assert.ok(links.every(link => link.prefetch === undefined));
});
