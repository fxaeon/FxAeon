'use client';

import { useEffect, useState } from 'react';

/** The longest overlay exit: phone sheets slide down over --dur-base. */
const OVERLAY_EXIT_MS = 180;

/** Keep closing chrome for its brief exit; never retain a previous account's UI. */
export function useExitPresence(open: boolean, identity: string, durationMs = OVERLAY_EXIT_MS) {
  const [retainedIdentity, setRetainedIdentity] = useState<string | null>(open ? identity : null);
  useEffect(() => {
    if (open) {
      setRetainedIdentity(identity);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRetainedIdentity(null);
      return;
    }
    const timer = window.setTimeout(() => setRetainedIdentity(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, identity, durationMs]);
  return open || retainedIdentity === identity;
}
