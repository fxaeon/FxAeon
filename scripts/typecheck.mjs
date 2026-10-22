import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const appRequire = createRequire(new URL('../apps/mini-app/package.json', import.meta.url));
const compiler = appRequire.resolve('typescript/bin/tsc');

/** Reuse the caller's Node runtime instead of resolving nested pnpm/tsc shims
 * from PATH. Keep the three compilers sequential and their caches isolated. */
export function typecheckSteps(e2eOnly = false) {
  return [
    ...(!e2eOnly ? [
      { name: 'app', args: [compiler, '--project', 'apps/mini-app/tsconfig.json', '--noEmit'] },
      { name: 'fork', args: [compiler, '--project', 'apps/mini-app/e2e/fork/tsconfig.json'] },
    ] : []),
    { name: 'E2E coverage contract', args: ['--test', 'scripts/e2e_typecheck.contract.test.mjs'] },
    { name: 'E2E', args: [compiler, '--project', 'apps/mini-app/e2e/tsconfig.json'] },
  ];
}

export function runTypechecks({ e2eOnly = false, run = spawnSync } = {}) {
  for (const step of typecheckSteps(e2eOnly)) {
    console.log(`[typecheck] ${step.name}`);
    const result = run(process.execPath, step.args, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error || result.signal || result.status !== 0) {
      console.error(`[typecheck] ${step.name} failed${result.signal ? ` (${result.signal})` : ''}`);
      return result.status || 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(argument => argument !== '--e2e')) {
    console.error('Usage: node scripts/typecheck.mjs [--e2e]');
    process.exitCode = 2;
  } else {
    process.exitCode = runTypechecks({ e2eOnly: args.includes('--e2e') });
  }
}
