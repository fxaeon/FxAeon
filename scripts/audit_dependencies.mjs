import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Temporary, version-bound mitigations for upstream findings with reviewed local backports.
// See docs/security.md for rationale, scope, and re-review dates.
// Do not suppress the registry finding unless every affected consumer resolves
// to the reviewed backport and its public APIs pass the attack regressions.
const root = resolve(import.meta.dirname, '..');
assert.ok(Date.now() < Date.parse('2026-11-07T00:00:00Z'), 'Re-review the temporary Zod backport');
assert.ok(!/ignoreGhsas|ignoreCves/.test(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')), 'Do not persist global audit exceptions');
await import('./verify_zod_security_backport.mjs');
await import('./verify_minimatch_security.mjs');
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
  const zodMitigated = advisory.github_advisory_id === 'GHSA-mrhx-c7xc-m3w5'
    && advisory.module_name === 'zod'
    && advisory.severity === 'high'
    && advisory.findings?.length > 0
    && advisory.findings.every((finding) => ['3.25.76', '4.6.7'].includes(finding.version));
  const verified = zodMitigated;
  console.log(`[audit] ${verified ? 'Verified local mitigation' : advisory.severity}: ${advisory.github_advisory_id} ${advisory.module_name} — ${advisory.title}`);
  if (!verified && !['info', 'low', 'moderate'].includes(advisory.severity)) failed = true;
}
process.exit(failed ? 1 : 0);
