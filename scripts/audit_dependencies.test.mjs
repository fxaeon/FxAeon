import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const known = {
  github_advisory_id: 'GHSA-vfj7-8cjw-p6xm', module_name: 'braces',
  severity: 'high', findings: [{ version: '3.0.3' }], title: 'Depth exhaustion',
};
const zod = {
  github_advisory_id: 'GHSA-mrhx-c7xc-m3w5', module_name: 'zod',
  severity: 'high', findings: [{ version: '3.25.76' }, { version: '4.6.7' }], title: 'Unbounded collection validation',
};
for (const [name, advisories, code] of [
  ['verified braces backport is permitted', [known], 0],
  ['verified Zod compatibility backports are permitted', [zod], 0],
  ['a Zod finding for an unverified version remains blocking', [{ ...zod, findings: [{ version: '3.22.4' }] }], 1],
  ['a different Zod advisory remains blocking', [{ ...zod, github_advisory_id: 'GHSA-other' }], 1],
  ['a same-name non-Zod module does not use the Zod exception', [{ ...zod, module_name: 'other' }], 1],
  ['the Zod exception does not apply above the reviewed severity', [{ ...zod, severity: 'critical' }], 1],
  ['another high advisory remains blocking', [known, { ...known, github_advisory_id: 'GHSA-other' }], 1],
  ['another critical advisory remains blocking', [{ ...known, github_advisory_id: 'GHSA-other', severity: 'critical' }], 1],
  ['different vulnerable version remains blocking', [{ ...known, findings: [{ version: '3.0.2' }] }], 1],
  ['moderate findings retain the existing high threshold', [{ ...known, github_advisory_id: 'GHSA-other', severity: 'moderate' }], 0],
  ['an error response cannot pass', null, 1],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fxaeon-audit-'));
    try {
      const cli = join(dir, 'audit.cjs');
      const report = advisories ? { advisories: Object.fromEntries(advisories.map((entry, index) => [index, entry])), metadata: { vulnerabilities: {} } } : { error: { code: 'REGISTRY_ERROR' } };
      writeFileSync(cli, `console.log(${JSON.stringify(JSON.stringify(report))});process.exit(1);`);
      const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'audit_dependencies.mjs')], {
        encoding: 'utf8', windowsHide: true, env: { ...process.env, npm_execpath: cli },
      });
      assert.equal(result.status, code, `${result.stdout}\n${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
