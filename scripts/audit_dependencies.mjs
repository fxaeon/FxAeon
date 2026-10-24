import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Temporary, version-bound mitigations for upstream findings with reviewed local backports.
// See docs/security.md for rationale, scope, and re-review dates.
// Do not suppress the registry finding unless every affected consumer resolves
// to the reviewed backport and its public APIs pass the attack regressions.
assert.ok(Date.now() < Date.parse('2026-11-03T00:00:00Z'), 'Re-review the temporary braces backport');
const root = resolve(import.meta.dirname, '..');
assert.ok(Date.now() < Date.parse('2026-11-07T00:00:00Z'), 'Re-review the temporary Zod backport');
assert.ok(!/ignoreGhsas|ignoreCves/.test(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')), 'Do not persist global audit exceptions');
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const versions = [...lock.matchAll(/^  braces@([^:]+):$/gm)].map((match) => match[1].split('(')[0]);
assert.ok(versions.length > 0 && versions.every((version) => version === '3.0.3'), 'Re-review braces versions before applying the advisory exception');
const hashes = {
  compile: 'b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195',
  constants: 'f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c',
  expand: '2974d5b8763a358d81dfa5b4b804329f525239f34429c396b93a540219504809',
  parse: 'ef9b3851f848460daaf91ff248222a43e266f97c4f2df7010cb7858e1e39a107',
  stringify: '645f13c68af685148e9fe8eca449ee2ebb88eee0f27de7b2125fbfc175b1584d',
};
const consumers = [
  ['package.json', '@next/eslint-plugin-next', 'fast-glob', 'micromatch', 'braces'],
  ['apps/mini-app/package.json', 'tailwindcss', 'fast-glob', 'micromatch', 'braces'],
  ['apps/mini-app/package.json', 'tailwindcss', 'micromatch', 'braces'],
  ['apps/mini-app/package.json', 'tailwindcss', 'chokidar', 'braces'],
];
const checked = new Set();
for (const [manifest, ...chain] of consumers) {
  let req = createRequire(resolve(root, manifest));
  for (const dependency of chain) req = createRequire(req.resolve(dependency));
  const packageRoot = dirname(req.resolve('./package.json'));
  assert.equal(req('./package.json').version, '3.0.3');
  if (checked.has(packageRoot)) continue;
  checked.add(packageRoot);
  for (const [file, expected] of Object.entries(hashes)) {
    const source = readFileSync(resolve(packageRoot, 'lib', `${file}.js`), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(source).digest('hex'), expected, `Unverified braces ${file}`);
  }
  const braces = req('./index.js');
  const ast = (depth) => {
    let node = { type: 'text', value: 'a' };
    for (let i = 0; i < depth; i++) node = { type: 'brace', nodes: [node] };
    return { type: 'root', nodes: [node] };
  };
  for (const depth of [101, 4000]) {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const input = open.repeat(depth) + 'a,b' + close.repeat(depth);
      for (const operation of [braces, braces.parse, braces.compile, braces.expand]) {
        assert.throws(() => operation(input), /exceeds max depth/);
        assert.throws(() => operation(input, { maxDepth: Infinity }), /exceeds max depth/);
        assert.throws(() => operation(input, { maxDepth: 100000 }), /exceeds max depth/);
      }
    }
    for (const operation of [braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => operation(ast(depth)), /exceeds max depth/);
    }
  }
  assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'a,b' + '}'.repeat(100)));
  assert.doesNotThrow(() => braces.stringify(ast(100)));
  assert.throws(() => braces.parse('{{a,b},c}', { maxDepth: 1 }), /exceeds max depth/);
  assert.deepEqual(braces.expand('src/{app,lib}/file.{ts,tsx}'), ['src/app/file.ts', 'src/app/file.tsx', 'src/lib/file.ts', 'src/lib/file.tsx']);
}
console.log('[audit] Verified braces@3.0.3 depth-limit backport for all four dependency paths. GHSA-vfj7-8cjw-p6xm is patched locally; npm still reports its original version.');
await import('./verify_zod_security_backport.mjs');
assert.ok(process.env.npm_execpath, 'Run this gate through pnpm run audit:all');
// --ignore writes a persistent workspace exception in pnpm 11. Read the raw
// report instead, so running this gate never changes normal pnpm audit behavior.
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);
assert.ok(result.status === 0 || result.status === 1, 'Registry audit did not complete');
const report = JSON.parse(result.stdout);
assert.ok(!report.error && report.metadata?.vulnerabilities && report.advisories && typeof report.advisories === 'object', 'Unrecognized or failed registry audit response');
const advisories = Object.values(report.advisories);
assert.ok(result.status === 0 || advisories.length > 0, 'Audit failed without an advisory report');
let failed = false;
for (const advisory of advisories) {
  const mitigated = advisory.github_advisory_id === 'GHSA-vfj7-8cjw-p6xm'
    && advisory.module_name === 'braces'
    && advisory.findings?.length > 0
    && advisory.findings.every((finding) => finding.version === '3.0.3');
  const zodMitigated = advisory.github_advisory_id === 'GHSA-mrhx-c7xc-m3w5'
    && advisory.module_name === 'zod'
    && advisory.severity === 'high'
    && advisory.findings?.length > 0
    && advisory.findings.every((finding) => ['3.25.76', '4.6.7'].includes(finding.version));
  const verified = mitigated || zodMitigated;
  console.log(`[audit] ${verified ? 'Verified local mitigation' : advisory.severity}: ${advisory.github_advisory_id} ${advisory.module_name} — ${advisory.title}`);
  if (!verified && !['info', 'low', 'moderate'].includes(advisory.severity)) failed = true;
}
process.exit(failed ? 1 : 0);
