import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { HEADING_LIT_KEY, SHELL_INITIALIZER } from '../src/app/shellInitializer';

type Listener = (event: Record<string, unknown>) => void;

/** The smallest document the pre-hydration script touches. */
function boot({ local = {}, session = {}, blockedStorage = false, connection, hidden = false }: {
  local?: Record<string, string>; session?: Record<string, string>; blockedStorage?: boolean; connection?: { saveData?: boolean }; hidden?: boolean;
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
    visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener: listen,
    removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
  };
  const network = connection && { ...connection, addEventListener: (type: string, listener: Listener) => listen(`connection:${type}`, listener) };
  runInNewContext(SHELL_INITIALIZER, { document, localStorage: storage(local), sessionStorage: storage(session), navigator: { connection: network } });
  const dispatch = (type: string, event: Record<string, unknown> = {}) => { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); };
  return { root, session, listeners, dispatch, document, network };
}

test('the saved theme is applied before the first paint, with the legacy light choice kept', () => {
  assert.deepEqual(boot({ local: { fxaeon_theme_id_v2: 'dark' } }).root, { dataset: { theme: 'dark' }, style: { colorScheme: 'dark' } });
  assert.equal(boot({ local: { fxaeon_theme_id_v2: 'light' } }).root.style.colorScheme, 'light');
  assert.equal(boot({ local: { fxaeon_theme_id: 'light' } }).root.dataset.theme, 'official');
  assert.equal(boot({ local: { fxaeon_theme_id: 'dark' } }).root.dataset.theme, 'official');
  assert.equal(boot().root.dataset.theme, 'official');
  assert.equal(boot().root.style.colorScheme, 'light');
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

test('the canvas rests with data saver on, and holds while the page is hidden', () => {
  assert.equal(boot().root.dataset.saveData, undefined);
  const saver = boot({ connection: { saveData: true } });
  assert.equal(saver.root.dataset.saveData, '', 'data saver is honoured before the first paint');
  saver.network!.saveData = false;
  saver.dispatch('connection:change');
  assert.equal(saver.root.dataset.saveData, undefined, 'turning data saver off lets the canvas move again');

  const page = boot({ hidden: true });
  assert.equal(page.root.dataset.pageHidden, '');
  page.document.visibilityState = 'visible';
  page.dispatch('visibilitychange');
  assert.equal(page.root.dataset.pageHidden, undefined);
  page.document.visibilityState = 'hidden';
  page.dispatch('visibilitychange');
  assert.equal(page.root.dataset.pageHidden, '');
});

test('blocked storage still lights the heading once for this page and keeps the default theme', () => {
  const page = boot({ blockedStorage: true });
  assert.equal(page.root.dataset.theme, undefined);
  page.dispatch('animationend', { animationName: 'heading-light' });
  assert.equal(page.root.dataset.headingLit, '');
});
