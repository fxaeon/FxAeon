import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Exercise the active typed-ESLint dependency, not a stale virtual-store copy.
const rootRequire = createRequire(new URL('../package.json', import.meta.url));
const toolingRequire = createRequire(rootRequire.resolve('typescript-eslint'));
const parserRequire = createRequire(toolingRequire.resolve('@typescript-eslint/parser'));
const estreeRequire = createRequire(parserRequire.resolve('@typescript-eslint/typescript-estree'));
const entry = estreeRequire.resolve('minimatch');
assert.equal(estreeRequire('minimatch/package.json').version, '11.0.1');
// ESLint's older callable API predates the vulnerable preprocessing feature.
// Do not upgrade that API generation blindly or suppress the registry finding.
const eslintRequire = createRequire(rootRequire.resolve('eslint'));
const legacyConsumers = [eslintRequire,
  createRequire(eslintRequire.resolve('@eslint/config-array')),
  createRequire(eslintRequire.resolve('@eslint/eslintrc'))];
for (const consumer of legacyConsumers) {
  assert.equal(consumer('minimatch/package.json').version, '3.1.5');
  const source = readFileSync(consumer.resolve('minimatch'), 'utf8');
  assert.doesNotMatch(source, /firstPhasePreProcess|secondPhasePreProcess|optimizationLevel/);
}
const legacyEntry = eslintRequire.resolve('minimatch');

// Keep a regression in vulnerable preprocessing from hanging the security gate.
const result = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', `
  const assert = require('node:assert/strict');
  const { Minimatch, minimatch } = require(${JSON.stringify(entry)});
  const pattern = 'a/' + '**/../x/'.repeat(18) + '*.ts';
  const matcher = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 32 });
  assert.ok(matcher.globParts.length <= 32, 'glob-parts expansion must respect the bound');
  const legacy = require(${JSON.stringify(legacyEntry)});
  assert.equal(new legacy.Minimatch(pattern, { optimizationLevel: 2 }).globParts.length, 1,
    'legacy ESLint matching must not have the vulnerable amplification pass');
  for (const [file, glob, options, expected] of [
    ['server/access.ts', '**/*.ts', {}, true],
    ['server/access.js', '**/*.ts', {}, false],
    ['server/access.test.ts', '**/!(*.test).ts', {}, false],
    ['server/access.ts', '**/!(*.test).ts', {}, true],
    ['.cache/access.ts', '**/*.ts', { dot: true }, true],
    ['.cache/access.ts', '**/*.ts', {}, false],
    ['C:/repo/access.ts', 'C:/repo/**/*.ts', { nocase: true }, true],
  ]) assert.equal(minimatch(file, glob, options), expected, file + ' ' + glob);
`], { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 128 * 1024 });
assert.ifError(result.error);
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
console.log('[audit] Verified minimatch: typed ESLint uses bounded 11.0.1; legacy 3.1.5 has no affected preprocessing pass. Registry findings remain visible.');
