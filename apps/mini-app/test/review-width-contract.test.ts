import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
test('Borrow and Earn review grids have definite responsive width rather than auto-margin shrink-to-content', () => {
  for (const [file, selector] of [['BorrowWorkspace.module.css', '.layout'], ['SavingsWorkspace.module.css', '.vaultLayout']]) {
    const css = read(`components/${file}`);
    const rule = css.slice(css.indexOf(`${selector}[data-review='true']`)).split('}')[0];
    assert.match(rule, /width: min\(100%, 480px\)/);
    assert.match(rule, /min-width: 0/);
    assert.match(rule, /margin-inline: auto/);
    assert.doesNotMatch(css, /minmax\(0, 620px\)/);
  }
});
test('Move widens only its review state while shared inline content stays bounded and shrinkable', () => {
  assert.match(read('app/move/page.tsx'), /data-review=\{!isReviewInputStage\(reviewStage\)\}/);
  assert.match(read('app/move/Move.module.css'), /\.moveWorkspace\.moveWorkspace\[data-review='true'\] \{ width: min\(100%, 480px\); max-width: 480px;/);
  const css = read('components/FlowWorkspace.module.css');
  const rule = css.slice(css.indexOf('.reviewInlineContent {')).split('}')[0];
  assert.match(rule, /width: 100%/);
  assert.match(rule, /min-width: 0/);
  assert.match(rule, /max-width: 480px/);
});
