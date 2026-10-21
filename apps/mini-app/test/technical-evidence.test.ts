import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { evidencePreview, evidenceTextRows, exactEvidenceJson } from '../src/components/review/technicalEvidence';

test('abbreviation is bounded and never changes the original exact payload', () => {
  const value = '0x' + 'abcdef0123456789'.repeat(100);
  assert.equal(evidencePreview(value), `${value.slice(0, 8)}…${value.slice(-6)}`);
  assert.equal(evidencePreview(value).length, 15);
  assert.equal(value.length, 1602);
  assert.equal(evidencePreview('900719925474099312345678901'), '90071992…678901');
  assert.equal(evidencePreview('0.000000000000000001'), '0.000000000000000001');
});

test('quote JSON preserves exact bigint, decimal, calldata and labelled minimums', () => {
  const quote = { minimumReceived: 900719925474099312345678901n, ratio: '1.000000000000000003', calldata: '0x0000ff', fee: 0n };
  assert.deepEqual(JSON.parse(exactEvidenceJson(quote)), { minimumReceived: '900719925474099312345678901', ratio: '1.000000000000000003', calldata: '0x0000ff', fee: '0' });
});


test('native exact-data dialog owns Escape and Tab without cancelling native behavior', () => {
  const source = readFileSync(new URL('../src/components/review/TechnicalEvidenceRow.tsx', import.meta.url), 'utf8');
  const handler = source.match(/<dialog ref=\{dialog\} onKeyDown=\{event => \{([\s\S]*?)\}\}/)?.[1] ?? '';
  assert.match(handler, /event.key === 'Escape' \|\| event.key === 'Tab'/);
  assert.match(handler, /event.stopPropagation\(\)/);
  assert.doesNotMatch(handler, /preventDefault|reset\(/);
});


test('short exact values use compact rows while long JSON or calldata is bounded', () => {
  assert.equal(evidenceTextRows('0x' + 'a'.repeat(40)), 2);
  assert.equal(evidenceTextRows('0x' + 'b'.repeat(2000)), 12);
  assert.equal(evidenceTextRows(Array(100).fill('line').join('\n')), 12);
});

test('parent overlay defers Escape and Tab to open or event-target native child dialog', () => {
  const source = readFileSync(new URL('../src/lib/useOverlayDialog.ts', import.meta.url), 'utf8');
  const keyboard = source.slice(source.indexOf('const onKeyDown = (event: KeyboardEvent)'));
  assert.ok(keyboard.indexOf("dialog.querySelector('dialog[open]')") < keyboard.indexOf('event.preventDefault()'));
  assert.match(keyboard, /nativeTarget !== \(dialog as HTMLElement\) && dialog.contains\(nativeTarget\)/);
  assert.match(keyboard, /event.key === 'Escape' \|\| event.key === 'Tab'/);
});
