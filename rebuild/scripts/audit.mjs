import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync('pnpm', ['audit', '--json', '--audit-level', 'high'], {
  cwd: root, encoding: 'utf8', timeout: 50_000, maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, npm_config_fetch_retries: '0', npm_config_fetch_timeout: '12000' }
});
mkdirSync(resolve(root, 'test-results'), { recursive: true });
let report;
try { report = JSON.parse(result.stdout); } catch { /* A timeout/error is not a clean audit. */ }
writeFileSync(resolve(root, 'test-results/dependency-audit.json'), JSON.stringify({ generatedAt: new Date().toISOString(), status: result.status, error: result.error?.message, report, stderr: result.stderr }, null, 2) + '\n');
if (result.status !== 0 || !report?.metadata?.vulnerabilities) {
  process.stderr.write('Dependency audit did not pass. Read test-results/dependency-audit.json; no clean result is inferred.\n');
  process.exit(1);
}
const levels = report.metadata.vulnerabilities;
if (levels.high > 0 || levels.critical > 0) process.exit(1);
process.stdout.write(`Dependency audit: ${JSON.stringify(levels)} (${report.metadata.totalDependencies} graph dependencies).\n`);
