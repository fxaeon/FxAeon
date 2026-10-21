import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { INFO_HELP_CONTENT } from '../src/components/infoHelpContent';

const require = createRequire(import.meta.url);
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (module, path) => {
  module.exports = Object.fromEntries([...readFileSync(path, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
};
const { InfoHelp, MetricLabel, getInfoHelpPosition } = require('../src/components/InfoHelp') as typeof import('../src/components/InfoHelp');
after(() => { if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css']; });
const source = readFileSync(new URL('../src/components/InfoHelp.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/InfoHelp.module.css', import.meta.url), 'utf8');

test('server markup exposes a named button, not a title-only explanation or submit control', () => {
  const html = renderToStaticMarkup(React.createElement(InfoHelp, { label: 'Minimum received', definition: 'minimumReceived' }));
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="About Minimum received"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /title=|role="dialog"/);
});

test('label remains visible, undefined definitions do not create empty help, custom help is supported', () => {
  assert.equal(renderToStaticMarkup(React.createElement(InfoHelp, { label: 'Exact data' })), '');
  const html = renderToStaticMarkup(React.createElement(MetricLabel, { label: 'Minimum received', help: 'A quoted lower limit.' }));
  assert.match(html, /<span>Minimum received<\/span>/);
  assert.match(html, /About Minimum received/);
  assert.doesNotMatch(html, /A quoted lower limit/);
});

test('all explicit definitions are explanatory and contain no transaction-specific addresses or amounts', () => {
  for (const [key, value] of Object.entries(INFO_HELP_CONTENT)) {
    assert.ok(value.length > 30, key);
    assert.doesNotMatch(value, /0x[a-f0-9]{40}|\$[\d,]+|\d+\.\d+ ETH/i, key);
  }
  assert.match(INFO_HELP_CONTENT.borrowRate, /do not establish the current funding charge/);
  assert.match(INFO_HELP_CONTENT.minimumReceived, /limit, not the expected amount/);
  assert.doesNotMatch(source, /fact\.title|beginLocalHistoryEntry|history\.(pushState|back)|useOverlayDialog\(/);
});

test('help fits a 320px viewport with 200% text, tall content, and anchors at every edge', () => {
  for (const height of [84, 240, 1400]) {
    for (const anchor of [
      { left: 0, right: 30, top: 0, bottom: 30 },
      { left: 290, right: 320, top: 610, bottom: 640 },
      { left: 110, right: 140, top: 300, bottom: 330 },
    ]) {
      const p = getInfoHelpPosition(anchor, height, { left: 0, top: 0, width: 320, height: 640 });
      assert.ok(p.left >= 12 && p.left + p.width <= 308);
      assert.ok(p.top >= 12 && p.top + Math.min(height, p.maxHeight) <= 628);
      assert.ok(p.top >= anchor.bottom + 6 || p.top + Math.min(height, p.maxHeight) <= anchor.top - 6,
        'the panel leaves its icon available for a second tap, even at enlarged text sizes');
    }
  }
  assert.match(css, /overflow: auto/);
  assert.match(css, /white-space: normal/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /font-size: \.8125rem/);
  const controls = css.match(/\.trigger, \.close\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(controls, /min-width: 44px/, 'both help controls retain the mobile target floor');
  assert.match(controls, /min-height: 44px/, 'both help controls retain the mobile target floor');
  assert.match(css, /\.trigger svg, \.close svg\s*\{[^}]*width: 16px; height: 16px;/, 'larger targets keep quiet icons');
});

test('help accounts for a zoomed or keyboard-offset visual viewport and repositions above when needed', () => {
  const viewport = { left: 80, top: 120, width: 160, height: 210 };
  const p = getInfoHelpPosition({ left: 190, right: 220, top: 270, bottom: 300 }, 130, viewport);
  assert.equal(p.width, 136);
  assert.ok(p.left >= 92 && p.left + p.width <= 228);
  assert.ok(p.top >= 132 && p.top + 130 <= 318);
  assert.equal(p.top, 134);
});

/** Socket-free interaction harness runs the actual component effects and event
 * handlers, with hook scheduling and DOM adapters. It is not a browser-layout
 * test; the geometry contract above covers measured viewport inputs. */
function interactionHarness(native = true) {
  const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    transformSync: (input: string, options: Record<string, string>) => { code: string };
  };
  type Listener = { callback: (event: any) => void; capture: boolean };
  class Events {
    listeners = new Map<string, Listener[]>();
    addEventListener(type: string, callback: Listener['callback'], capture = false) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), { callback, capture }]); }
    removeEventListener(type: string, callback: Listener['callback'], capture = false) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.callback !== callback || item.capture !== capture)); }
    dispatch(type: string, event: any) { for (const item of [...(this.listeners.get(type) ?? [])]) { item.callback(event); if (event.immediate) break; } }
  }
  const document = Object.assign(new Events(), { activeElement: null as FakeElement | null, body: null as unknown as FakeElement });
  class FakeElement {
    parentElement: FakeElement | null = null;
    style: Record<string, any> = {};
    isConnected = true;
    clientLeft = 0; clientTop = 0; scrollLeft = 0; scrollTop = 0;
    owner: FakeElement | null = null;
    shown = false;
    inactive = false;
    focused = 0;
    props: Record<string, any> = {};
    rect = { left: 260, right: 290, top: 140, bottom: 170, width: 30, height: 30 };
    contains(target: FakeElement) { for (let node: FakeElement | null = target; node; node = node.parentElement) if (node === this) return true; return false; }
    closest(query: string) { if (query.includes('[role="dialog"]')) return this.owner; if (query.includes('[inert]')) { if (this.inactive) return this; for (let node: FakeElement | null = this.parentElement; node; node = node.parentElement) if (node.inactive) return node; } return null; }
    getBoundingClientRect() { return this.props['data-info-help-panel'] !== undefined ? { ...this.rect, height: 110, width: Number.parseFloat(this.style.width) || 296 } : this.rect; }
    removeAttribute() {}
    focus() { this.focused++; document.activeElement = this; document.dispatch('focusin', { target: this }); }
  }
  if (native) Object.assign(FakeElement.prototype, { showPopover(this: FakeElement) { this.shown = true; }, hidePopover(this: FakeElement) { this.shown = false; } });
  document.body = new FakeElement();
  const viewport = Object.assign(new Events(), { offsetLeft: 0, offsetTop: 0, width: 320, height: 640 });
  const window = Object.assign(new Events(), { visualViewport: viewport, innerWidth: 320, innerHeight: 640, getComputedStyle: () => ({ transform: 'none', perspective: 'none', filter: 'none', contain: '', willChange: '' }) });
  let current: Instance;
  type Effect = { deps: unknown[]; cleanup?: () => void };
  type Instance = { hooks: any[]; index: number; effects: Array<() => void>; dirty: boolean; id: string; tree: any; trigger: FakeElement; panel: FakeElement; mountedPanel: boolean; render: () => void; unmount: () => void };
  const hooks = {
    useId() { const instance = current; const i = instance.index++; return instance.hooks[i] ??= instance.id; },
    useRef(value: unknown) { const instance = current; const i = instance.index++; return instance.hooks[i] ??= { current: value }; },
    useCallback(callback: (...args: any[]) => any, deps: unknown[]) { const instance = current; const i = instance.index++; const old = instance.hooks[i] as { callback: typeof callback; deps: unknown[] } | undefined; if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) instance.hooks[i] = { callback, deps }; return instance.hooks[i].callback; },
    useState(value: unknown) { const instance = current; const i = instance.index++; if (!(i in instance.hooks)) instance.hooks[i] = value; return [instance.hooks[i], (next: unknown) => { instance.hooks[i] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(instance.hooks[i]) : next; instance.dirty = true; }]; },
    useLayoutEffect(effect: () => (() => void) | undefined, deps: unknown[]) { const instance = current; const i = instance.index++; const old = instance.hooks[i] as Effect | undefined; if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) instance.effects.push(() => { old?.cleanup?.(); instance.hooks[i] = { deps, cleanup: effect() }; }); },
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const mutations: Array<() => void> = [];
  class MutationObserver { constructor(callback: () => void) { mutations.push(callback); } observe() {} disconnect() {} }
  const module = { exports: {} as any };
  runInNewContext(transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code, {
    module, exports: module.exports, require: (name: string) => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' } : name === 'react-dom' ? { createPortal: (child: any, target: FakeElement) => ({ portal: child, target }) } : name === 'lucide-react' ? { Info: 'info', X: 'x' } : name === './infoHelpContent' ? { INFO_HELP_CONTENT } : { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
    window, document, HTMLElement: FakeElement, Node: FakeElement, MutationObserver, setTimeout, clearTimeout,
  });
  const instances: Instance[] = [];
  const mount = (label: string, owner: FakeElement | null = null) => {
    const instance: Instance = { hooks: [], index: 0, effects: [], dirty: true, id: `help-${instances.length}`, tree: null, trigger: new FakeElement(), panel: new FakeElement(), mountedPanel: false,
      render() {
        current = instance; instance.index = 0; instance.effects = []; instance.dirty = false;
        instance.tree = module.exports.InfoHelp({ label, definition: 'minimumReceived' });
        const visit = (node: any, parent = owner ?? document.body) => {
          if (!node) return;
          if (Array.isArray(node)) { node.forEach(child => visit(child, parent)); return; }
          if (node.portal) { visit(node.portal, node.target); return; }
          if (!node.props) return;
          let element: FakeElement | undefined;
          if (node.props['data-info-help-trigger'] !== undefined) element = instance.trigger;
          if (node.props['data-info-help-panel'] !== undefined) { element = instance.panel; instance.mountedPanel = true; }
          if (element) { element.isConnected = true; element.props = node.props; element.owner = owner; element.parentElement = parent; Object.assign(element.style, node.props.style); node.props.ref.current = element; }
          visit(node.props.children, element ?? parent);
        };
        instance.mountedPanel = false; visit(instance.tree); instance.effects.forEach(effect => effect());
        if (!instance.mountedPanel) { instance.panel.isConnected = false; instance.panel.shown = false; }
      },
      unmount() { for (const hook of instance.hooks) hook?.cleanup?.(); instance.trigger.isConnected = false; instance.panel.isConnected = false; instance.panel.shown = false; },
    };
    instances.push(instance); instance.render(); return instance;
  };
  const flush = () => { for (let turns = 0; instances.some(instance => instance.dirty); turns++) { assert.ok(turns < 10, 'render converges'); for (const instance of instances) if (instance.dirty) instance.render(); } };
  const event = (target?: FakeElement, key?: string) => ({ target, key, prevented: false, stopped: false, immediate: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = this.immediate = true; } });
  const click = (instance: Instance) => { const e = event(instance.trigger); instance.trigger.props.onClick(e); flush(); return e; };
  return { mount, flush, click, event, window, document, viewport, FakeElement, mutations };
}

test('tap opens one panel, focus enters its description, and a second help replaces it', () => {
  const h = interactionHarness(); const first = h.mount('Minimum received'); const second = h.mount('Slippage');
  const e = h.click(first);
  assert.ok(e.prevented && e.stopped);
  assert.equal(first.trigger.props['aria-expanded'], true);
  assert.equal(first.panel.props.role, 'dialog');
  assert.equal(first.panel.props['aria-modal'], 'false');
  assert.equal(first.panel.style.visibility, 'visible');
  assert.equal(h.document.activeElement, first.panel);
  assert.equal(first.panel.shown, true);
  h.click(second);
  assert.equal(first.trigger.props['aria-expanded'], false);
  assert.equal(second.trigger.props['aria-expanded'], true);
  assert.equal(first.panel.shown, false);
  first.unmount(); second.unmount();
});

test('Escape is captured before the sheet handler, closes only help and returns trigger focus', () => {
  const h = interactionHarness(); const instance = h.mount('Minimum received'); let parentClosed = 0;
  h.document.addEventListener('keydown', () => parentClosed++);
  h.click(instance);
  const e = h.event(instance.panel, 'Escape');
  h.window.dispatch('keydown', e);
  if (!e.stopped) h.document.dispatch('keydown', e);
  h.flush();
  assert.ok(e.prevented && e.immediate);
  assert.equal(parentClosed, 0);
  assert.equal(instance.trigger.props['aria-expanded'], false);
  assert.equal(h.document.activeElement, instance.trigger);
  const next = h.event(instance.trigger, 'Escape');
  h.window.dispatch('keydown', next); if (!next.stopped) h.document.dispatch('keydown', next);
  assert.equal(parentClosed, 1);
  instance.unmount();
});

test('outside pointer or focus closes help without stealing focus or suppressing the target action', () => {
  const h = interactionHarness(); const instance = h.mount('Minimum received'); const outside = new h.FakeElement();
  h.click(instance);
  const e = h.event(outside); h.document.dispatch('pointerdown', e); h.flush();
  assert.equal(instance.trigger.focused, 0);
  assert.equal(e.prevented, false);
  assert.equal(e.stopped, false);
  h.click(instance); outside.focus(); h.flush();
  assert.equal(h.document.activeElement, outside);
  assert.equal(instance.trigger.props['aria-expanded'], false);
  instance.unmount();
});

test('resize and scroll reposition the open help; cleanup removes all listeners', () => {
  const h = interactionHarness(); const instance = h.mount('Minimum received'); h.click(instance);
  const before = instance.panel.style.top;
  instance.trigger.rect = { ...instance.trigger.rect, top: 400, bottom: 430 };
  h.window.dispatch('scroll', h.event()); h.flush(); assert.notEqual(instance.panel.style.top, before);
  h.viewport.width = 160; h.viewport.dispatch('resize', h.event()); h.flush(); assert.equal(instance.panel.style.width, 136);
  instance.unmount();
  for (const target of [h.window, h.document, h.viewport]) for (const list of target.listeners.values()) assert.equal(list.length, 0);
});

test('native and fallback help stay in the parent dialog DOM tree for its existing focus trap', () => {
  for (const native of [true, false]) {
    const h = interactionHarness(native); const owner = new h.FakeElement();
    owner.rect = { left: 0, right: 320, top: 80, bottom: 640, width: 320, height: 560 };
    const instance = h.mount('Minimum received', owner); let escapedFocus = 0;
    h.document.addEventListener('focusin', e => { if (!owner.contains(e.target)) escapedFocus++; });
    h.click(instance);
    assert.equal(owner.contains(instance.panel), true);
    assert.equal(escapedFocus, 0);
    assert.equal(instance.panel.props.popover, native ? 'manual' : undefined);
    instance.unmount();
  }
});

test('settings keep current limits, revert warning, gas units and unavailable-rate message visible', () => {
  const settings = readFileSync(new URL('../src/components/TransactionSettings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /MetricLabel label="Max slippage" definition="maxSlippage"/);
  assert.match(settings, /MetricLabel label="Network speed" definition="networkSpeed"/);
  assert.match(settings, /Reverts if price moves beyond the displayed slippage limit/);
  assert.match(settings, /Gas prices in gwei/);
  assert.match(settings, /Live gas rates are unavailable/);
  assert.match(settings, /aria-describedby=\{`\$\{id\}-slippage-help`\}/);
});


test('Telegram Back dismisses help first, consumes the event and leaves parent handling for the next Back', () => {
  const h = interactionHarness(); const instance = h.mount('Minimum received'); h.click(instance);
  let consumed = false; let parentClosed = 0;
  h.window.addEventListener('fxaeon:telegram-back', () => parentClosed++);
  const e = Object.assign(h.event(instance.panel), { detail: { consume: () => { consumed = true; }, isConsumed: () => consumed } });
  h.window.dispatch('fxaeon:telegram-back', e); h.flush();
  assert.equal(consumed, true);
  assert.equal(parentClosed, 0);
  assert.equal(instance.trigger.props['aria-expanded'], false);
  h.window.dispatch('fxaeon:telegram-back', h.event());
  assert.equal(parentClosed, 1);
  instance.unmount();
});

test('help closes without restoring focus when its parent sheet becomes inert during exit', () => {
  const h = interactionHarness(); const owner = new h.FakeElement();
  owner.rect = { left: 0, right: 320, top: 80, bottom: 640, width: 320, height: 560 };
  const instance = h.mount('Minimum received', owner); h.click(instance);
  owner.inactive = true; h.mutations.forEach(callback => callback()); h.flush();
  assert.equal(instance.trigger.props['aria-expanded'], false);
  assert.equal(instance.panel.shown, false);
  assert.equal(instance.trigger.focused, 0);
  instance.unmount();
});
