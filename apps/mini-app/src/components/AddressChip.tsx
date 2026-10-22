'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { compactAddress } from '@/lib/addressPresentation';
import { copyText } from '@/lib/clipboard';
import { haptic } from '@/lib/telegram';

export function AddressChip({ address, iconOnly = false }: { address: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const short = compactAddress(address);
  return (
    <button
      type="button"
      aria-label={copied ? 'Address copied' : `Copy wallet address ${short}`}
      title={address}
      onClick={async () => {
        if (await copyText(address)) {
          haptic('success');
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } else {
          haptic('error');
        }
      }}
      className={`address-chip glass glass-press inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[length:var(--fs-caption)] text-mut${iconOnly ? ' min-w-11' : ''}`}
    >
      {!iconOnly && short}
      {copied ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
