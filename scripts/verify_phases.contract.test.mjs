import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function runPhase(phase, failCommand = '') {
  const directory = await mkdtemp(join(tmpdir(), 'fxaeon-verify-phase-'));
  const log = join(directory, 'commands.log');
  const fakePnpmCli = join(directory, 'pnpm-mock.mjs');
  await writeFile(fakePnpmCli, `import { appendFileSync } from 'node:fs';\nconst command = process.argv.slice(2).join(' ');\nappendFileSync(process.env.VERIFY_PHASE_LOG, command + '\\n');\nif (command === process.env.VERIFY_PHASE_FAIL_COMMAND) process.exit(7);\n`);

  const result = spawnSync(process.execPath, ['scripts/verify.mjs', phase], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_execpath: fakePnpmCli,
      VERIFY_PHASE_LOG: log,
      VERIFY_PHASE_FAIL_COMMAND: failCommand,
    },
  });
  const commands = await readFile(log, 'utf8').catch(() => '');
  await rm(directory, { recursive: true, force: true });
  return { ...result, commands: commands.split(/\r?\n/).filter(Boolean) };
}

test('CI source phase runs every source gate and no production/browser route suite', async () => {
  const result = await runPhase('--ci-source');
  assert.equal(result.status, 0, result.stderr);
  for (const required of ['verify:scope', 'verify:architecture', 'build:landing', 'lint', 'test', 'run audit:all', 'test:landing:browser']) {
    assert.ok(result.commands.some((command) => command.includes(required)), `missing ${required}`);
  }
  assert.ok(!result.commands.some((command) => /^build$|test:e2e/.test(command)));
});

test('isolated CI phases partition all nine browser harnesses exactly once', async () => {
  const phases = await Promise.all([0, 1, 2].map((index) => runPhase(`--ci-isolated-${index}`)));
  for (const result of phases) assert.equal(result.status, 0, result.stderr);
  const commands = phases.flatMap(({ commands }) => commands);
  const harnessCommands = commands.filter((command) => command.includes('test:e2e:'));
  assert.deepEqual(harnessCommands.sort(), [
    'test:e2e:borrow-harness',
    'test:e2e:move-harness',
    'test:e2e:positions-harness',
    'test:e2e:privy-send-harness',
    'test:e2e:trade-harness',
    'test:e2e:wallet-provider-harness',
    'test:e2e:mobile-wallet-harness',
    'test:e2e:overlay',
    'test:e2e:state-lab',
  ].sort());
  assert.ok(!commands.some((command) => command.includes('verify:scope') || command === 'build'));
});

test('unknown CI phases fail before launching checks', async () => {
  const result = await runPhase('--ci-isolated-3');
  assert.equal(result.status, 2);
  assert.deepEqual(result.commands, []);
});
test('phase failures remain failures and stop dependent source work', async () => {
  const sourceFailure = await runPhase('--ci-source', 'verify:scope');
  assert.equal(sourceFailure.status, 7);
  assert.deepEqual(sourceFailure.commands, ['verify:scope']);

  const isolatedFailure = await runPhase('--ci-isolated-0', 'test:e2e:overlay');
  assert.equal(isolatedFailure.status, 1);
  assert.deepEqual(isolatedFailure.commands, ['test:e2e:overlay']);
});

test('CI build phase keeps production gates while route E2E is sharded', () => {
  const runner = readFileSync(join(root, 'scripts/verify.mjs'), 'utf8');
  const buildStart = runner.indexOf("if (phase === 'all' || phase === 'ci-build')");
  const buildEnd = runner.indexOf('const builtFailures', buildStart);
  const buildPhase = runner.slice(buildStart, buildEnd);
  assert.ok(buildStart >= 0 && buildEnd > buildStart, 'CI build phase is present');
  for (const gate of ['build:landing', 'production build', 'Built frontend secret scan', 'typecheck', 'bundle check']) {
    assert.ok(buildPhase.includes(gate), `missing ${gate} in CI build phase`);
  }
  assert.match(buildPhase, /phase === 'all'.*run_built_e2e/s, 'default verify retains full built-route E2E');
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /shard: \['1\/4', '2\/4', '3\/4', '4\/4'\]/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /playwright test --shard=\$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /name: Scope, lint, typecheck, test, build/);
});
