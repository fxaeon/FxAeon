import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { typecheckSteps } from './typecheck.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'apps/mini-app');
const configPath = resolve(app, 'e2e/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
assert.deepEqual(parsed.errors, []);
const included = new Set(parsed.fileNames.map((path) => resolve(path)));

function typescriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    // Playwright also runs .mts and .cts specs, so they must be type-checked too.
    return /\.(?:[cm]?ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test('E2E compiler includes every TypeScript suite, fixture, harness and Playwright config', () => {
  const expected = [
    ...typescriptFiles(resolve(app, 'e2e')),
    ...readdirSync(app).filter((name) => /^playwright.*\.config\.ts$/.test(name)).map((name) => resolve(app, name)),
  ];
  assert.ok(expected.some((path) => path.endsWith('.spec.ts')), 'browser specs must exist');
  assert.ok(expected.some((path) => path.endsWith('.tsx')), 'React harness entries must exist');
  const missing = expected.filter((path) => !included.has(path)).map((path) => relative(root, path));
  assert.deepEqual(missing, [], 'TypeScript must not silently exclude browser test files');
});

test('E2E compiler preserves strict no-emit checking with an isolated incremental cache', () => {
  assert.equal(parsed.options.strict, true);
  assert.equal(parsed.options.noEmit, true);
  assert.equal(parsed.options.incremental, true);
  assert.equal(resolve(parsed.options.tsBuildInfoFile), resolve(app, '.cache/e2e.tsbuildinfo'));
  const forkPath = resolve(app, 'e2e/fork/tsconfig.json');
  const forkConfig = ts.readConfigFile(forkPath, ts.sys.readFile);
  const fork = ts.parseJsonConfigFileContent(forkConfig.config, ts.sys, dirname(forkPath));
  assert.equal(resolve(fork.options.tsBuildInfoFile), resolve(app, '.cache/fork.tsbuildinfo'));
  assert.notEqual(fork.options.tsBuildInfoFile, parsed.options.tsBuildInfoFile);
  assert.notEqual(parsed.options.noCheck, true);
  for (const option of ['noImplicitAny', 'strictNullChecks', 'strictFunctionTypes', 'strictPropertyInitialization']) {
    assert.notEqual(parsed.options[option], false, `${option} must not override strict checking`);
  }
});

test('release typecheck runs the E2E coverage contract and compiler', () => {
  const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
  const appScripts = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts.typecheck, 'node scripts/typecheck.mjs');
  assert.equal(scripts['typecheck:e2e'], 'node scripts/typecheck.mjs --e2e');
  assert.deepEqual(typecheckSteps().slice(-2).map(step => step.args.slice(-1)[0]), ['scripts/e2e_typecheck.contract.test.mjs', 'apps/mini-app/e2e/tsconfig.json']);
  assert.equal(appScripts['typecheck:e2e'], 'tsc -p e2e/tsconfig.json');
  assert.match(readFileSync(resolve(root, 'scripts/verify.mjs'), 'utf8'), /pnpmRun\(\['typecheck'\], 'typecheck'\)/);
});
