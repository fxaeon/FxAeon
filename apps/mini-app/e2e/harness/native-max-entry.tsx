import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useNativeMax } from '../../src/lib/fx/useNativeMax';
import type { VerifiedNativeMax } from '../../src/lib/fx/nativeMax';

declare global {
  interface Window {
    __nativeMaxHarness: {
      calls: number;
      resolve?: (value: VerifiedNativeMax) => void;
      reject?: (error: Error) => void;
      clickValue?: string;
    };
  }
}

function MaxHarness() {
  const [value, setValue] = useState('1');
  const [context, setContext] = useState('wallet-a:chain1:balance1000:route-a:fast');
  const max = useNativeMax({
    contextKey: context,
    calculate: () => {
      window.__nativeMaxHarness.calls += 1;
      return new Promise<VerifiedNativeMax>((resolve, reject) => {
        window.__nativeMaxHarness.resolve = resolve;
        window.__nativeMaxHarness.reject = reject;
      });
    },
    onAmount: (amount) => {
      const next = amount?.toString() ?? '';
      window.__nativeMaxHarness.clickValue = next;
      setValue(next);
    },
  });
  return <main>
    <input aria-label="Amount" value={value} onChange={(event) => { max.cancel(); setValue(event.target.value); }} />
    <button onClick={() => void max.resolveMax()}>Max</button>
    <button onClick={() => { max.cancel(); setValue('250'); }}>25%</button>
    <button onClick={() => setContext('wallet-b:chain1:balance500:route-a:fast')}>Change wallet</button>
    <output data-testid="pending">{String(max.pending)}</output>
    <output data-testid="error">{max.error}</output>
  </main>;
}

document.documentElement.dataset.harnessReady = 'true';
createRoot(document.getElementById('root')!).render(<React.StrictMode><MaxHarness /></React.StrictMode>);
