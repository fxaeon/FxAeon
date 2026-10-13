import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClipboardEvent, InputHTMLAttributes } from 'react';
import { DecimalInput } from '../src/components/DecimalInput';

function propsFor(value: string, extras: Record<string, unknown> = {}) {
  const changes: string[] = [];
  const errors: string[] = [];
  const element = DecimalInput({ value, onValueChange: (next) => changes.push(next), onInvalidInput: (message) => errors.push(message), ...extras } as InputHTMLAttributes<HTMLInputElement> & { value: string; onValueChange: (value: string) => void; onInvalidInput: (message: string) => void });
  return { props: element.props as Record<string, (event: never) => void>, changes, errors };
}

test('DecimalInput rejects disallowed typed letters without changing the prior amount', () => {
  let prevented = false;
  const { props, changes } = propsFor('12');
  props.onKeyDown({ key: 'e', altKey: false, ctrlKey: false, metaKey: false, preventDefault: () => { prevented = true; } } as unknown as never);
  props.onChange({ currentTarget: { value: '12e' }, nativeEvent: { inputType: 'insertText', data: 'e' } } as unknown as never);
  assert.equal(prevented, true);
  assert.deepEqual(changes, ['12']);
});

test('DecimalInput clears an invalid pasted scientific notation instead of changing its meaning', () => {
  let prevented = false;
  const { props, changes, errors } = propsFor('5.4');
  props.onPaste({ currentTarget: { value: '5.4', selectionStart: 0, selectionEnd: 3 }, clipboardData: { getData: () => '1e3' }, preventDefault: () => { prevented = true; } } as unknown as never);
  assert.equal(prevented, true);
  assert.deepEqual(changes, ['']);
  assert.match(errors[0], /digits and one decimal separator/);
});

test('DecimalInput clears an invalid replacement instead of retaining an earlier amount', () => {
  const { props, changes, errors } = propsFor('12');
  props.onChange({ currentTarget: { value: '1e3' }, nativeEvent: { inputType: 'insertReplacementText', data: null } } as unknown as never);
  assert.deepEqual(changes, ['']);
  assert.match(errors[0], /digits and one decimal separator/);
});

test('DecimalInput keeps a valid pasted decimal and canonical fractional precision', () => {
  const { props, changes, errors } = propsFor('7');
  props.onPaste({ currentTarget: { value: '7', selectionStart: 0, selectionEnd: 1 }, clipboardData: { getData: () => '0.123456789012345678' }, preventDefault: () => undefined } as unknown as never);
  assert.deepEqual(changes, ['0.123456789012345678']);
  assert.deepEqual(errors, ['']);
});

test('DecimalInput preserves decimal edit states and canonical precision', () => {
  const { props, changes } = propsFor('1.2');
  props.onChange({ currentTarget: { value: '1.' }, nativeEvent: { inputType: 'insertText' } } as unknown as never);
  props.onChange({ currentTarget: { value: '' }, nativeEvent: { inputType: 'deleteContentBackward' } } as unknown as never);
  assert.deepEqual(changes, ['1.', '']);

  const comma = propsFor('1,2', { policy: 'comma-decimal' });
  comma.props.onChange({ currentTarget: { value: '1,2' }, nativeEvent: { inputType: 'insertText' } } as unknown as never);
  assert.deepEqual(comma.changes, ['1.2']);
  const continued = propsFor('1.2', { policy: 'comma-decimal' });
  continued.props.onChange({ currentTarget: { value: '1.23' }, nativeEvent: { inputType: 'insertText' } } as unknown as never);
  assert.deepEqual(continued.changes, ['1.23']);
});

test('comma decimal paste rejects ambiguous grouping instead of stripping separators', () => {
  const { props, changes } = propsFor('9', { policy: 'comma-decimal' });
  props.onPaste({ currentTarget: { value: '9', selectionStart: 0, selectionEnd: 1 }, clipboardData: { getData: () => '1,000' }, preventDefault: () => undefined } as unknown as ClipboardEvent<HTMLInputElement> as never);
  assert.deepEqual(changes, ['']);
});
