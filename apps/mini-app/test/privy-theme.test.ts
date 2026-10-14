import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const privyCss = withoutComments(readFileSync(resolve(src, 'components/privy-theme.css'), 'utf8'));
const globalsCss = withoutComments(readFileSync(resolve(src, 'app/globals.css'), 'utf8'));

/** Custom properties declared in the first rule with exactly this selector. */
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const rootTokens = declarations(globalsCss, ':root');
const lightTokens = new Map([...rootTokens, ...declarations(globalsCss, ":root:is([data-theme='official'], [data-theme='light'])")]);
const themes = {
  official: lightTokens,
  dark: new Map([...rootTokens, ...declarations(globalsCss, ":root[data-theme='dark']")]),
  light: lightTokens,
};
const privy = declarations(privyCss, 'html:root');

/** Resolve a Privy variable declared as a single var(--token) for one theme. */
function tokenValue(theme: Map<string, string>, privyName: string): string {
  const declared = privy.get(privyName);
  const token = /^var\((--[\w-]+)\)$/.exec(declared ?? '')?.[1];
  assert.ok(token, `${privyName} names a single Aeon token (found ${declared})`);
  const value = theme.get(token);
  assert.ok(value, `${token} is defined`);
  return value;
}

function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test("the mapping outranks Privy's runtime :root palette", () => {
  // Privy injects `:root { --privy-… }`; html:root wins regardless of order.
  assert.match(privyCss, /^html:root \{/m);
  assert.ok(privy.size > 40, 'the palette, radii, and shadows Privy reads are mapped');
});

test('values the export iframe reads resolve to plain colors in every theme', () => {
  // EmbeddedWalletKeyExportScreen reads these from document.documentElement
  // and passes them to Privy's iframe as URL parameters.
  for (const name of [
    '--privy-color-background',
    '--privy-color-background-2',
    '--privy-color-foreground-3',
    '--privy-color-foreground-accent',
    '--privy-color-accent',
    '--privy-color-accent-dark',
    '--privy-color-success',
  ]) {
    for (const [theme, tokens] of Object.entries(themes)) {
      assert.match(tokenValue(tokens, name), /^#[0-9a-f]{6}$/i, `${name} in ${theme}`);
    }
  }
});

test('text on the accent keeps WCAG AA in every theme, at rest and pressed', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    const onAccent = tokenValue(tokens, '--privy-color-foreground-accent');
    for (const fill of ['--privy-color-accent', '--privy-color-accent-dark']) {
      const ratio = contrast(onAccent, tokenValue(tokens, fill));
      assert.ok(ratio >= 4.5, `${theme} ${fill}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test('text, links, and status messages stay readable on the modal surface', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    const surface = tokenValue(tokens, '--privy-color-background');
    for (const text of [
      '--privy-color-foreground',
      '--privy-color-foreground-2',
      '--privy-color-foreground-3',
      '--privy-link-navigation-color',
      '--privy-color-error',
      '--privy-color-success-dark',
    ]) {
      const ratio = contrast(tokenValue(tokens, text), surface);
      assert.ok(ratio >= 4.5, `${theme} ${text}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test('every Aeon token the stylesheet names exists', () => {
  const named = new Set([...privyCss.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name));
  for (const name of named) {
    // --font-sans comes from next/font on <html>; --privy-* are Privy's own.
    if (name === '--font-sans' || name.startsWith('--privy-')) continue;
    assert.ok(rootTokens.has(name), `${name} is defined in globals.css`);
  }
});

test('geometry follows the app: sheet-sized modal corners, 14px buttons, 12px inputs', () => {
  assert.equal(tokenValue(rootTokens, '--privy-border-radius-lg'), '24px');
  assert.equal(privy.get('--privy-border-radius-sm'), '14px');
  assert.equal(tokenValue(rootTokens, '--privy-border-radius-md'), '12px');
});

test("the dialog uses the app's typeface and scrim, and the provider loads the stylesheet", () => {
  assert.match(privyCss, /#privy-modal-content :is\(h1, h2, h3, h4, h5, h6\)\s*\{\s*font-family: var\(--font-sans\)/);
  assert.match(privyCss, /#privy-dialog-backdrop \{[^}]*background-color: var\(--scrim\)/);
  const provider = readFileSync(resolve(src, 'components/PrivyClientProvider.tsx'), 'utf8');
  assert.match(provider, /^import '\.\/privy-theme\.css';$/m);
});
