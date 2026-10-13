import * as React from 'react';
import type { ClipboardEvent, InputHTMLAttributes, KeyboardEvent } from 'react';
import { normalizeAmountInput } from '@/lib/amount';

export type DecimalInputPolicy = 'dot-decimal' | 'comma-decimal';
type DecimalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'value' | 'onChange' | 'onPaste' | 'onKeyDown'> & {
  value: string;
  onValueChange: (value: string) => void;
  policy?: DecimalInputPolicy;
  onInvalidInput?: (message: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
};

const decimalOnlyMessage = 'Use digits and one decimal separator only.';
const typingCandidate = (value: string, policy: DecimalInputPolicy) => policy === 'comma-decimal'
  ? /^(?:\d*(?:\.\d*)?\d*|\d*(?:,\d*)?)$/.test(value)
  : /^\d*(?:\.\d*)?$/.test(value);

function validEdit(raw: string, policy: DecimalInputPolicy, maxLength = 100) {
  if (raw.length > maxLength || raw !== raw.trim() || !typingCandidate(raw, policy)) return null;
  // Once a comma decimal has been normalized, controlled state is canonical
  // dot notation. Continue accepting that form while still rejecting grouped
  // values such as 1,000 at the paste boundary.
  return normalizeAmountInput(raw, policy === 'comma-decimal' && raw.includes(',') ? policy : 'dot-decimal');
}

export function DecimalInput({ value, onValueChange, policy = 'dot-decimal', onInvalidInput, onKeyDown, onPaste, maxLength = 100, ...props }: DecimalInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const key = event.key;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && key.length === 1
      && !/[0-9]/.test(key) && key !== '.' && !(policy === 'comma-decimal' && key === ',')) event.preventDefault();
    onKeyDown?.(event);
  };
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const replacement = `${input.value.slice(0, start)}${event.clipboardData.getData('text')}${input.value.slice(end)}`;
    event.preventDefault();
    const next = validEdit(replacement, policy, maxLength ?? 100);
    if (next === null) {
      onValueChange('');
      onInvalidInput?.(decimalOnlyMessage);
    } else {
      onValueChange(next);
      onInvalidInput?.('');
    }
    onPaste?.(event);
  };

  return <input {...props} type="text" inputMode="decimal" value={value}
    onKeyDown={handleKeyDown} onPaste={handlePaste}
    onChange={(event) => {
      const raw = event.currentTarget.value;
      const next = validEdit(raw, policy, maxLength ?? 100);
      const nativeEvent = event.nativeEvent as InputEvent;
      if (next === null) {
        // Reject an ordinary key without disturbing the last valid draft. For
        // replacement/autofill/IME text, clear it so no stale amount survives.
        if (nativeEvent.inputType === 'insertText' && nativeEvent.data?.length === 1) onValueChange(value);
        else { onValueChange(''); onInvalidInput?.(decimalOnlyMessage); }
        return;
      }
      onInvalidInput?.('');
      onValueChange(next);
    }} />;
}
