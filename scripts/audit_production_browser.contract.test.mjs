import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseOptions, sanitizeUrl, installObservers, summarizeNetwork, resourceBreakdown,
  classifyRequestFailure, runAudit, ROUTES, VIEWPORTS } from './audit_production_browser.mjs';

test('loopback default, required route/viewport matrix and separate landing base', () => {
  const defaults = parseOptions([]);
  assert.equal(defaults.baseUrl, 'http://127.0.0.1:4321/');
  assert.deepEqual(defaults.routes, ROUTES);
  assert.deepEqual(defaults.viewports, ['phone390844', 'tablet7681024', 'desktop1440900']);
  assert.deepEqual(Object.values(VIEWPORTS).map(({ width, height }) => [width, height]), [[390, 844], [768, 1024], [1440, 900]]);
  const landing = parseOptions(['--landing-base-url', 'http://127.0.0.1:4355', '--routes', 'landing']);
  assert.deepEqual(landing.routes, ['landing']);
  assert.equal(landing.landingBaseUrl, 'http://127.0.0.1:4355/');
  assert.ok(parseOptions(['--landing-base-url', 'http://127.0.0.1:4355']).routes.includes('landing'));
  assert.equal(new URL('trade', parseOptions(['--base-url', 'https://example.test/app']).baseUrl).pathname, '/app/trade');
});

test('invalid/ambiguous options cannot silently audit another target or write outside output', () => {
  for (const args of [
    ['--base-url', 'https://user:password@example.test/'], ['--base-url', 'https://example.test/?secret=value'],
    ['--base-url', 'https://example.test/#secret'], ['--base-url', 'file:///tmp/'],
    ['--base-url', 'not-a-url'], ['--base-url', 'https://example.test/%61pp/'],
    ['--routes', 'landing'], ['--routes', 'trade,trade'], ['--routes', '../settings'],
    ['--routes', 'trade,'], ['--viewports', 'phone'], ['--label', '../../outside'],
    ['--samples', '0'], ['--samples', '1.5'], ['--samples', '21'], ['--window-ms', '99'],
    ['--timeout-ms', '60001'], ['--samples'], ['--unknown', 'value'], ['--samples', '1', '--samples', '2'],
  ]) assert.throws(() => parseOptions(args), Error, JSON.stringify(args));
  assert.deepEqual(parseOptions(['--help']), { help: true });
});

test('URL records omit credentials, query, fragments, opaque data and account-like path segments', () => {
  assert.equal(sanitizeUrl('https://user:pass@example.test:8443/assets/chunk-a1.js?key=private#token'), 'https://example.test:8443/assets/chunk-a1.js');
  assert.equal(sanitizeUrl('https://example.test/rpc/0x' + 'a'.repeat(40) + '?account=private'), 'https://example.test/rpc/[redacted]');
  assert.equal(sanitizeUrl('https://example.test/api/' + 's'.repeat(48)), 'https://example.test/api/[redacted]');
  assert.equal(sanitizeUrl('https://example.test/users/person%40example.test'), 'https://example.test/users/[redacted]');
  assert.equal(sanitizeUrl('data:text/plain,private'), '[non-http]');
  assert.equal(sanitizeUrl('private text'), '[invalid-url]');
});

function observerFixture(supported = ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask']) {
  const registered = new Map();
  class Observer {
    static supportedEntryTypes = supported;
    constructor(callback) { this.callback = callback; this.queued = []; }
    observe({ type, buffered }) { assert.equal(buffered, true); registered.set(type, this); }
    takeRecords() { return this.queued.splice(0); }
    disconnect() { this.disconnected = true; }
  }
  const window = {};
  runInNewContext(`(${installObservers.toString()})()`, {
    window, PerformanceObserver: Observer,
    performance: { now: () => 7000, getEntriesByType: () => [{ responseStart: 10,
      domInteractive: 20, domContentLoadedEventStart: 25, domContentLoadedEventEnd: 30,
      domComplete: 0, loadEventStart: 0, loadEventEnd: 0 }] },
  });
  return { registered, snapshot: () => JSON.parse(JSON.stringify(window.__fxAuditSnapshot())),
    emit(type, entries) { registered.get(type).callback({ getEntries: () => entries }); } };
}

test('CLS uses maximum 1s-gap/5s session and excludes recent input, not lifetime sum', () => {
  const fixture = observerFixture();
  const shifts = [[100, 0.1], [500, 0.2], [1600, 0.25], [2000, 8, true], [2400, 0.01]];
  fixture.emit('layout-shift', shifts.map(([startTime, value, hadRecentInput = false]) => ({ startTime, value, hadRecentInput })));
  assert.ok(Math.abs(fixture.snapshot().cls - 0.3) < 1e-9);
  const longSession = observerFixture();
  longSession.emit('layout-shift', Array.from({ length: 8 }, (_, index) => ({ startTime: index * 800, value: 0.1 })));
  assert.ok(Math.abs(longSession.snapshot().cls - 0.7) < 1e-9, 'a continuous session expires at 5 seconds');
});

test('buffered pending entries flush at cutoff; longtasks and navigation durations have honest nulls', () => {
  const fixture = observerFixture();
  fixture.emit('paint', [{ name: 'first-paint', startTime: 8 }, { name: 'first-contentful-paint', startTime: 12 }]);
  fixture.emit('largest-contentful-paint', [{ startTime: 30 }]);
  fixture.registered.get('largest-contentful-paint').queued.push({ startTime: 60 });
  fixture.emit('longtask', [{ duration: 70 }, { duration: 90 }]);
  const snapshot = fixture.snapshot();
  assert.equal(snapshot.fcpMs, 12);
  assert.equal(snapshot.lcpMs, 60);
  assert.deepEqual(snapshot.longTasks, { count: 2, totalMs: 160, maxMs: 90 });
  assert.equal(snapshot.navigation.domContentLoadedMs, 30);
  assert.equal(snapshot.navigation.domContentLoadedHandlerMs, 5);
  assert.equal(snapshot.navigation.loadMs, null);
  assert.equal(snapshot.cutoffMs, 7000);
  assert.ok([...fixture.registered.values()].every(observer => observer.disconnected));
  const missing = observerFixture([]).snapshot();
  for (const key of ['fcpMs', 'lcpMs', 'cls', 'longTasks']) assert.equal(missing[key], null);
});

test('network totals count completed bytes only, JS MIME/modules, failures and unfinished streams', () => {
  const records = new Map([
    ['document', { type: 'Document', completed: true, bytes: 100 }],
    ['script', { type: 'Script', completed: true, bytes: 200 }],
    ['module', { type: 'Other', mime: 'text/javascript', completed: true, bytes: 300 }],
    ['failed', { type: 'Script', failed: true, bytes: 999 }],
    ['stream', { type: 'Fetch', bytes: 999 }],
  ]);
  assert.deepEqual(summarizeNetwork(records), { requestCount: 5, completedResourceCount: 3,
    failedResourceCount: 1, pendingResourceCount: 1, transferredBytes: 600,
    completedJsCount: 2, transferredJsBytes: 500, abortedNextPrefetchCount: 0 });
});

test('resource rows retain only sanitized metadata with honest duration/cache/encoded bytes', () => {
  const records = new Map([
    ['script', { url: 'https://user:pass@example.test/chunk.js?private=value', type: 'Script', completed: true,
      bytes: 456, startedAt: 10, endedAt: 10.25, startMs: 100, fromCache: false, contentEncoding: 'identity',
      status: 200, initiatorType: 'parser', headers: { authorization: 'never-serialize' }, initiator: { stack: 'never-serialize' } }],
    ['pending', { url: 'https://example.test/stream?private=value', type: 'Fetch', startedAt: 10 }],
  ]);
  const rows = resourceBreakdown(records);
  assert.deepEqual(rows[0], { url: 'https://example.test/chunk.js', type: 'Script', bytes: 456, durationMs: 250,
    startMs: 100, fromCache: false, contentEncoding: 'identity', status: 200, state: 'completed', nextPrefetch: false,
    initiatorType: 'parser', errorCode: null });
  assert.equal(rows[1].bytes, null);
  assert.equal(rows[1].durationMs, null);
  assert.equal(rows[1].fromCache, null);
  assert.equal(JSON.stringify(rows).includes('never-serialize'), false);
  assert.equal(JSON.stringify(rows).includes('private'), false);
});

test('prefetch abort category requires same-origin GET, RSC and explicit Next header; genuine failures stay', () => {
  const origin = 'https://example.test';
  const headers = { RSC: '1', 'Next-Router-Prefetch': '1', authorization: 'never-serialize' };
  const abort = (url = `${origin}/trade?private=value`, supplied = headers, error = 'net::ERR_ABORTED', request) =>
    classifyRequestFailure(url, supplied, origin, error, request);
  const tagged = abort();
  assert.equal(tagged.kind, 'next-prefetch-aborted');
  assert.equal(tagged.url, `${origin}/trade`);
  for (const genuine of [abort('https://other.test/trade'), abort(undefined, { Purpose: 'prefetch' }),
    abort(undefined, { RSC: '1' }), abort(undefined, headers, 'net::ERR_FAILED'),
    abort(undefined, headers, 'net::ERR_ABORTED', { method: 'POST' }),
    abort(undefined, headers, 'net::ERR_ABORTED', { navigation: true })]) assert.equal(genuine.kind, 'request-failed');
  assert.equal(JSON.stringify(tagged).includes('never-serialize'), false);
  const summary = summarizeNetwork(new Map([['prefetch', { failed: true, nextPrefetch: true, errorCode: 'net::ERR_ABORTED' }],
    ['genuine', { failed: true, nextPrefetch: true, errorCode: 'net::ERR_FAILED' }]]));
  assert.equal(summary.failedResourceCount, 2);
  assert.equal(summary.abortedNextPrefetchCount, 1);
});

// Opt-in integration contract uses existing Playwright/browser only. No app build:
// PowerShell: $env:FX_AUDIT_BROWSER_SMOKE='1'; node --test scripts/audit_production_browser.contract.test.mjs
test('browser contract: cold contexts, resource evidence, inner-scroll frames and failed-readiness captures', {
  skip: process.env.FX_AUDIT_BROWSER_SMOKE !== '1', timeout: 120000,
}, async t => {
  const requested = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://fixture.test').pathname;
    requested.push(pathname);
    if (['/prefetch-stall', '/genuine-stall'].includes(pathname)) return;
    if (pathname === '/missing') { response.writeHead(404); response.end('Not found'); return; }
    if (pathname === '/audit-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(`
        fetch(localStorage.getItem('audit-fixture') ? '/storage-dirty' : '/storage-clean');
        localStorage.setItem('audit-fixture', 'present');
        console.error('contract-private-marker https://fixture.test/?private=contract-private-marker');
        fetch('/missing?private=contract-private-marker');
        for (const name of ['prefetch', 'genuine']) {
          const controller = new AbortController();
          fetch('/' + name + '-stall?private=contract-private-marker', { signal: controller.signal,
            headers: name === 'prefetch' ? {RSC:'1', 'Next-Router-Prefetch':'1'} : {} }).catch(() => {});
          setTimeout(() => controller.abort(), 100);
        }
        const main = document.querySelector('main');
        main.addEventListener('scroll', () => { if (main.scrollTop >= main.scrollHeight - main.clientHeight - 1) fetch('/capture-bottom'); });
        setTimeout(() => { document.querySelector('button').disabled = false; }, 80);
        setTimeout(() => { throw new Error('contract-private-marker'); }, 100);
      `);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;overflow:hidden}main{height:calc(100vh - 64px);overflow-y:auto}.spacer{height:1200px}nav{position:fixed;bottom:0;height:64px;background:#ccc;width:100%}</style></head><body><main class="app-content"><h1>Public disconnected contract fixture</h1>
      <div data-route="${pathname}">This fixture has no wallet or transaction provider.</div>
      <button ${pathname === '/more' ? 'disabled' : 'disabled onclick="fetch(\'/unsafe-click\')"'}>Connect wallet</button>
      ${pathname === '/trade' ? '<div class="spacer"></div><h2>Lower section</h2><svg width="200" height="100" role="img"><path d="M0 80 L200 20" stroke="black" /></svg>' : ''}
      </main><nav data-fixed-navigation="true">Fixture dock</nav>${pathname === '/trade' ? '<script src="/audit-fixture.js?private=contract-private-marker"></script>' : ''}</body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const { report, directory } = await runAudit(parseOptions([
    '--base-url', `http://127.0.0.1:${server.address().port}`, '--routes', 'trade,more',
    '--viewports', 'phone390844', '--samples', '2', '--window-ms', '300', '--timeout-ms', '10000', '--label', 'contract',
  ]));
  assert.equal(report.samples.length, 4, JSON.stringify(report));
  const good = report.samples.filter(sample => sample.route === 'trade');
  const incomplete = report.samples.filter(sample => sample.route === 'more');
  for (const sample of good) {
    assert.equal(sample.status, 'complete', JSON.stringify(sample));
    assert.ok(sample.readiness.readyAtMs > 0);
    assert.ok(sample.metrics.fcpMs > 0);
    assert.ok(sample.network.transferredJsBytes > 0);
    assert.ok(sample.networkErrors.some(error => error.kind === 'http' && error.url.endsWith('/missing')));
    assert.ok(sample.networkErrors.some(error => error.kind === 'next-prefetch-aborted'));
    assert.ok(sample.networkErrors.some(error => error.kind === 'request-failed' && error.url.endsWith('/genuine-stall')));
    assert.equal(sample.network.abortedNextPrefetchCount, 1);
    const script = sample.resources.find(row => row.url.endsWith('/audit-fixture.js'));
    assert.ok(script.bytes > 0 && script.durationMs >= 0);
    assert.equal(script.fromCache, false);
    assert.equal(script.contentEncoding, 'identity');
    assert.ok(sample.consoleErrors.length > 0);
    assert.ok(sample.pageErrors.length > 0);
    assert.equal(sample.capture.mode, 'ordered-viewport-frames');
    assert.equal(sample.capture.complete, true);
    assert.equal(sample.capture.reachedBottom, true);
    assert.ok(sample.capture.scrollContainers.some(row => row.kind === 'document' && !row.captureRequired));
    const main = sample.capture.scrollContainers.find(row => row.kind === 'app-content');
    assert.ok(main.captureRequired && main.maxScrollTop > 0);
    assert.ok(sample.screenshots.some(frame => frame.position === 'middle'));
    const bottom = sample.screenshots.find(frame => frame.position === 'bottom');
    assert.equal(bottom.containerId, main.id);
    assert.equal(bottom.reachedBottom, true);
    assert.ok(bottom.scrollTop > 0);
    const first = await readFile(resolve(directory, sample.screenshots[0].file));
    assert.equal(first.readUInt32BE(16), 390);
    assert.equal(first.readUInt32BE(20), 844, 'frames are actual viewport PNGs, not expanded fullPage captures');
    assert.ok((await stat(resolve(directory, bottom.file))).size > 0);
  }
  for (const sample of incomplete) {
    assert.equal(sample.status, 'incomplete');
    assert.ok(sample.failures.includes('readiness-timeout'));
    assert.ok(sample.screenshots[0].file.includes('-incomplete-'));
  }
  assert.equal(report.complete, false);
  assert.equal(requested.filter(path => path === '/storage-clean').length, 2);
  assert.equal(requested.includes('/storage-dirty'), false);
  assert.equal(requested.includes('/unsafe-click'), false);
  assert.equal(requested.includes('/capture-bottom'), true, 'the actual inner main was scrolled to its end');
  const saved = await readFile(resolve(directory, 'report.json'), 'utf8');
  assert.equal(saved.includes('contract-private-marker'), false);
  assert.equal(saved.includes('?private='), false);
});
