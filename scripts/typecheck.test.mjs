import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runTypechecks, typecheckSteps } from './typecheck.mjs';

test('typechecking uses the invoking Node for every compiler and the E2E coverage contract', () => {
  const calls = [];
  const status = runTypechecks({ run: (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  } });
  assert.equal(status, 0);
  assert.deepEqual(typecheckSteps().map(step => step.name), ['app', 'fork', 'E2E coverage contract', 'E2E']);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.options.shell, undefined);
    assert.equal(call.options.stdio, 'inherit');
  }
  assert.match(calls[0].args[0], /typescript[\\/]bin[\\/]tsc$/);
  assert.deepEqual(calls[0].args.slice(1), ['--project', 'apps/mini-app/tsconfig.json', '--noEmit']);
  assert.deepEqual(calls[1].args.slice(1), ['--project', 'apps/mini-app/e2e/fork/tsconfig.json']);
  assert.deepEqual(calls[2].args, ['--test', 'scripts/e2e_typecheck.contract.test.mjs']);
  assert.deepEqual(calls[3].args.slice(1), ['--project', 'apps/mini-app/e2e/tsconfig.json']);
});

test('each failed compiler or coverage contract preserves failure and stops later checks', () => {
  for (let failedStep = 0; failedStep < 4; failedStep++) {
    let calls = 0;
    assert.equal(runTypechecks({ run: () => ({ status: calls++ === failedStep ? 7 : 0 }) }), 7);
    assert.equal(calls, failedStep + 1);
  }
  assert.equal(runTypechecks({ run: () => ({ status: null, signal: 'SIGTERM' }) }), 1);
  assert.equal(runTypechecks({ run: () => ({ status: null, error: new Error('Cannot start compiler') }) }), 1);
});

test('E2E-only mode keeps its coverage contract and compiler without repeating app/fork checks', () => {
  const calls = [];
  assert.equal(runTypechecks({ e2eOnly: true, run: (_command, args) => { calls.push(args); return { status: 0 }; } }), 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(typecheckSteps(true).map(step => step.name), ['E2E coverage contract', 'E2E']);
});

test('unknown arguments fail before a compiler can start', () => {
  const result = spawnSync(process.execPath, ['scripts/typecheck.mjs', '--skip'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stdout, /\[typecheck\]/);
});
