import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { HEADING_LIT_KEY, SHELL_INITIALIZER } from '../src/app/shellInitializer';

type Listener = (event: Record<string, unknown>) => void;

/** The smallest document the pre-hydration script touches. */
function boot({ local = {}, session = {}, blockedStorage = false }: {
  local?: Record<string, string>; session?: Record<string, string>; blockedStorage?: boolean;
} = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const listen = (type: string, listener: Listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); };
  const storage = (values: Record<string, string>) => ({
    getItem: (key: string) => { if (blockedStorage) throw new Error('blocked'); return values[key] ?? null; },
    setItem: (key: string, value: string) => { if (blockedStorage) throw new Error('blocked'); values[key] = value; },
  });
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const document = {
    documentElement: root,
    addEventListener: listen,
    removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
  };
  runInNewContext(SHELL_INITIALIZER, { document, localStorage: storage(local), sessionStorage: storage(session) });
  const dispatch = (type: string, event: Record<string, unknown> = {}) => { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); };
  return { root, local, session, listeners, dispatch, document };
}

test('dark applies before the first paint and replaces saved light preferences', () => {
  for (const saved of ['dark', 'light', 'official', 'unknown']) {
    const page = boot({ local: { fxaeon_theme_id_v2: saved } });
    assert.deepEqual(page.root, { dataset: { theme: 'dark' }, style: { colorScheme: 'dark' } });
    assert.equal(page.local.fxaeon_theme_id_v2, 'dark');
  }
  assert.equal(boot({ local: { fxaeon_theme_id: 'light' } }).root.dataset.theme, 'dark');
  assert.equal(boot().root.dataset.theme, 'dark');
  assert.equal(boot().root.style.colorScheme, 'dark');
});

test('route headings light once per session, and a later load starts plain', () => {
  const first = boot();
  assert.equal(first.root.dataset.headingLit, undefined);
  first.dispatch('animationend', { animationName: 'route-in' });
  assert.equal(first.root.dataset.headingLit, undefined, 'other animations do not count as the sweep');
  first.dispatch('animationend', { animationName: 'heading-light' });
  assert.equal(first.root.dataset.headingLit, '');
  assert.equal(first.session[HEADING_LIT_KEY], '1');
  assert.equal(first.listeners.get('animationend')?.size, 0, 'the listener retires after the first sweep');

  const reload = boot({ session: { ...first.session } });
  assert.equal(reload.root.dataset.headingLit, '', 'a reload in the same session shows plain titles from the first frame');
});

test('startup registers no inactive canvas visibility or connection listeners', () => {
  const page = boot();
  assert.deepEqual([...page.listeners.keys()], ['animationend']);
  assert.equal(page.root.dataset.saveData, undefined);
  assert.equal(page.root.dataset.pageHidden, undefined);
});

test('blocked storage still lights the heading once for this page and keeps the default theme', () => {
  const page = boot({ blockedStorage: true });
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.root.style.colorScheme, 'dark');
  page.dispatch('animationend', { animationName: 'heading-light' });
  assert.equal(page.root.dataset.headingLit, '');
});
