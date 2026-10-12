import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { THEMES, type ThemeId } from '../src/lib/theme';
import { FXAEON_MARK_PATH, privyAppearance } from '../src/lib/wallet/privyAppearance';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themes: readonly ThemeId[] = ['official', 'dark', 'light'];

/** WCAG relative luminance; Privy's tinycolor getLuminance() uses the same formula. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('each theme hands Privy its own background and accent', () => {
  for (const id of themes) {
    const appearance = privyAppearance(id);
    assert.equal(appearance.theme, THEMES[id].colors['--bg'], id);
    assert.equal(appearance.accentColor, THEMES[id].accent, id);
  }
  assert.deepEqual(themes.map((id) => privyAppearance(id).theme), ['#121115', '#08090b', '#f7f5f1']);
  assert.deepEqual(themes.map((id) => privyAppearance(id).accentColor), ['#b9a0ff', '#b9a0ff', '#7341c8']);
});

test("each background selects Privy's matching palette", () => {
  // Privy 3.45 uses its dark tokens when the theme hex is at or below 50%
  // luminance, and asks for under 20% or over 80% for accessible contrast.
  for (const id of ['official', 'dark'] as const) {
    assert.ok(luminance(String(privyAppearance(id).theme)) < 0.2, id);
  }
  assert.ok(luminance(String(privyAppearance('light').theme)) > 0.8);
});

test("the modal shows FxAeon's own mark from this origin at a set size", () => {
  for (const id of themes) {
    const logo = privyAppearance(id).logo as ReactElement<{ src: string; width: number; height: number }>;
    assert.equal(logo.type, 'img', 'Privy accepts only a URL or an img/svg element');
    assert.equal(logo.props.src, FXAEON_MARK_PATH);
    assert.equal(logo.props.width, 48);
    assert.equal(logo.props.height, 48);
  }
  assert.match(FXAEON_MARK_PATH, /^\/[^/]/, 'a same-origin path, never a third-party or protocol-relative URL');
  assert.ok(existsSync(resolve(appRoot, 'public', FXAEON_MARK_PATH.slice(1))), 'the mark is served from public/');
});

test("sign-in copy fits Privy's limits", () => {
  const { landingHeader, loginMessage } = privyAppearance('official');
  assert.equal(landingHeader, 'Sign in to FxAeon');
  assert.equal(loginMessage, 'Trade, earn, and borrow on f(x) Protocol.');
  assert.ok((landingHeader ?? '').length <= 35, 'Privy ellipsizes longer landing headers');
  assert.ok((loginMessage ?? '').length <= 100, 'Privy truncates login messages at 100 characters');
});

test('the wallet list leads with detected wallets and survives the installed SDK filter', () => {
  const { walletList } = privyAppearance('official');
  assert.deepEqual(walletList, ['detected_ethereum_wallets', 'metamask', 'coinbase_wallet', 'rainbow', 'wallet_connect']);
  // Privy silently drops ids missing from its runtime allow-list, which is
  // what happens to the deprecated 'detected_wallets'.
  const esm = resolve(appRoot, 'node_modules/@privy-io/react-auth/dist/esm');
  const bundle = readdirSync(esm).find((name) => /^privy-context-[\w-]+\.mjs$/.test(name));
  assert.ok(bundle, 'the installed Privy context bundle');
  const source = readFileSync(resolve(esm, bundle), 'utf8');
  const allowList = [...source.matchAll(/new Set\(\[([^\]]*)\]\)/g)]
    .map((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((id) => id[1]))
    .find((ids) => ids.includes('detected_ethereum_wallets'));
  assert.ok(allowList, 'the installed Privy wallet allow-list');
  for (const id of walletList ?? []) assert.ok(allowList.includes(id), `${id} is accepted by the installed SDK`);
  assert.equal(allowList.includes('detected_wallets'), false);
});

test('every call returns its own wallet list', () => {
  assert.notEqual(privyAppearance('official').walletList, privyAppearance('official').walletList);
});
