import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const instrument = require('../e2e/fork/review-evidence-loader.cjs') as (source: string) => string;
const nextConfig = require('../next.config.js');

test('fork evidence preserves exact accepted transaction payloads without changing signing code', () => {
  const source = readFileSync(new URL('../src/components/ActionReview.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('data-fork-reviewed-transactions'));
  const transformed = instrument(source);
  assert.equal(transformed.replace(/ data-fork-reviewed-transactions=\{.*? : undefined\}/, ''), source);
  const compiled = ts.transpileModule(transformed, { fileName: 'ActionReview.tsx', reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  assert.throws(() => instrument(source.replace('<header data-review-header', '<header')), /Expected one/);
  assert.throws(() => instrument(source + '<header data-review-header'), /Expected one/);
});

test('normal builds omit the evidence loader and it requires explicit local-fork mode', () => {
  const previousEvidence = process.env.FX_E2E_REVIEW_EVIDENCE;
  const previousFork = process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE;
  const buildConfig = () => nextConfig.webpack({ module: { rules: [] }, resolve: {}, plugins: [] }, { isServer: false, webpack: { IgnorePlugin: class {} } });
  try {
    delete process.env.FX_E2E_REVIEW_EVIDENCE;
    assert.deepEqual(buildConfig().module.rules, []);
    process.env.FX_E2E_REVIEW_EVIDENCE = '1';
    delete process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE;
    assert.throws(buildConfig, /requires local-fork/);
    process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE = '1';
    const rules = buildConfig().module.rules;
    assert.equal(rules.length, 1);
    assert.equal(rules[0].enforce, 'pre');
    assert.match(rules[0].use[0].loader, /review-evidence-loader\.cjs$/);
  } finally {
    if (previousEvidence === undefined) delete process.env.FX_E2E_REVIEW_EVIDENCE; else process.env.FX_E2E_REVIEW_EVIDENCE = previousEvidence;
    if (previousFork === undefined) delete process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE; else process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE = previousFork;
  }
});
