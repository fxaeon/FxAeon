#!/usr/bin/env node
/** Public, disconnected Chromium lab audit. Run --help for usage and limits. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { availableParallelism, totalmem } from 'node:os';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

const ROOT = resolve(import.meta.dirname, '..');
export const ROUTES = ['portfolio', 'trade', 'earn', 'borrow', 'move', 'more'];
export const VIEWPORTS = {
  phone390844: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet7681024: { width: 768, height: 1024, isMobile: true, hasTouch: true },
  desktop1440900: { width: 1440, height: 900, isMobile: false, hasTouch: false },
};
const HELP = `FxAeon public/disconnected browser LAB audit (no score; no field INP).
Usage: node scripts/audit_production_browser.mjs [options]
  --base-url URL          App base; default http://127.0.0.1:4321
  --landing-base-url URL  Also audit landing / at this explicitly supplied base
  --routes LIST          portfolio,trade,earn,borrow,move,more[,landing]
  --viewports LIST       phone390844,tablet7681024,desktop1440900 (default all)
  --samples N            Cold contexts per route/viewport, default 1 (1..20)
  --window-ms N          Fixed post-ready observation window, default 3000 (100..60000)
  --timeout-ms N         Navigation and readiness phase bounds, default 30000 (1000..60000)
  --label NAME           Output prefix, e.g. before or after; default audit
  --help                 Print this help without loading Playwright

Examples (start YOUR server separately; this tool never builds/starts/installs):
  node scripts/audit_production_browser.mjs --base-url http://127.0.0.1:4321 --samples 3 --label before
  node scripts/audit_production_browser.mjs --base-url https://fxaeon.com --samples 3 --label after
  node scripts/audit_production_browser.mjs --landing-base-url http://127.0.0.1:4355 --routes landing

Only use explicitly supplied origins serving our app. Bases must be HTTP(S),
without credentials/query/fragment; optional subdirectory prefixes are preserved.
Outputs: ignored output/audit-production-browser/<label>-<UTC>-<id>/report.json
and ordered viewport PNG frames. Unique directories preserve before/after runs; compare raw
per-route/viewport samples using the same machine, browser, settings and server
build. Exit 1 = incomplete sample, HTTP/navigation/readiness/capture failure or
browser setup failure; exit 2 = invalid arguments. Console/network/overflow
findings are evidence, not invented performance pass/fail thresholds.

New temporary browser + empty context per sample; no attached user profile,
wallet fixtures, clicks, sign-in or transactions. Service workers/cache disabled.
External document navigations are blocked; dependency subresources are live.
App readiness: visible main content, matching data-route and enabled visible
Connect wallet control. Landing: visible hero + initialized menu/calculator
markers. These are bounded UI readiness signals, not proof all React hydrated.
Observe a fixed window after UI/fonts readiness (font wait capped at 2000ms),
not networkidle. Metrics stop BEFORE capture. Capture inventories visible vertical
scroll containers (including main.app-content), scrolls each through overlapping
top/middle/bottom viewport frames, and restores its original position. It never
expands CSS or masks UI. Capture is bounded to 24 frames / timeout-ms and reports
reachedBottom, coverage gaps and completeness; PNGs disable animations. No
scrolling or interactions during measurement. A fixed window does not imply quiet.

FCP/LCP are navigation-relative, LCP provisional at cutoff; CLS is maximum
1s-gap/5s session (no recent input). Long tasks are main-frame only. Missing
metrics are null, never zero-filled. DOM/load timings are Navigation Timing.
CDP completed encoded response bytes include headers; JS is CDP Script plus JS
MIME responses. Resource rows include sanitized URL/type, encoded bytes, duration,
cache flag, relative start and minimal prefetch/discovery evidence (no stacks).
Content encoding is recorded: uncompressed local HTTP is NOT CDN compressed
transfer. Counts retain failures/pending; incomplete transfer bytes are excluded.
Only aborted same-origin GET RSC requests with Next's explicit prefetch header
are categorized next-prefetch-aborted; all errors remain listed and counted.
No CPU/network throttling: these are local lab timings, NOT field INP,
Core Web Vitals certification, chain latency or connected-wallet coverage.
Browser process/DNS/TLS/OS/server/CDN caches can stay warm between contexts.
Measurements use normal motion; dynamic data/time may vary between captures.
JSON excludes payloads/headers/cookies/storage/console text/DOM text; URL records
retain origin + sanitized path only, never query/hash/userinfo. Long/encoded or
account-like path segments are redacted. Screenshots still contain public UI.
E2E_BROWSER_CHANNEL=chrome|msedge is supported via the existing repo helper.
`;

function baseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Base must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base must be HTTP(S) without credentials, query or fragment.');
  }
  if (url.pathname.split('/').some(segment => segment && !/^[a-zA-Z0-9_-]{1,48}$/.test(segment))) {
    throw new Error('Base path must contain simple public directory names only.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

export function parseOptions(args) {
  const options = { baseUrl: 'http://127.0.0.1:4321/', landingBaseUrl: null,
    routes: [...ROUTES], viewports: Object.keys(VIEWPORTS), samples: 1,
    windowMs: 3000, timeoutMs: 30000, label: 'audit' };
  const names = { '--base-url': 'baseUrl', '--landing-base-url': 'landingBaseUrl', '--routes': 'routes',
    '--viewports': 'viewports', '--samples': 'samples', '--window-ms': 'windowMs',
    '--timeout-ms': 'timeoutMs', '--label': 'label' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') return { help: true };
    if (!Object.hasOwn(names, flag) || seen.has(flag)) throw new Error('Unknown or duplicate option. Use --help.');
    seen.add(flag);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('Every option requires a value. Use --help.');
    options[names[flag]] = value;
  }
  options.baseUrl = baseUrl(options.baseUrl);
  if (options.landingBaseUrl) options.landingBaseUrl = baseUrl(options.landingBaseUrl);
  for (const [key, min, max] of [['samples', 1, 20], ['windowMs', 100, 60000], ['timeoutMs', 1000, 60000]]) {
    if (!/^\d+$/.test(String(options[key])) || Number(options[key]) < min || Number(options[key]) > max) {
      throw new Error(`${key} must be an integer in ${min}..${max}.`);
    }
    options[key] = Number(options[key]);
  }
  for (const [key, allowed] of [['routes', [...ROUTES, 'landing']], ['viewports', Object.keys(VIEWPORTS)]]) {
    if (typeof options[key] === 'string') options[key] = options[key].split(',');
    if (!options[key].length || new Set(options[key]).size !== options[key].length || options[key].some(item => !allowed.includes(item))) {
      throw new Error(`Invalid ${key} list. Use --help.`);
    }
  }
  if (options.landingBaseUrl && !seen.has('--routes')) options.routes.push('landing');
  if (options.routes.includes('landing') && !options.landingBaseUrl) throw new Error('landing requires --landing-base-url.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(options.label)) throw new Error('label must be a simple name of at most 40 characters.');
  return options;
}

/** Never persist raw messages or request data; paths are the only URL detail. */
export function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '[non-http]';
    const path = url.pathname.split('/').map(segment => {
      if (segment === '[redacted]') return segment;
      if (segment.includes('%') || segment.length > 96 || /0x[a-f\d]{16,}/i.test(segment)
        || /[A-Za-z0-9_-]{40,}/.test(segment) || /@|:/.test(segment)) return '[redacted]';
      return segment.replace(/[^a-zA-Z0-9._~-]/g, '_');
    }).join('/');
    return `${url.origin}${path}`;
  } catch { return '[invalid-url]'; }
}

// This self-contained function runs before document scripts, in the MAIN frame.
export function installObservers() {
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const state = { supported, fcpMs: null, lcpMs: null, cls: null,
    longTasks: null, clsSession: { start: null, last: null, value: 0 } };
  const observers = [];
  const consume = (type, entries) => {
    for (const entry of entries) {
      if (type === 'paint' && entry.name === 'first-contentful-paint') state.fcpMs = entry.startTime;
      if (type === 'largest-contentful-paint') state.lcpMs = entry.startTime;
      if (type === 'layout-shift' && !entry.hadRecentInput) {
        const session = state.clsSession;
        if (session.start === null || entry.startTime - session.last >= 1000 || entry.startTime - session.start >= 5000) {
          session.start = entry.startTime;
          session.value = 0;
        }
        session.last = entry.startTime;
        session.value += entry.value;
        state.cls = Math.max(state.cls, session.value);
      }
      if (type === 'longtask') {
        state.longTasks.count++;
        state.longTasks.totalMs += entry.duration;
        state.longTasks.maxMs = Math.max(state.longTasks.maxMs, entry.duration);
      }
    }
  };
  for (const type of ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask']) {
    if (!supported.includes(type)) continue;
    try {
      const observer = new PerformanceObserver(list => consume(type, list.getEntries()));
      observer.observe({ type, buffered: true });
      if (type === 'layout-shift') state.cls = 0;
      if (type === 'longtask') state.longTasks = { count: 0, totalMs: 0, maxMs: 0 };
      observers.push({ observer, type });
    } catch { /* Unsupported observers retain null values. */ }
  }
  window.__fxAuditSnapshot = () => {
    for (const { observer, type } of observers) {
      consume(type, observer.takeRecords());
      observer.disconnect();
    }
    const nav = performance.getEntriesByType('navigation')[0];
    const duration = (end, start = 0) => end > 0 ? end - start : null;
    return { fcpMs: state.fcpMs, lcpMs: state.lcpMs, cls: state.cls, longTasks: state.longTasks,
      supportedEntryTypes: supported, cutoffMs: performance.now(),
      navigation: nav ? { ttfbMs: duration(nav.responseStart),
        domInteractiveMs: duration(nav.domInteractive), domContentLoadedMs: duration(nav.domContentLoadedEventEnd),
        domContentLoadedHandlerMs: duration(nav.domContentLoadedEventEnd, nav.domContentLoadedEventStart),
        loadMs: duration(nav.loadEventEnd), loadHandlerMs: duration(nav.loadEventEnd, nav.loadEventStart),
        domCompleteMs: duration(nav.domComplete) } : null };
  };
}

export function summarizeNetwork(records) {
  const entries = [...records.values()];
  const completed = entries.filter(entry => entry.completed);
  const scripts = completed.filter(entry => entry.type === 'Script' || /(?:java|ecma)script/i.test(entry.mime ?? ''));
  return { requestCount: entries.length, completedResourceCount: completed.length,
    failedResourceCount: entries.filter(entry => entry.failed).length,
    pendingResourceCount: entries.filter(entry => !entry.completed && !entry.failed).length,
    transferredBytes: completed.reduce((sum, entry) => sum + entry.bytes, 0),
    completedJsCount: scripts.length, transferredJsBytes: scripts.reduce((sum, entry) => sum + entry.bytes, 0),
    abortedNextPrefetchCount: entries.filter(entry => entry.failed && entry.nextPrefetch && entry.errorCode === 'net::ERR_ABORTED').length };
}

export function nextPrefetchEvidence(url, headers, origin, { method = 'GET', navigation = false } = {}) {
  try {
    if (new URL(url).origin !== origin || method !== 'GET' || navigation) return false;
    const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return normalized.rsc === '1' && ['1', '2', '3'].includes(normalized['next-router-prefetch']);
  } catch { return false; }
}

export function classifyRequestFailure(url, headers, origin, errorText, request = {}) {
  const code = errorText?.match(/^net::ERR_[A-Z0-9_]+$/)?.[0] ?? null;
  const nextPrefetch = nextPrefetchEvidence(url, headers, origin, request);
  return { kind: code === 'net::ERR_ABORTED' && nextPrefetch ? 'next-prefetch-aborted' : 'request-failed',
    url: sanitizeUrl(url), code, nextPrefetch,
    ...(nextPrefetch ? { evidence: 'same-origin-get-rsc-next-router-prefetch' } : {}) };
}

export function resourceBreakdown(records) {
  return [...records.values()].map(entry => ({ url: sanitizeUrl(entry.url), type: entry.type ?? 'Other',
    bytes: entry.completed ? entry.bytes : null,
    durationMs: entry.endedAt !== undefined ? Math.max(0, (entry.endedAt - entry.startedAt) * 1000) : null,
    startMs: entry.startMs ?? null, fromCache: entry.fromCache ?? null,
    contentEncoding: entry.contentEncoding ?? null, status: entry.status ?? null,
    state: entry.completed ? 'completed' : entry.failed ? 'failed' : 'pending',
    nextPrefetch: entry.nextPrefetch ?? false, initiatorType: entry.initiatorType ?? 'other',
    errorCode: entry.errorCode ?? null,
  })).sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
}

async function waitForPublicUi(page, route, expectedPath, timeout) {
  await page.waitForFunction(({ route, expectedPath }) => {
    const visible = element => {
      if (!element || element.closest('[inert], [aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const main = [...document.querySelectorAll('main')].find(visible);
    if (!main || main.innerText.trim().length < 20) return false;
    if (route === 'landing') return visible(document.querySelector('.hero h1'))
      && document.documentElement.dataset.js === 'true'
      && !!document.documentElement.dataset.motion
      && !!document.querySelector('.outcome-tabs')?.dataset.active;
    const workspace = document.querySelector('[data-route]');
    return workspace?.getAttribute('data-route')?.replace(/\/$/, '') === expectedPath.replace(/\/$/, '')
      && [...document.querySelectorAll('button')].some(button => visible(button) && !button.disabled
        && (button.getAttribute('aria-label') || button.innerText).trim() === 'Connect wallet');
  }, { route, expectedPath }, { timeout });
}

export async function captureViewportFrames(page, directory, prefix, timeout) {
  const started = Date.now();
  const deadline = started + timeout;
  const maxFrames = 24;
  const inventory = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return !element.closest('[hidden], [inert], [aria-hidden="true"]') && style.visibility !== 'hidden'
        && style.display !== 'none' && rect.width > 0 && rect.height > 0 && rect.bottom > 0
        && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const inner = [...document.body.querySelectorAll('*')].filter(element => visible(element)
      && (element.matches('main.app-content') || (/auto|scroll/.test(getComputedStyle(element).overflowY)
        && element.scrollHeight > element.clientHeight + 1)));
    // Keep element references only in this isolated page, never in JSON.
    window.__fxAuditScrollTargets = [root, ...inner.filter(element => element !== root)];
    const rows = window.__fxAuditScrollTargets.map((element, index) => {
      const isDocument = element === root;
      const rect = element.getBoundingClientRect();
      const clientHeight = isDocument ? innerHeight : element.clientHeight;
      return { id: `scroll-${index}`, kind: isDocument ? 'document' : element.matches('main.app-content') ? 'app-content' : 'inner-scroll',
        tag: element.tagName.toLowerCase(), scrollHeight: element.scrollHeight, clientHeight,
        initialScrollTop: element.scrollTop, maxScrollTop: Math.max(0, element.scrollHeight - clientHeight),
        viewportTop: isDocument ? 0 : Math.round(rect.top), viewportBottom: isDocument ? innerHeight : Math.round(rect.bottom) };
    });
    const scrollable = rows.filter(row => row.maxScrollTop > 1);
    const fallback = rows.find(row => row.kind === 'app-content') ?? rows[0];
    return rows.map(row => ({ ...row, captureRequired: scrollable.length ? row.maxScrollTop > 1 : row === fallback }));
  });
  const capture = { mode: 'ordered-viewport-frames', metricsAlreadyStopped: true, animations: 'disabled-for-capture',
    maxFrames, timeoutMs: timeout, scrollContainers: inventory, reachedBottom: false,
    complete: false, incompleteReasons: [], containers: [] };
  const screenshots = [];
  try {
    for (const target of inventory.filter(row => row.captureRequired)) {
      const increment = Math.max(1, Math.floor(target.clientHeight * 0.65));
      const positions = new Set([0, Math.round(target.maxScrollTop / 2), target.maxScrollTop]);
      // Overlapping frames fill gaps between top/middle/bottom without stitching.
      for (let top = increment; top < target.maxScrollTop && positions.size <= maxFrames; top += increment) positions.add(top);
      const planned = [...positions].sort((a, b) => a - b);
      const evidence = { id: target.id, reachedBottom: false, scrollCoverageComplete: false, frames: 0, finalMaxScrollTop: target.maxScrollTop };
      capture.containers.push(evidence);
      let coveredThrough = 0;
      let noGaps = true;
      for (const top of planned) {
        if (screenshots.length >= maxFrames || Date.now() >= deadline) { capture.incompleteReasons.push('frame-or-time-limit'); break; }
        const bottom = top === target.maxScrollTop;
        const frame = await page.evaluate(async ({ id, top, bottom }) => {
          const element = window.__fxAuditScrollTargets[Number(id.split('-')[1])];
          if (!element?.isConnected) return null;
          const isDocument = element === document.scrollingElement;
          const height = isDocument ? innerHeight : element.clientHeight;
          const maximum = Math.max(0, element.scrollHeight - height);
          element.scrollTo({ top: bottom ? maximum : top, behavior: 'instant' });
          await new Promise(done => setTimeout(done, 120));
          const rect = isDocument ? { top: 0, bottom: innerHeight } : element.getBoundingClientRect();
          const dock = document.querySelector('[data-fixed-navigation="true"]')?.getBoundingClientRect();
          return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: height,
            maxScrollTop: Math.max(0, element.scrollHeight - height),
            viewportTop: Math.round(rect.top), viewportBottom: Math.round(rect.bottom),
            fixedNavigationOverlapPx: dock ? Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, dock.top)) : 0,
            pendingImageCount: [...document.images].filter(image => !image.complete).length,
            remainingRevealMarkerCount: document.querySelectorAll('[data-reveal="waiting"]').length };
        }, { id: target.id, top, bottom });
        if (!frame) { capture.incompleteReasons.push('scroll-container-detached'); break; }
        const position = top === 0 ? 'top' : bottom ? 'bottom' : top === Math.round(target.maxScrollTop / 2) ? 'middle' : 'between';
        const file = `${prefix}-${target.id}-${String(evidence.frames + 1).padStart(2, '0')}-${position}.png`;
        const remaining = deadline - Date.now();
        if (remaining <= 0) { capture.incompleteReasons.push('frame-or-time-limit'); break; }
        await page.screenshot({ path: resolve(directory, file), fullPage: false, animations: 'disabled', timeout: remaining });
        const reachedBottom = frame.scrollTop >= frame.maxScrollTop - 1;
        screenshots.push({ file, containerId: target.id, position, ...frame, reachedBottom });
        evidence.frames++;
        noGaps &&= frame.scrollTop <= coveredThrough + 1;
        coveredThrough = Math.max(coveredThrough, frame.scrollTop + frame.clientHeight);
        evidence.reachedBottom ||= reachedBottom;
        evidence.finalMaxScrollTop = frame.maxScrollTop;
        evidence.scrollCoverageComplete = noGaps && evidence.reachedBottom && coveredThrough >= frame.scrollHeight - 1;
      }
      if (!evidence.scrollCoverageComplete) capture.incompleteReasons.push(`${target.id}-incomplete-scroll-coverage`);
      await page.evaluate(id => {
        const index = Number(id.split('-')[1]);
        window.__fxAuditScrollTargets[index]?.scrollTo({ top: 0, behavior: 'instant' });
      }, target.id);
    }
  } catch {
    capture.incompleteReasons.push('frame-capture-failed');
  } finally {
    await page.evaluate(rows => rows.forEach((row, index) => {
      window.__fxAuditScrollTargets[index]?.scrollTo({ top: row.initialScrollTop, behavior: 'instant' });
    }), inventory).catch(() => { capture.incompleteReasons.push('scroll-restore-failed'); });
  }
  capture.reachedBottom = capture.containers.length > 0 && capture.containers.every(row => row.reachedBottom);
  capture.complete = capture.containers.length > 0 && !capture.incompleteReasons.length
    && capture.containers.every(row => row.scrollCoverageComplete);
  capture.durationMs = Date.now() - started;
  return { screenshots, capture };
}

async function measureSample(browser, options, directory, route, viewportName, sampleNumber) {
  const target = new URL(route === 'landing' ? '' : route, route === 'landing' ? options.landingBaseUrl : options.baseUrl);
  const profile = VIEWPORTS[viewportName];
  const result = { route, viewport: viewportName, sample: sampleNumber, url: sanitizeUrl(target.href),
    startedAt: new Date().toISOString(), status: 'incomplete', httpStatus: null,
    readiness: { kind: route === 'landing' ? 'landing-script-markers' : 'route-and-disconnected-wallet-control', readyAtMs: null },
    metrics: null, network: null, resources: [], networkErrors: [], consoleErrors: [], pageErrors: [],
    overflow: null, screenshots: [], capture: null, failures: [] };
  const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
    isMobile: profile.isMobile, hasTouch: profile.hasTouch, deviceScaleFactor: 1,
    colorScheme: route === 'landing' ? 'light' : 'dark', reducedMotion: 'no-preference',
    locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', acceptDownloads: false });
  let page;
  let phase = 'setup';
  let recording = true;
  const records = new Map();
  let navigationTimestamp;
  const cap = 100;
  const append = (list, value) => { if (list.length < cap) list.push(value); };
  try {
    await context.addInitScript(installObservers);
    await context.route('**/*', async intercepted => {
      const request = intercepted.request();
      if (request.isNavigationRequest() && new URL(request.url()).origin !== target.origin) {
        if (recording) {
          append(result.networkErrors, { kind: 'blocked-external-document', url: sanitizeUrl(request.url()) });
          if (!result.failures.includes('external-document-blocked')) result.failures.push('external-document-blocked');
        }
        await intercepted.abort('blockedbyclient');
      } else await intercepted.continue();
    });
    page = await context.newPage();
    context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    page.on('console', message => {
      if (recording && message.type() === 'error') append(result.consoleErrors, {
        kind: /hydrat|server rendered/i.test(message.text()) ? 'hydration' : 'console-error',
        url: sanitizeUrl(message.location().url), line: message.location().lineNumber ?? null,
      });
    });
    page.on('pageerror', error => {
      if (recording) append(result.pageErrors, { kind: /hydrat|server rendered/i.test(error.message) ? 'hydration' : 'uncaught-exception' });
    });
    page.on('requestfailed', request => {
      if (recording) append(result.networkErrors, classifyRequestFailure(request.url(), request.headers(), target.origin,
        request.failure()?.errorText, { method: request.method(), navigation: request.isNavigationRequest() }));
    });
    page.on('response', response => {
      if (recording && response.status() >= 400) append(result.networkErrors, {
        kind: 'http', status: response.status(), url: sanitizeUrl(response.url()) });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    cdp.on('Network.requestWillBeSent', event => {
      if (!recording) return;
      navigationTimestamp ??= event.timestamp;
      if (event.redirectResponse) {
        // CDP reuses requestId for redirects; preserve each completed hop.
        const old = records.get(event.requestId);
        if (old) records.set(`${event.requestId}:redirect:${records.size}`, {
          ...old, completed: true, bytes: event.redirectResponse.encodedDataLength ?? 0, endedAt: event.timestamp,
        });
      }
      records.set(event.requestId, { url: sanitizeUrl(event.request.url), type: event.type, completed: false, failed: false, bytes: 0,
        startedAt: event.timestamp, startMs: (event.timestamp - navigationTimestamp) * 1000,
        nextPrefetch: nextPrefetchEvidence(event.request.url, event.request.headers, target.origin,
          { method: event.request.method, navigation: event.type === 'Document' }),
        initiatorType: ['parser', 'script', 'preload', 'preflight'].includes(event.initiator?.type) ? event.initiator.type : 'other' });
    });
    cdp.on('Network.requestServedFromCache', event => {
      if (recording && records.has(event.requestId)) records.get(event.requestId).fromCache = true;
    });
    cdp.on('Network.responseReceived', event => {
      if (!recording || !records.has(event.requestId)) return;
      const entry = records.get(event.requestId);
      const encoding = Object.entries(event.response.headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1]?.toLowerCase();
      Object.assign(entry, { type: event.type, mime: event.response.mimeType, status: event.response.status,
        fromCache: Boolean(entry.fromCache || event.response.fromDiskCache || event.response.fromPrefetchCache || event.response.fromServiceWorker),
        contentEncoding: !encoding ? 'identity' : ['gzip', 'br', 'deflate', 'zstd', 'identity'].includes(encoding) ? encoding : 'other' });
    });
    cdp.on('Network.loadingFinished', event => {
      if (recording && records.has(event.requestId)) Object.assign(records.get(event.requestId), { completed: true, bytes: event.encodedDataLength, endedAt: event.timestamp });
    });
    cdp.on('Network.loadingFailed', event => {
      if (recording && records.has(event.requestId)) Object.assign(records.get(event.requestId), { failed: true, endedAt: event.timestamp,
        errorCode: event.errorText?.match(/^net::ERR_[A-Z0-9_]+$/)?.[0] ?? null });
    });
    phase = 'navigation';
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    result.httpStatus = response?.status() ?? null;
    if (!response?.ok()) result.failures.push('navigation-http');
    phase = 'readiness';
    await waitForPublicUi(page, route, target.pathname, options.timeoutMs);
    result.readiness.readyAtMs = await page.evaluate(() => performance.now());
    result.readiness.fontsReady = await page.evaluate(async () => {
      let timer;
      try { return await Promise.race([document.fonts.ready.then(() => true), new Promise(done => { timer = setTimeout(() => done(false), 2000); })]); }
      finally { clearTimeout(timer); }
    });
    result.readiness.windowStartedAtMs = await page.evaluate(() => performance.now());
    phase = 'measurement';
    await page.waitForTimeout(options.windowMs);
    if (new URL(page.url()).origin !== target.origin || new URL(page.url()).pathname.replace(/\/$/, '') !== target.pathname.replace(/\/$/, '')) {
      result.failures.push('unexpected-final-route');
    }
    result.finalUrl = sanitizeUrl(page.url());
    result.metrics = await page.evaluate(() => window.__fxAuditSnapshot());
    recording = false;
    result.network = summarizeNetwork(records);
    result.resources = resourceBreakdown(records);
    result.overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const bodyWidth = document.body.scrollWidth;
      const documentWidth = document.documentElement.scrollWidth;
      const elements = [...document.body.querySelectorAll('*')].flatMap(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (!rect.width || !rect.height || style.visibility === 'hidden' || (rect.left >= -1 && rect.right <= width + 1)) return [];
        // Tags and geometry only: IDs/classes/text may contain account data.
        return [{ tag: element.tagName.toLowerCase(), left: Math.round(rect.left), right: Math.round(rect.right) }];
      });
      return { viewportWidth: width, documentWidth, bodyWidth, horizontalOverflowPx: Math.max(0, documentWidth - width, bodyWidth - width),
        outsideElementCount: elements.length, outsideElements: elements.slice(0, 20) };
    });
    phase = 'screenshot';
    Object.assign(result, await captureViewportFrames(page, directory, `${route}-${viewportName}-${sampleNumber}`, options.timeoutMs));
    if (!result.capture.complete) result.failures.push('capture-incomplete');
    result.status = result.failures.length ? 'incomplete' : 'complete';
  } catch (error) {
    // Do not serialize Playwright errors: call logs can include full request URLs.
    result.failures.push(`${phase}-${error?.name === 'TimeoutError' ? 'timeout' : 'failed'}`);
    recording = false;
    // Failed readiness still needs reviewable visual evidence when a document exists.
    if (page && !page.isClosed() && new URL(page.url()).origin === target.origin) {
      try {
        result.metrics ??= await page.evaluate(() => window.__fxAuditSnapshot?.() ?? null);
        result.finalUrl = sanitizeUrl(page.url());
        if (!result.screenshots.length) Object.assign(result, await captureViewportFrames(page, directory,
          `${route}-${viewportName}-${sampleNumber}-incomplete`, options.timeoutMs));
      } catch { result.failures.push('diagnostic-capture-failed'); }
    }
  } finally {
    recording = false;
    result.network ??= summarizeNetwork(records);
    if (!result.resources.length) result.resources = resourceBreakdown(records);
    result.finishedAt = new Date().toISOString();
    await context.close();
  }
  return result;
}

export async function runAudit(options) {
  const startedAt = new Date().toISOString();
  const runName = `${options.label}-${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const outputRoot = resolve(ROOT, 'output/audit-production-browser');
  await mkdir(outputRoot, { recursive: true });
  const directory = resolve(outputRoot, runName);
  await mkdir(directory); // Never overwrite before/after evidence.
  const require = createRequire(resolve(ROOT, 'apps/mini-app/package.json'));
  const { chromium } = require('@playwright/test');
  const channel = configuredBrowserChannel();
  const report = { schemaVersion: 2, measurement: 'public-disconnected-browser-lab', startedAt,
    configuration: { ...options, baseUrl: sanitizeUrl(options.baseUrl),
      landingBaseUrl: options.landingBaseUrl ? sanitizeUrl(options.landingBaseUrl) : null,
      viewportProfiles: VIEWPORTS, locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1,
      reducedMotion: 'no-preference', colorScheme: 'dark app / light landing',
      coldContextPerSample: true, cacheDisabled: true, serviceWorkers: 'block',
      networkThrottling: 'none', cpuThrottling: 'none', errorListCap: 100 },
    runtime: { node: process.version, platform: process.platform, arch: process.arch,
      availableCpuCount: availableParallelism(), totalMemoryBytes: totalmem(),
      playwright: require('@playwright/test/package.json').version, channel: channel ?? 'bundled-chromium' },
    limitations: [
      'Lab navigation metrics only; no field INP, interaction, wallet, transaction or chain-latency measurement.',
      'Readiness markers are UI proxies, not exhaustive hydration proof; no data fixtures or network-idle assumption.',
      'LCP/CLS/longtasks/resources stop at cutoff before scroll/capture; LCP is provisional. Capture can trigger lazy resources outside metrics.',
      'Fresh contexts/cache disabled; browser/DNS/TLS/OS/server/CDN caches may remain warm. No CPU/network throttling.',
      'CDP completed encoded bytes include headers; failed/pending bytes excluded. Identity local HTTP bytes are not compressed CDN bytes; workers may be omitted.',
      'Console text/payloads excluded; error lists capped at 100 each. Sanitized origin/path only. Screenshots contain public UI.',
      'Capture uses viewport frames of visible scroll containers (24 frames / timeout bound), without CSS expansion or masks; animations disabled.',
      'Capture completeness is geometric scroll coverage, not proof every pixel/data/chart loaded or free of fixed-dock occlusion; inspect frames/overlap evidence.',
      'All request failures retained. Only aborted same-origin GET RSC requests explicitly marked by Next are separately categorized; no claim these are harmless.',
      'Playwright/CDP observers and document-navigation interception add overhead; mobile/tablet are viewport/touch emulation, not real devices.',
    ], samples: [] };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    report.runtime.browserVersion = browser.version();
    for (const route of options.routes) for (const viewport of options.viewports) for (let sample = 1; sample <= options.samples; sample++) {
      const result = await measureSample(browser, options, directory, route, viewport, sample);
      report.samples.push(result);
      console.log(`${result.status}: ${route} ${viewport} sample ${sample}`);
      // Incremental report keeps already completed samples if interrupted later.
      await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
  } catch {
    report.failure = 'browser-or-audit-setup-failed; check existing Playwright/browser installation';
  } finally {
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    report.complete = !report.failure && report.samples.length === options.routes.length * options.viewports.length * options.samples
      && report.samples.every(sample => sample.status === 'complete');
    await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  return { report, directory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options;
  try { options = parseOptions(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
  if (options?.help) console.log(HELP);
  else if (options) {
    try {
      const { report, directory } = await runAudit(options);
      console.log(`LAB audit saved: ${resolve(directory, 'report.json')}`);
      if (!report.complete) process.exitCode = 1;
    } catch { console.error('Audit setup/output failed. Check existing dependencies and output permissions.'); process.exitCode = 1; }
  }
}
