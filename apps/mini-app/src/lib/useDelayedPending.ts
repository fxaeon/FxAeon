'use client';

import { useEffect, useState } from 'react';

export const LOADING_FEEDBACK_DELAY_MS = 160;

/** Delay only the placeholder, never completion or authentication. */
export function useDelayedPending(pending: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(true), LOADING_FEEDBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return pending && visible;
}
