import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const steps = [
  ['Named unit regressions', process.execPath, ['scripts/test-unit.mjs']],
  ['Strict types and production build', 'pnpm', ['build']],
  ['Pinned SDK, architecture, source and fixture boundaries', process.execPath, ['scripts/check-boundaries.mjs']],
  ['Measured production budgets', process.execPath, ['scripts/check-budgets.mjs']],
  ['Separate deterministic browser build', 'pnpm', ['build:fixture']],
  ['Running browser acceptance', 'pnpm', ['test:browser']],
  ['Current locked dependency audit', process.execPath, ['scripts/audit.mjs']]
];
const results = [];
mkdirSync(resolve(root, 'test-results'), { recursive: true });
process.stdout.write('FxAeon checkpoint verification. Full product parity, real protocol forks and native devices are separate, unfinished release gates.\n');
for (const [name, command, args] of steps) {
  process.stdout.write(`\n${name}\n`);
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout: 300_000, env: process.env });
  results.push({ name, exitCode: result.status, durationMs: Date.now() - started, error: result.error?.message });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
const passed = results.length === steps.length && results.every(result => result.exitCode === 0);
writeFileSync(resolve(root, 'test-results/checkpoint-verify.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'step3 native-ETH long checkpoint', node: process.version, passed, results, excluded: ['Full 3373-record product parity', 'Real f(x) protocol transactions on an Ethereum local fork', 'Native Telegram and physical wallet execution', 'Remaining product modules and final step6 review'] }, null, 2) + '\n');
if (passed) process.stdout.write('\nCheckpoint verification passed within the stated scope. This is not the step5 parity gate or permission to replace the old tree.\n');
