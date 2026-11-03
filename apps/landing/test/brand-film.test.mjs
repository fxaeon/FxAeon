import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../brand-film.js', import.meta.url), 'utf8');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

class Element extends EventTarget {
  dataset = {};
  attributes = new Map();
  hidden = false;
  textContent = '';
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  fire(type, values = {}) { this.dispatchEvent(Object.assign(new Event(type), values)); }
}

class Video extends Element {
  paused = true;
  ended = false;
  position = 0;
  sources = [];
  requests = [];
  loads = 0;
  poster = 'assets/brand-film-poster.jpg';
  get currentTime() { return this.position; }
  set currentTime(value) { this.position = value; this.ended = false; }
  set src(value) { this.sources.push(value); }
  play() {
    if (this.playError) throw this.playError;
    this.paused = false;
    const request = {};
    request.promise = new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
    this.requests.push(request);
    return request.promise;
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.queuePause) this.queuedPauses = (this.queuedPauses ?? 0) + 1;
    else this.fire('pause');
  }
  load() { this.loads += 1; }
  playing(index = this.requests.length - 1) {
    this.paused = false;
    this.fire('playing');
    this.requests[index].resolve();
  }
  end() {
    this.ended = true;
    this.paused = true;
    this.fire('pause');
    this.fire('ended');
  }
}

function setup(options = {}) {
  const video = new Video();
  const button = new Element();
  button.hidden = true;
  const figure = new Element();
  figure.dataset.filmSrc = options.source ?? 'assets/brand-film.mp4';
  if (options.mobileSource) figure.dataset.filmMobileSrc = options.mobileSource;
  if (options.sourceOnVideo) {
    Object.assign(video.dataset, figure.dataset);
    figure.dataset = {};
  }
  figure.querySelector = selector => selector === 'video' ? (options.noVideo ? null : video)
    : selector === '[data-film-toggle]' ? (options.noButton ? null : button) : null;
  const document = new Element();
  document.baseURI = options.baseURI ?? 'https://fxaeon.xyz/';
  document.readyState = options.loading ? 'loading' : 'complete';
  document.visibilityState = options.hidden ? 'hidden' : 'visible';
  document.querySelectorAll = () => options.empty ? [] : [figure];
  const reduced = Object.assign(new Element(), { matches: Boolean(options.reduced) });
  const mobile = { matches: Boolean(options.mobile) };
  if (options.legacyMedia) {
    reduced.addListener = callback => EventTarget.prototype.addEventListener.call(reduced, 'change', callback);
    reduced.removeListener = callback => EventTarget.prototype.removeEventListener.call(reduced, 'change', callback);
    reduced.addEventListener = undefined;
  }
  const connection = Object.assign(new Element(), {
    saveData: Boolean(options.saveData), effectiveType: options.effectiveType ?? '4g',
  });
  const window = Object.assign(new Element(), {
    location: { origin: 'https://fxaeon.xyz' },
    matchMedia: query => query.includes('prefers-reduced-motion') ? reduced : mobile,
  });
  let observer;
  if (!options.noObserver) window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { this.target = target; this.connected = true; }
    disconnect() { this.connected = false; }
  };
  if (options.noMatchMedia) window.matchMedia = undefined;
  runInNewContext(script, { document, window, navigator: options.noConnection ? {} : { connection }, URL });
  return {
    video, button, figure, document, window, reduced, mobile, connection,
    intersect(ratio, isIntersecting = ratio > 0) {
      if (observer?.connected) observer.callback([{ target: figure, isIntersecting, intersectionRatio: ratio }]);
    },
    visibility(value) { document.visibilityState = value; document.fire('visibilitychange'); },
    click() { button.fire('click'); },
    preference(value) { reduced.matches = value; reduced.fire('change'); },
  };
}

function label(fixture, value) {
  assert.equal(fixture.button.textContent, value);
  assert.equal(fixture.button.getAttribute('aria-label'), value);
}

test('defers DOM initialization; missing markup leaves the poster untouched', () => {
  const f = setup({ loading: true });
  assert.equal(f.button.hidden, true);
  assert.deepEqual(f.video.sources, []);
  f.document.fire('DOMContentLoaded');
  f.document.fire('DOMContentLoaded');
  assert.equal(f.button.hidden, false);
  assert.equal(f.video.poster, 'assets/brand-film-poster.jpg');
  f.intersect(0.35);
  assert.equal(f.video.requests.length, 1);
  for (const options of [{ noVideo: true }, { noButton: true }, { empty: true }]) {
    const absent = setup(options);
    assert.equal(absent.button.hidden, true);
    assert.deepEqual(absent.video.sources, []);
  }
});

test('35% is inclusive; intersection and foreground visibility are both required', () => {
  const f = setup({ hidden: true });
  assert.equal(f.video.preload, 'none');
  assert.equal(f.video.autoplay, false);
  assert.equal(f.video.loop, false);
  assert.equal(f.video.muted, true);
  assert.equal(f.video.defaultMuted, true);
  assert.equal(f.video.playsInline, true);
  assert.equal(f.button.type, 'button');
  f.intersect(0.35);
  assert.deepEqual(f.video.sources, []);
  f.intersect(0.3499);
  f.visibility('visible');
  assert.deepEqual(f.video.sources, []);
  f.intersect(0.8, false);
  assert.deepEqual(f.video.sources, []);
  f.intersect(0.35);
  assert.deepEqual(f.video.sources, ['https://fxaeon.xyz/assets/brand-film.mp4']);
  assert.equal(f.video.requests.length, 1);
  label(f, 'Cancel brand film playback');
  f.video.playing();
  label(f, 'Pause brand film');
});

for (const options of [
  { reduced: true }, { saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' },
]) test(`restricted playback waits for explicit play: ${JSON.stringify(options)}`, () => {
  const f = setup(options);
  f.intersect(1);
  f.visibility('hidden');
  f.visibility('visible');
  assert.deepEqual(f.video.sources, []);
  assert.equal(f.video.requests.length, 0);
  label(f, 'Play brand film');
  f.click();
  assert.equal(f.video.sources.length, 1);
  f.video.playing();
  label(f, 'Pause brand film');
});

test('viewport and tab pauses preserve position and resume; a user pause never resumes', async () => {
  const f = setup();
  f.intersect(0.35);
  f.video.playing();
  await flush();
  f.video.currentTime = 3;
  f.intersect(0.3499);
  assert.equal(f.video.paused, true);
  label(f, 'Play brand film');
  f.visibility('hidden');
  f.intersect(0.7);
  assert.equal(f.video.requests.length, 1);
  f.visibility('visible');
  assert.equal(f.video.requests.length, 2);
  assert.equal(f.video.currentTime, 3);
  f.video.playing();
  await flush();
  f.click();
  assert.equal(f.video.paused, true);
  f.intersect(0);
  f.intersect(1);
  f.visibility('hidden');
  f.visibility('visible');
  assert.equal(f.video.requests.length, 2);
  f.click();
  assert.equal(f.video.requests.length, 3);
});

test('native media pause is respected, and buffering never claims to be playing', async () => {
  const f = setup();
  f.intersect(1);
  f.video.playing();
  await flush();
  f.video.fire('waiting');
  label(f, 'Cancel brand film playback');
  f.intersect(0.5);
  assert.equal(f.video.requests.length, 1, 'buffering is not a second play request');
  f.video.fire('playing');
  label(f, 'Pause brand film');
  f.video.pause();
  f.visibility('hidden');
  f.visibility('visible');
  assert.equal(f.video.requests.length, 1);
});

test('a native pause during a pending play request prevents later automatic resumption', async () => {
  const f = setup();
  f.intersect(1);
  f.video.pause();
  f.video.requests[0].resolve();
  await flush();
  f.intersect(0);
  f.intersect(1);
  f.visibility('hidden');
  f.visibility('visible');
  label(f, 'Play brand film');
  assert.equal(f.video.requests.length, 1);
});

test('queued lifecycle pause events do not cancel a newer playback request', async () => {
  const f = setup();
  f.video.queuePause = true;
  f.intersect(1);
  f.video.playing();
  await flush();
  f.visibility('hidden');
  assert.equal(f.video.queuedPauses, 1);
  f.visibility('visible');
  f.video.fire('pause'); // Queued event; the resumed media is already unpaused.
  f.video.playing(1);
  await flush();
  label(f, 'Pause brand film');
  f.video.queuePause = false;
  f.video.pause(); // A subsequent native pause still belongs to the user.
  f.visibility('hidden');
  f.visibility('visible');
  assert.equal(f.video.requests.length, 2);
});

test('completion stays still through visibility changes; only explicit replay rewinds', async () => {
  const f = setup();
  f.intersect(1);
  f.video.playing();
  await flush();
  f.video.currentTime = 7;
  f.video.end();
  label(f, 'Replay brand film');
  f.intersect(0);
  f.intersect(1);
  f.visibility('hidden');
  f.visibility('visible');
  assert.equal(f.video.requests.length, 1);
  assert.equal(f.video.currentTime, 7);
  f.click();
  assert.equal(f.video.currentTime, 0);
  assert.equal(f.video.requests.length, 2);
  assert.equal(f.video.sources.length, 1);
  f.video.playing();
  label(f, 'Pause brand film');
});

for (const legacyMedia of [false, true]) test(`live motion opt-out cancels playback and stays opted out (legacy=${legacyMedia})`, async () => {
  const f = setup({ legacyMedia });
  f.intersect(1);
  f.preference(true);
  assert.equal(f.video.paused, true);
  f.video.playing(0); // Simulate a late media event and successful play promise.
  await flush();
  assert.equal(f.video.paused, true);
  label(f, 'Play brand film');
  f.preference(false);
  f.intersect(0);
  f.intersect(1);
  f.visibility('hidden');
  f.visibility('visible');
  assert.equal(f.video.requests.length, 1);
  f.click();
  f.video.playing();
  label(f, 'Pause brand film');
});

test('live data-saving opt-out pauses even an explicitly started film', () => {
  const f = setup({ reduced: true });
  f.intersect(1);
  f.click();
  f.video.playing();
  f.connection.saveData = true;
  f.connection.fire('change');
  assert.equal(f.video.paused, true);
  f.connection.saveData = false;
  f.connection.fire('change');
  f.intersect(1);
  assert.equal(f.video.requests.length, 1);
});

test('autoplay rejection and synchronous play failure expose an honest explicit retry', async () => {
  const f = setup();
  f.intersect(1);
  f.video.requests[0].reject(new Error('NotAllowedError'));
  await flush();
  label(f, 'Play brand film');
  assert.equal(f.video.paused, true);
  f.intersect(0);
  f.intersect(1);
  assert.equal(f.video.requests.length, 1);
  f.video.playError = new Error('NotSupportedError');
  f.click();
  label(f, 'Play brand film');
  f.video.playError = null;
  f.click();
  f.video.playing();
  label(f, 'Pause brand film');
});

test('media errors stop playback and retry reloads only on explicit activation', async () => {
  const f = setup();
  f.intersect(1);
  f.video.fire('error');
  label(f, 'Retry brand film');
  assert.equal(f.video.paused, true);
  f.video.requests[0].reject(new Error('decode error'));
  await flush();
  f.intersect(1);
  assert.equal(f.video.loads, 0);
  f.click();
  assert.equal(f.video.loads, 1);
  f.video.playing();
  label(f, 'Pause brand film');
});

test('late rejected and resolved requests cannot cancel a newer explicit play', async () => {
  for (const settle of ['resolve', 'reject']) {
    const f = setup();
    f.intersect(1);
    f.click(); // Cancel the pending request.
    label(f, 'Play brand film');
    f.click();
    f.video.playing(1);
    f.video.requests[0][settle](new Error('old request'));
    await flush();
    label(f, 'Pause brand film');
    assert.equal(f.video.paused, false);
    assert.equal(f.video.requests.length, 2);
  }
});

test('leaving the viewport cancels pending playback and guards late playing events', async () => {
  const f = setup();
  f.intersect(1);
  f.intersect(0);
  f.video.playing();
  await flush();
  assert.equal(f.video.paused, true);
  label(f, 'Play brand film');
  f.intersect(0.35);
  assert.equal(f.video.requests.length, 2);
});

test('mobile rendition is selected at first play and retained for the session', () => {
  const f = setup({ sourceOnVideo: true, mobileSource: 'assets/brand-film-mobile.mp4' });
  f.mobile.matches = true;
  f.intersect(0.35);
  assert.deepEqual(f.video.sources, ['https://fxaeon.xyz/assets/brand-film-mobile.mp4']);
  f.video.playing();
  f.video.end();
  f.mobile.matches = false;
  f.click();
  assert.equal(f.video.sources.length, 1);
  const desktop = setup({ mobileSource: 'assets/brand-film-mobile.mp4' });
  desktop.intersect(1);
  assert.deepEqual(desktop.video.sources, ['https://fxaeon.xyz/assets/brand-film.mp4']);
});

test('external and non-HTTP film sources never attach; invalid mobile falls back locally', () => {
  for (const source of ['https://other.example/film.mp4', '//other.example/film.mp4', 'data:video/mp4;base64,AA', 'javascript:alert(1)', '']) {
    const f = setup({ source });
    f.intersect(1);
    f.click();
    assert.deepEqual(f.video.sources, []);
    assert.equal(f.button.hidden, true);
  }
  const base = setup({ baseURI: 'https://other.example/' });
  assert.equal(base.button.hidden, true);
  const mobile = setup({ mobile: true, mobileSource: 'https://other.example/film.mp4' });
  mobile.intersect(1);
  assert.deepEqual(mobile.video.sources, ['https://fxaeon.xyz/assets/brand-film.mp4']);
});

test('missing optional APIs retain a usable explicit play button without speculative autoplay', () => {
  const f = setup({ noObserver: true, noMatchMedia: true, noConnection: true });
  assert.equal(f.button.hidden, false);
  assert.deepEqual(f.video.sources, []);
  f.visibility('hidden');
  f.visibility('visible');
  assert.deepEqual(f.video.sources, []);
  f.click();
  f.video.playing();
  label(f, 'Pause brand film');
  f.visibility('hidden');
  assert.equal(f.video.paused, true);
  f.visibility('visible');
  assert.equal(f.video.requests.length, 2);
});

test('bfcache restoration requires fresh viewport evidence; final navigation cleans up', async () => {
  const f = setup();
  f.intersect(1);
  f.video.playing();
  await flush();
  f.window.fire('pagehide', { persisted: true });
  assert.equal(f.video.paused, true);
  f.window.fire('pageshow', { persisted: true });
  f.visibility('visible');
  assert.equal(f.video.requests.length, 1);
  f.intersect(0);
  assert.equal(f.video.requests.length, 1);
  f.intersect(1);
  assert.equal(f.video.requests.length, 2);
  f.window.fire('pagehide', { persisted: false });
  f.video.playing(1);
  await flush();
  assert.equal(f.video.paused, true, 'a late play cannot outlive final navigation');
  f.click();
  f.visibility('visible');
  f.window.fire('pageshow');
  f.intersect(1);
  assert.equal(f.video.requests.length, 2);
});
