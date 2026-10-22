import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../apps/mini-app/', import.meta.url));
const require = createRequire(new URL('../apps/mini-app/package.json', import.meta.url));
const tsx = require.resolve('tsx/cli');

export function unitTestArgs(env = process.env, extraArgs = []) {
  const concurrency = env.FX_UNIT_TEST_CONCURRENCY ?? '2';
  if (!['1', '2'].includes(concurrency)) throw new Error('FX_UNIT_TEST_CONCURRENCY must be 1 or 2.');
  return [tsx, '--test', `--test-concurrency=${concurrency}`, ...extraArgs, 'test/**/*.test.ts'];
}

export function runUnitTests({ env = process.env, args = [], run = spawnSync } = {}) {
  const result = run(process.execPath, unitTestArgs(env, args), {
    cwd: app, stdio: 'inherit', windowsHide: true, env,
  });
  if (result.error) console.error(`[test] Could not start unit tests: ${result.error.message}`);
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runUnitTests({ args: process.argv.slice(2) }); }
  catch (error) { console.error(`[test] ${error.message}`); process.exitCode = 2; }
}
