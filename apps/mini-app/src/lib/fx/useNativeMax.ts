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

/** Prepare an exact verified maximum before the user asks for it. A fresh
 * result applies synchronously. Cold requests clear the draft immediately,
 * join the warmup, and only apply if the user has not edited in the meantime. */
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
    generation.current += 1;
    setState({ key, pending: false, error: null });
    if (!key) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const schedule = (delay: number, refresh = false) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { void prepare(refresh); }, delay);
    };
    const prepare = async (refresh = false) => {
      if (!active || optionsRef.current.contextKey !== key || !visible() || !online()) return;
      try {
        const result = await nativeMaxCache.prepare(key, optionsRef.current.calculate, refresh);
        if (active) schedule(Math.max(1_000, result.validUntil - Date.now() - 2_000), true);
      } catch {
        if (active) schedule(15_000);
      }
    };
    const resume = () => {
      if (timer !== undefined) clearTimeout(timer);
      void prepare();
    };
    // Coalesce slider and route edits before starting remote work. A tap
    // during this short warmup window can still start/join it immediately.
    schedule(150);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
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
