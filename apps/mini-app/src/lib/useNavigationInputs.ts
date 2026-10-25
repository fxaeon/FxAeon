'use client';

import { useEffect, useRef } from 'react';
import { navigationInputMemory, type NavigationInputPage, type NavigationInputs } from './navigationInputs';

/** Restore editing context only; every route and its authorization still starts fresh. */
export function useNavigationInputs({ page, identity, ready, value, stage, restore }: {
  page: NavigationInputPage; identity: string; ready: boolean;
  value: unknown; stage: string; restore: (value: NavigationInputs) => void;
}) {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const serialized = JSON.stringify(value);
  const editFingerprint = JSON.stringify(value, (key, field) => key === 'slippage' ? undefined : field);
  const initial = useRef(editFingerprint);
  const handled = useRef(false);
  const previousIdentity = useRef(identity);
  const pendingRestore = useRef<string | null>(null);
  const resultInputs = useRef<string | null>(null);
  const explicitContext = useRef(typeof window !== 'undefined' && window.location.search.length > 1);
  const latest = useRef({ identity, ready, value, stage, serialized });
  latest.current = { identity, ready, value, stage, serialized };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  if (pendingRestore.current === serialized) pendingRestore.current = null;
  if (stage === 'result' || stage === 'executing') resultInputs.current = serialized;

  useEffect(() => {
    if (previousIdentity.current !== identity) {
      // Account/network changes keep the existing pages' reset behavior.
      navigationInputMemory.clear(page, previousIdentity.current);
      previousIdentity.current = identity;
      if (handled.current) return;
    }
    if (!ready || handled.current) return;
    // Explicit URLs and an edit made during wallet hydration take priority.
    if (explicitContext.current || editFingerprint !== initial.current) { handled.current = true; return; }
    const saved = navigationInputMemory.read(page, identity);
    if (saved) {
      handled.current = true;
      pendingRestore.current = JSON.stringify(saved);
      // Run after mount effects that load global form settings. Explicit URL
      // restoration was already excluded; this still cannot resume review.
      queueMicrotask(() => {
        if (mounted.current && latest.current.identity === identity) restoreRef.current(saved);
      });
    } else if (!identity.startsWith('disconnected:')) handled.current = true;
  }, [editFingerprint, identity, page, ready, serialized]);

  useEffect(() => () => {
    const state = latest.current;
    if (!state.ready || pendingRestore.current !== null) return;
    if (state.stage === 'executing' || state.stage === 'result' || state.serialized === resultInputs.current) {
      navigationInputMemory.clear(page, state.identity);
      return;
    }
    navigationInputMemory.save(page, state.identity, state.value);
  }, [page]);
}
