import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_THEME, applyTheme } from '../src/lib/theme';

function withBrowser(saved: Record<string, string>, run: (state: { attributes: Record<string, string>; style: { colorScheme: string }; removed: string[]; storage: Record<string, string>; meta: Record<string, string> }) => void, blocked = false) {
  const original = Object.fromEntries(['window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const attributes: Record<string, string> = {};
  const meta: Record<string, string> = {};
  const removed: string[] = [];
  const style = { colorScheme: '', removeProperty: (key: string) => removed.push(key) };
  const localStorage = {
    getItem: (key: string) => { if (blocked) throw new Error('blocked'); return saved[key] ?? null; },
    setItem: (key: string, value: string) => { if (blocked) throw new Error('blocked'); saved[key] = value; },
  };
  try {
    Object.defineProperties(globalThis, {
      window: { value: {}, configurable: true },
      document: { value: { documentElement: { style, setAttribute: (key: string, value: string) => { attributes[key] = value; } }, querySelector: () => ({ setAttribute: (key: string, value: string) => { meta[key] = value; } }) }, configurable: true },
      localStorage: { value: localStorage, configurable: true },
    });
    run({ attributes, style, removed, storage: saved, meta });
  } finally {
    for (const key of Object.keys(original)) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('light and official preferences migrate to dark while transaction preferences survive', () => {
  for (const previous of ['official', 'light']) {
    withBrowser({ fxaeon_theme_id_v2: previous, 'fxaeon.settings.v1': JSON.stringify({ theme: previous, slippageBps: 75, gasTier: 'fast' }) }, state => {
      applyTheme();
      assert.equal(state.attributes['data-theme'], 'dark');
      assert.equal(state.style.colorScheme, 'dark');
      assert.equal(state.meta.content, APP_THEME.background);
      assert.equal(state.storage.fxaeon_theme_id_v2, 'dark');
      assert.deepEqual(JSON.parse(state.storage['fxaeon.settings.v1']), { theme: 'dark', slippageBps: 75, gasTier: 'fast' });
      assert.ok(state.removed.includes('--bg'));
      assert.ok(state.removed.includes('--text'));
    });
  }
});

test('blocked or malformed preferences cannot prevent dark appearance', () => {
  for (const blocked of [false, true]) {
    withBrowser({ 'fxaeon.settings.v1': '{invalid' }, state => {
      assert.doesNotThrow(applyTheme);
      assert.equal(state.attributes['data-theme'], 'dark');
      assert.equal(state.style.colorScheme, 'dark');
    }, blocked);
  }
});
