import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results');
mkdirSync(output, { recursive: true });
const run = (file) => spawnSync(process.execPath, ['--import', 'tsx', file], {
  cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024
});
const count = (text, field) => Number(text.match(new RegExp(`^# ${field} (\\d+)$`, 'm'))?.[1] ?? -1);

// In this environment --test + the tsx loader can report file-only passes with
// no registered cases. Execute each module directly and require named TAP cases.
// An intentionally failing typed test proves failure propagation before the suite.
const canary = resolve(output, `runner-canary-${process.pid}.ts`);
writeFileSync(canary, "import test from 'node:test';\nimport assert from 'node:assert/strict';\nconst expected: number = 1;\ntest('runner failure canary', () => assert.equal(expected, 2));\n");
try {
  const result = run(canary);
  if (result.status !== 1 || count(result.stdout, 'fail') !== 1 || !result.stdout.includes('not ok 1 - runner failure canary')) {
    process.stderr.write('Unit harness failed its deliberate failing-test check. No suite result is valid.\n');
    process.stderr.write(JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }) + '\n');
    process.exitCode = 1;
  }
} finally { rmSync(canary, { force: true }); }
if (process.exitCode) process.exit(process.exitCode);

const files = readdirSync(resolve(root, 'test')).filter(name => name.endsWith('.test.ts')).sort();
if (!files.length) throw new Error('No unit test modules were found.');
const results = [];
for (const file of files) {
  const started = Date.now();
  const result = run(resolve(root, 'test', file));
  const cases = count(result.stdout, 'tests');
  const passed = count(result.stdout, 'pass');
  const failed = count(result.stdout, 'fail');
  const skipped = count(result.stdout, 'skipped');
  const cancelled = count(result.stdout, 'cancelled');
  const todo = count(result.stdout, 'todo');
  const valid = result.status === 0 && cases > 0 && passed === cases && failed === 0 && skipped === 0 && cancelled === 0 && todo === 0 && /^# Subtest: .+$/m.test(result.stdout);
  writeFileSync(resolve(output, `${file}.tap`), result.stdout + result.stderr);
  results.push({ file, cases, passed, failed, skipped, cancelled, todo, valid, durationMs: Date.now() - started, exitCode: result.status });
  process.stdout.write(`${valid ? 'PASS' : 'FAIL'} ${file}: ${passed}/${cases} named cases\n`);
  if (!valid) {
    process.stderr.write(result.stdout + result.stderr + (result.error ? String(result.error) + '\n' : ''));
    process.exitCode = 1;
  }
}
const total = results.reduce((sum, x) => sum + Math.max(x.cases, 0), 0);
writeFileSync(resolve(output, 'unit-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, runner: 'direct isolated module + named TAP counts + failing typed canary', canaryVerified: true, total, results }, null, 2) + '\n');
process.stdout.write(`${total} named cases across ${files.length} isolated modules. Failing-test canary verified.\n`);
