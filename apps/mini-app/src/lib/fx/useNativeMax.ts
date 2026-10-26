'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeMaxCache, nativeMaxErrorMessage, type VerifiedNativeMax } from './nativeMax';

export interface UseNativeMaxOptions {
  /** Null disables native Max. Include wallet, chain, balance, every route
   * input and selected fee tier; exclude the editable native amount. */
  contextKey: string | null;
  calculate: () => Promise<VerifiedNativeMax>;
  /** Null clears an unrelated old amount while a cold calculation runs. */
  onAmount: (amount: bigint | null) => void;
}

/** Calculate native Max only on demand. A valid exact-context cached result
 * applies immediately; a cold tap clears the draft and joins any pending tap. */
export function useNativeMax(options: UseNativeMaxOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const generation = useRef(0);
  const mounted = useRef(false);
  const [state, setState] = useState<{ key: string | null; pending: boolean; error: string | null }>({ key: null, pending: false, error: null });
  const key = options.contextKey;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  useEffect(() => {
    // Context changes invalidate pending tap results without starting any
    // background route builds or gas estimates on mount/input edits.
    generation.current += 1;
    setState({ key, pending: false, error: null });
  }, [key]);

  const cancel = useCallback(() => {
    generation.current += 1;
    setState({ key: optionsRef.current.contextKey, pending: false, error: null });
  }, []);

  const resolveMax = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.contextKey) return;
    const requestKey = current.contextKey;
    const ticket = ++generation.current;
    const cached = nativeMaxCache.peek(requestKey);
    if (cached) {
      setState({ key: requestKey, pending: false, error: null });
      current.onAmount(cached.amountWei);
      return;
    }
    setState({ key: requestKey, pending: true, error: null });
    current.onAmount(null);
    try {
      const result = await nativeMaxCache.prepare(requestKey, current.calculate);
      if (!mounted.current || ticket !== generation.current || optionsRef.current.contextKey !== requestKey) return;
      if (result.validUntil <= Date.now()) throw new Error('current gas estimate is unavailable');
      optionsRef.current.onAmount(result.amountWei);
      setState({ key: requestKey, pending: false, error: null });
    } catch (error) {
      if (!mounted.current || ticket !== generation.current || optionsRef.current.contextKey !== requestKey) return;
      setState({ key: requestKey, pending: false, error: nativeMaxErrorMessage(error) });
    }
  }, []);

  return {
    resolveMax,
    /** Call before any manual amount edit or percentage preset. */
    cancel,
    pending: state.key === key && state.pending,
    error: state.key === key ? state.error : null,
  };
}
