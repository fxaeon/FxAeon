'use client';

import { useEffect, useState } from 'react';

/** Reveal an initial snapshot together; background refreshes keep the view in place. */
export function useInitialReadPending(identity: string, pending: boolean): boolean {
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => { if (!pending) setRevealed(identity); }, [identity, pending]);
  return pending && revealed !== identity;
}
