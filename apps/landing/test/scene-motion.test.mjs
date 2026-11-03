import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../scene-motion.js', import.meta.url), 'utf8');
const { initSceneMotion } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function fixture({ reduced = false, hidden = false, observe = true } = {}) {
  const toggle = Object.assign(new EventTarget(), {
    hidden: true,
    textContent: 'Pause animation',
  });
  const world = {};
  const scene = {
    dataset: {},
    querySelector: selector => selector === '.journey-world' ? world : null,
  };
  const document = Object.assign(new EventTarget(), {
    hidden,
    readyState: 'complete',
    querySelector: selector => ({
      '.journey-scene': scene,
      '[data-scene-toggle]': toggle,
    })[selector] ?? null,
  });
  const media = Object.assign(new EventTarget(), { matches: reduced });
  let report;
  const window = {
    matchMedia(query) {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return media;
    },
  };
  if (observe) {
    window.IntersectionObserver = class {
      constructor(callback, options) {
        assert.equal(options.threshold, 0.01);
        report = callback;
      }
      observe(target) { assert.equal(target, scene); }
    };
  }
  return {
    document, window, scene, toggle,
    start() { initSceneMotion(document, window); },
    click() { toggle.dispatchEvent(new Event('click')); },
    viewport(visible, ratio = visible ? 1 : 0) {
      report([{ target: scene, isIntersecting: visible, intersectionRatio: ratio }]);
    },
    visibility(value) {
      document.hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    reduce(value) {
      media.matches = value;
      media.dispatchEvent(new Event('change'));
    },
    expect(state, controlHidden = false) {
      assert.equal(scene.dataset.state, state);
      assert.equal(toggle.hidden, controlHidden);
      assert.equal(toggle.textContent,
        state === 'running' ? 'Pause animation' : 'Play animation');
    },
  };
}

test('enhances only a complete scene and reveals the working control', () => {
  for (const missing of ['.journey-scene', '[data-scene-toggle]', '.journey-world']) {
    const f = fixture();
    if (missing === '.journey-world') f.scene.querySelector = () => null;
    else {
      const query = f.document.querySelector;
      f.document.querySelector = selector => selector === missing ? null : query(selector);
    }
    f.start();
    assert.equal(f.toggle.hidden, true);
    assert.deepEqual(f.scene.dataset, {});
  }
  const f = fixture();
  f.start();
  f.expect('paused');
  f.viewport(true);
  f.expect('running');
});

test('viewport and page visibility gates pause and resume together', () => {
  const f = fixture();
  f.start();
  f.viewport(true);
  f.expect('running');
  f.viewport(false);
  f.expect('paused');
  f.visibility(true);
  f.viewport(true);
  f.expect('paused');
  f.visibility(false);
  f.expect('running');
  f.visibility(true);
  f.viewport(false);
  f.visibility(false);
  f.expect('paused');
  f.viewport(true, 0); // Merely touching the viewport edge is not visible.
  f.expect('paused');
  f.viewport(true, 0.005);
  f.expect('paused');
  f.viewport(true, 0.01);
  f.expect('running');
  f.viewport(true);
  f.expect('running');
});

test('manual pause survives viewport, visibility and reduced motion changes', () => {
  const f = fixture();
  f.start();
  f.viewport(true);
  f.click();
  f.expect('paused');
  f.viewport(false);
  f.visibility(true);
  f.reduce(true);
  f.expect('paused', true);
  f.click(); // A hidden reduced-motion control cannot clear a manual pause.
  f.reduce(false);
  f.visibility(false);
  f.viewport(true);
  f.expect('paused');
  f.click();
  f.expect('running');
});

test('play requests cannot override environmental pause gates', () => {
  const f = fixture();
  f.start();
  f.click();
  f.expect('paused');
  f.viewport(true);
  f.expect('running');
  f.click();
  f.visibility(true);
  f.click();
  f.expect('paused');
  f.visibility(false);
  f.expect('running');
});

test('reduced motion starts static, hides control and can be changed live', () => {
  const f = fixture({ reduced: true });
  f.start();
  f.viewport(true);
  f.expect('paused', true);
  f.reduce(false);
  f.expect('running');
  f.reduce(true);
  f.expect('paused', true);
  f.viewport(false);
  f.reduce(false);
  f.expect('paused');
});

test('without IntersectionObserver visibility defaults on and other gates still apply', () => {
  for (const hidden of [false, true]) {
    const f = fixture({ observe: false, hidden });
    f.start();
    f.expect(hidden ? 'paused' : 'running');
    f.visibility(false);
    f.expect('running');
    f.reduce(true);
    f.expect('paused', true);
    f.reduce(false);
    f.click();
    f.visibility(true);
    f.visibility(false);
    f.expect('paused');
  }
});

test('module boots after DOM readiness or immediately when the DOM is ready', () => {
  for (const readyState of ['loading', 'interactive', 'complete']) {
    const f = fixture({ observe: false });
    f.document.readyState = readyState;
    // Strip only the export keyword to exercise the real module bootstrap in a
    // separate browser-like global without adding a DOM dependency.
    vm.runInNewContext(source.replace('export function', 'function'), {
      document: f.document, window: f.window,
    });
    if (readyState === 'loading') {
      assert.equal(f.toggle.hidden, true);
      f.document.dispatchEvent(new Event('DOMContentLoaded'));
    }
    f.expect('running');
  }
});
