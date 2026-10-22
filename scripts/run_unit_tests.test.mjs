import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runUnitTests, unitTestArgs } from './run_unit_tests.mjs';

test('unit runner retains the complete TypeScript test glob with two isolated test processes by default', () => {
  const args = unitTestArgs({});
  assert.match(args[0], /tsx[\\/]dist[\\/]cli\.mjs$/);
  assert.deepEqual(args.slice(1), ['--test', '--test-concurrency=2', 'test/**/*.test.ts']);
  const app = JSON.parse(readFileSync(new URL('../apps/mini-app/package.json', import.meta.url), 'utf8'));
  assert.equal(app.scripts.test, 'node ../../scripts/run_unit_tests.mjs');
});

test('one-worker override and focused Node flags preserve file collection without a shell', () => {
  let call;
  const env = { FX_UNIT_TEST_CONCURRENCY: '1' };
  assert.equal(runUnitTests({ env, args: ['--test-name-pattern=receipt'], run: (...args) => { call = args; return { status: 0 }; } }), 0);
  assert.equal(call[0], process.execPath);
  assert.deepEqual(call[1].slice(1), ['--test', '--test-concurrency=1', '--test-name-pattern=receipt', 'test/**/*.test.ts']);
  assert.equal(call[2].env, env);
  assert.equal(call[2].shell, undefined);
  assert.match(call[2].cwd, /apps[\\/]mini-app[\\/]$/);
});

test('invalid worker settings fail before launching, and test failures remain failures', () => {
  for (const value of ['0', '3', '', 'two', '-1']) {
    assert.throws(() => unitTestArgs({ FX_UNIT_TEST_CONCURRENCY: value }), /must be 1 or 2/);
  }
  assert.equal(runUnitTests({ env: {}, run: () => ({ status: 7 }) }), 7);
  assert.equal(runUnitTests({ env: {}, run: () => ({ status: null, signal: 'SIGTERM' }) }), 1);
});
