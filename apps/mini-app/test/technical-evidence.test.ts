import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

test('parent overlay defers Escape and Tab to open or event-target native child dialog', () => {
  const source = readFileSync(new URL('../src/lib/useOverlayDialog.ts', import.meta.url), 'utf8');
  const keyboard = source.slice(source.indexOf('const onKeyDown = (event: KeyboardEvent)'));
  assert.ok(keyboard.indexOf("dialog.querySelector('dialog[open]')") < keyboard.indexOf('event.preventDefault()'));
  assert.match(keyboard, /nativeTarget !== \(dialog as HTMLElement\) && dialog.contains\(nativeTarget\)/);
  assert.match(keyboard, /event.key === 'Escape' \|\| event.key === 'Tab'/);
});
