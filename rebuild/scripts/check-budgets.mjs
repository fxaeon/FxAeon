import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
function critical(entry) {
  const visited = new Set(); const assets = new Set();
  function visit(key) {
    if (visited.has(key)) return; visited.add(key);
    const item = manifest[key]; assert.ok(item, `Missing build graph node ${key}`);
    if (item.file) assets.add(item.file);
    for (const css of item.css ?? []) assets.add(css);
    for (const imported of item.imports ?? []) visit(imported);
  }
  visit(entry); return [...assets];
}
const compressed = files => files.reduce((sum, file) => sum + gzipSync(readFileSync(resolve(dist, file)), { level: 9 }).byteLength, 0);
const app = critical('app/index.html'); const landing = critical('index.html');
const allJs = readdirSync(resolve(dist, 'assets')).filter(file => file.endsWith('.js')).map(file => `assets/${file}`);
const checks = [
  { name: 'Critical app JavaScript', bytes: compressed(app.filter(file => file.endsWith('.js'))), limit: 180 * 1024 },
  { name: 'Critical app CSS', bytes: compressed(app.filter(file => file.endsWith('.css'))), limit: 25 * 1024 },
  { name: 'Landing JavaScript', bytes: compressed(landing.filter(file => file.endsWith('.js'))), limit: 40 * 1024 },
  { name: 'All lazy JavaScript combined', bytes: compressed(allJs), limit: 1.5 * 1024 * 1024 }
];
mkdirSync(resolve(root, 'test-results'), { recursive: true });
writeFileSync(resolve(root, 'test-results/build-budgets.json'), JSON.stringify({ generatedAt: new Date().toISOString(), method: 'gzip level9 over Vite manifest static imports; dynamic SDK excluded only from initial critical graph', appAssets: app, landingAssets: landing, checks }, null, 2) + '\n');
for (const check of checks) {
  process.stdout.write(`${check.name}: ${(check.bytes / 1024).toFixed(2)} KiB / ${(check.limit / 1024).toFixed(0)} KiB gzip\n`);
  assert.ok(check.bytes <= check.limit, `${check.name} budget exceeded`);
}
