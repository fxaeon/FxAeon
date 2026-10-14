'use client';

import { createPortal } from 'react-dom';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Info, Search } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import { useWalletBalances } from '@/components/WalletDataProvider';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { LeverageSplitRange } from '@/components/LeverageSplit';
import { DecimalInput } from '@/components/DecimalInput';
import type { LeverageSide } from '@/lib/leverageShare';
import { haptic } from '@/lib/telegram';
import { formatBalanceDecimal } from '@/lib/amount';
import { formatUsdCents } from '@/lib/positionValuation';
import { priceKeyForSymbol, type UsdPriceMap } from '@/lib/prices';
import styles from '@/components/trade-surfaces.module.css';
import { tokenName, tokenPresentation, tokenSymbol } from '@/lib/fx/tokenPresentation';
import {
  balanceMapForResult,
  tokenBalanceFor,
  usdCentsForTokenBalance,
  type TokenBalanceMap,
  type TokenBalanceView,
} from '@/components/wallet-balance-cache';

export { tokenBalanceFor } from '@/components/wallet-balance-cache';
export type { TokenBalanceMap, TokenBalanceView } from '@/components/wallet-balance-cache';

export type WalletTokenBalanceSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  balances: TokenBalanceMap;
  reason?: string;
  refresh: (force?: boolean) => Promise<void>;
};

const EMPTY_TOKEN_BALANCES: TokenBalanceMap = {};

/**
 * Compatibility view over the shared, session-keyed wallet query. The
 * provider owns account/network invalidation and refresh deduplication;
 * forms still choose an explicit target chain for read-only previews.
 * Unsupported target chains remain unavailable rather than showing zero.
 */
export function useWalletTokenBalances(walletAddress?: string, chainId?: number, _identityChainId = chainId): WalletTokenBalanceSnapshot {
  const address = walletAddress?.trim();
  const query = useWalletBalances({ address, chainId: chainId ?? 0, enabled: Boolean(address) && chainId === 1 });
  const refreshBalances = query.refresh;
  const refresh = useCallback(async (force = false) => {
    if (address && chainId === 1) await refreshBalances(force);
  }, [address, chainId, refreshBalances]);
  const balances = useMemo(() => query.data ? balanceMapForResult(query.data) : EMPTY_TOKEN_BALANCES, [query.data]);

  if (!address) return { status: 'idle', balances: EMPTY_TOKEN_BALANCES, refresh };
  if (chainId !== 1) return {
    status: 'unavailable',
    balances: EMPTY_TOKEN_BALANCES,
    reason: 'Switch to Ethereum to view available balances.',
    refresh,
  };
  return {
    status: query.status,
    balances,
    reason: undefined,
    refresh,
  };
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  tone = 'default',
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; sub?: string; ariaLabel?: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  tone?: 'default' | 'sides';
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const activeIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      className={`${styles.formSegmented} segmented ${tone === 'sides' ? 'segmented-sides' : ''} grid grid-flow-col auto-cols-fr p-1`}
      role="radiogroup"
      aria-label={ariaLabel}
      data-thumb=""
      data-index={activeIndex}
      data-active={value}
      style={{ '--seg-count': options.length, '--seg-index': Math.max(activeIndex, 0) } as CSSProperties}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-label={option.ariaLabel ?? option.label}
            aria-checked={active}
            data-value={option.value}
            tabIndex={active ? 0 : -1}
            disabled={!hydrated}
            onClick={() => {
              haptic('selection');
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const current = options.findIndex((item) => item.value === option.value);
              const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
              const next = event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (current + (backwards ? -1 : 1) + options.length) % options.length;
              onChange(options[next].value);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
              buttons?.[next]?.focus();
              haptic('selection');
            }}
            className={`segmented-option glass-press min-h-11 px-2 py-2 text-center transition-colors ${
              active
                ? 'segmented-option-active text-[var(--text)]'
                : 'text-mut'
            }`}
          >
            {option.icon ? (
              <span className="flex items-center justify-center gap-2">
                <span className="market-option-icon" aria-hidden="true">{option.icon}</span>
                <span className="text-[14px] font-semibold">{option.label}</span>
              </span>
            ) : <span className="block text-[14px] font-semibold">{option.label}</span>}
            {option.sub && <span className="mt-0.5 block text-[12px] font-medium opacity-75">{option.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({
  children,
  hint,
  htmlFor,
  hintId,
}: {
  children: ReactNode;
  hint?: string;
  htmlFor?: string;
  hintId?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-mut">{children}</label>
      {hint && <span id={hintId} className="text-[11px] text-[var(--mut-2)]">{hint}</span>}
    </div>
  );
}

export function SlippageField({
  value,
  onChange,
  max,
  inlineHelp = false,
}: {
  value: string;
  onChange: (value: string) => void;
  max: number;
  inlineHelp?: boolean;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const [touched, setTouched] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const pointerTypeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showHelp) return;
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowHelp(false);
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [showHelp]);
  const numeric = Number(value);
  const validSyntax = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
  const error = entryError || (value
    ? (!validSyntax || !Number.isFinite(numeric) || numeric <= 0 || numeric > max
        ? `Enter a slippage tolerance greater than 0% and no more than ${max}%.`
        : null)
    : touched
      ? 'Enter a slippage tolerance.'
      : null);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-[12px] font-medium text-mut">Slippage</label>
        <span className="flex items-center gap-1 text-[11px] text-[var(--mut-2)]">
          <span>Max {max}%</span>
          <span
            className={styles.slippageHelp}
            onPointerEnter={(event) => { if (event.pointerType !== 'touch') setShowHelp(true); }}
            onPointerLeave={(event) => { if (event.pointerType !== 'touch') setShowHelp(false); }}
            onFocus={() => { if (pointerTypeRef.current !== 'touch') setShowHelp(true); }}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setShowHelp(false); }}
          >
            <button
              type="button"
              className={`${styles.slippageHelpButton} glass-press`}
              aria-label="About slippage tolerance"
              aria-describedby={showHelp ? helpId : undefined}
              aria-expanded={showHelp}
              onPointerDown={(event) => { pointerTypeRef.current = event.pointerType; }}
              onClick={(event) => {
                const clickPointerType = 'pointerType' in event.nativeEvent
                  ? event.nativeEvent.pointerType
                  : undefined;
                const isTouch = clickPointerType === 'touch' || pointerTypeRef.current === 'touch';
                setShowHelp((visible) => isTouch ? !visible : true);
                pointerTypeRef.current = null;
              }}
            >
              <Info aria-hidden="true" className="h-4 w-4" />
            </button>
            {showHelp && !inlineHelp && <span id={helpId} role="tooltip" className={styles.slippageHelpPopup}>The transaction can fail if adverse price movement exceeds this tolerance.</span>}
          </span>
        </span>
      </div>
      {showHelp && inlineHelp && <div id={helpId} role="tooltip" className={styles.slippageHelpInline}>The transaction can fail if adverse price movement exceeds this tolerance.</div>}
      <div className={`${styles.formField} field-control flex min-h-[52px] items-center gap-2 px-4 ${error ? 'field-error' : ''}`}>
        <DecimalInput
          id={inputId}
          value={value}
          onValueChange={(next) => { setEntryError(''); onChange(next); }}
          onInvalidInput={(message) => { if (message) { setEntryError(message); onChange(''); } else setEntryError(''); }}
          policy="comma-decimal"
          onBlur={() => setTouched(true)}
          autoComplete="off"
          aria-label="Slippage tolerance percentage"
          aria-invalid={Boolean(error)}
          aria-errormessage={error ? errorId : undefined}
          className="min-h-11 min-w-0 flex-1 bg-transparent font-sans tabular-nums text-[16px] font-semibold outline-none"
        />
        <span className="text-[12px] text-mut">%</span>
      </div>
      {error && <p id={errorId} role="alert" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
}

export { AmountField, AmountFieldView } from './AmountField';
export type { AmountFieldProps, AmountFieldViewProps } from './AmountField';

export function TokenSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
  balances,
  balanceStatus,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  balances?: TokenBalanceMap;
  balanceStatus?: Exclude<WalletTokenBalanceSnapshot['status'], 'idle'> | 'disconnected';
}) {
  const selectId = useId();
  const labelId = `${selectId}-label`;
  const dialogTitleId = `${selectId}-dialog-title`;
  const [open, setOpen] = useState(false);
  const present = useExitPresence(open, selectId);
  const [query, setQuery] = useState('');
  const { prices, status: priceStatus, refresh: refreshPrices } = useUsdPrices();
  const pickerBalances = balances;
  const pickerStatus = balanceStatus;
  const showBalanceColumn = pickerStatus !== 'disconnected' && Boolean(pickerBalances || pickerStatus);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closingRef = useRef(false);
  const filteredOptions = useMemo(() => {
    const normalised = query.trim().toLowerCase();
    if (!normalised) return [...options];
    return options.filter((option) => `${displayTokenSymbol(option)} ${displayTokenName(option)}`.toLowerCase().includes(normalised));
  }, [options, query]);

  const closePicker = () => {
    closingRef.current = true;
    setQuery('');
    setOpen(false);
  };
  const overlayRef = useOverlayDialog<HTMLDivElement>({ open, onClose: closePicker, triggerRef });

  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    const selectedIndex = Math.max(0, filteredOptions.indexOf(value));
    window.requestAnimationFrame(() => {
      if (closingRef.current || !overlayRef.current) return;
      if (options.length > 4) searchRef.current?.focus();
      else optionRefs.current[selectedIndex]?.focus();
    });
    // Search and option changes must not restart the initial-focus routine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (next: T) => {
    haptic('selection');
    onChange(next);
    closePicker();
  };

  const moveFocus = (current: number, direction: 'next' | 'previous' | 'first' | 'last') => {
    const next = direction === 'first'
      ? 0
      : direction === 'last'
        ? filteredOptions.length - 1
        : (current + (direction === 'next' ? 1 : -1) + filteredOptions.length) % filteredOptions.length;
    optionRefs.current[next]?.focus();
  };

  return (
    <div className={compact ? styles.compactTokenSelect : undefined}>
      <span id={labelId} className={compact ? 'sr-only' : 'mb-2 block text-[12px] font-medium text-mut'}>{label}</span>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${selectId}-menu`}
        aria-labelledby={labelId}
        onClick={() => setOpen((current) => {
          if (!current) {
            setQuery('');
            const hasMissingPrice = options.some((option) => {
              const priceKey = priceKeyForSymbol(option);
              return priceKey && prices[priceKey] === undefined;
            });
            if (priceStatus !== 'ready' || hasMissingPrice) void refreshPrices();
          }
          return !current;
        })}
        className={`${compact ? '' : 'field-control'} glass-press flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-semibold text-[var(--text)] outline-none`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <TokenIcon symbol={value} size={26} />
          <span className="truncate">{displayTokenSymbol(value)}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-mut transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {present && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.tokenPickerBackdrop}
          data-state={open ? 'open' : 'closed'}
          inert={!open}
          aria-hidden={!open || undefined}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}
        >
          <div
            ref={overlayRef}
            id={`${selectId}-menu`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className={styles.tokenPickerDialog}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.tokenPickerHeader}>
              <div>
                <p id={dialogTitleId} className={styles.tokenPickerTitle}>{label}</p>
              </div>
              <button type="button" aria-label="Close asset picker" onClick={closePicker} className={`${styles.tokenPickerClose} glass-press`}>×</button>
            </div>
            {options.length > 4 && (
              <label className={styles.tokenPickerSearch}>
                <Search className="h-4 w-4 shrink-0 text-mut" aria-hidden="true" />
                <span className="sr-only">Search assets</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' && filteredOptions.length > 0) {
                      event.preventDefault();
                      optionRefs.current[0]?.focus();
                    }
                  }}
                  placeholder="Search assets"
                  className={styles.tokenPickerSearchInput}
                />
              </label>
            )}
            <div role="listbox" aria-label={`${label} options`} className={styles.tokenPickerList}>
                {filteredOptions.map((option, index) => {
                  const active = option === value;
                  const balanceId = `${selectId}-balance-${index}`;
                  const balanceUsdId = `${balanceId}-usd`;
                  const balance = tokenBalanceFor(pickerBalances ?? EMPTY_TOKEN_BALANCES, option)
                    ?? (pickerStatus ? { status: pickerStatus } : undefined);
                  return (
                  <button
                    key={option}
                    ref={(element) => { optionRefs.current[index] = element; }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-label={`${tokenSymbol(option)} ${tokenName(option)} (${tokenPresentation(option).role})${active ? ' selected' : ''}`}
                    aria-describedby={showBalanceColumn ? `${balanceId} ${balanceUsdId}` : undefined}
                    tabIndex={(filteredOptions.includes(value) ? active : index === 0) ? 0 : -1}
                    onClick={() => choose(option)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index, 'next'); }
                      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index, 'previous'); }
                      else if (event.key === 'Home') { event.preventDefault(); moveFocus(index, 'first'); }
                      else if (event.key === 'End') { event.preventDefault(); moveFocus(index, 'last'); }
                      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); }
                    }}
                    className={`${styles.tokenPickerRow} ${active ? styles.tokenPickerRowActive : ''}`}
                  >
                    <TokenIcon symbol={option} size={30} />
                    <span className={styles.tokenPickerRowCopy}>
                      <span className={styles.tokenPickerSymbol}>{tokenSymbol(option)}</span>
                      <span className={styles.tokenPickerName}>{tokenName(option)}</span>
                    </span>
                    {showBalanceColumn && (
                      <span className={styles.tokenPickerValue}>
                        <span id={balanceId} className={styles.tokenPickerBalance} title={balance?.amount ? `${balance.amount} ${displayTokenSymbol(option)}` : balance?.reason}>
                          {balance?.status === 'ready' && <span className="sr-only">Available: </span>}{optionBalanceLabel(balance, option, pickerStatus)}
                        </span>
                        <span id={balanceUsdId} className={styles.tokenPickerBalanceUsd}>{optionBalanceUsdContent(balance, option, prices)}</span>
                      </span>
                    )}
                    <span className={styles.tokenPickerCheckWrap}>
                      <span className={`${styles.tokenPickerCheck} ${active ? styles.tokenPickerCheckActive : ''}`} aria-hidden="true">{active ? '✓' : ''}</span>
                    </span>
                  </button>
                );
              })}
              {filteredOptions.length === 0 && (
                <div role="status" className="px-4 py-8 text-center">
                  <p className="text-[13px] font-semibold">No matching assets</p>
                  {/* Suggest only what this picker offers: a symbol it does not list would fail too. */}
                  <p className="mt-1 text-[12px] text-mut">Try {listOfSymbols(options.slice(0, 3).map(displayTokenSymbol))}.</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <span className="sr-only" aria-live="polite">{label}: {displayTokenSymbol(value)}</span>
    </div>
  );
}

export function RangeField({
  value,
  onChange,
  min,
  max,
  step = 0.1,
  label,
  suffix = '×',
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
}) {
  const rangeId = useId();
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      <FieldLabel htmlFor={rangeId} hint={`${min}${suffix}–${max}${suffix}`}>{label}</FieldLabel>
      <div className="range-control p-4">
        <div className="mb-3 flex items-end justify-between">
          <span className="text-display text-[26px] font-semibold text-mint">{value.toFixed(value % 1 ? 1 : 0)}{suffix}</span>
        </div>
        <input
          id={rangeId}
          type="range"
          className="lever"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            haptic('selection');
            onChange(Number(event.target.value));
          }}
          style={{ '--fill': `${fill}%` } as React.CSSProperties}
          aria-valuetext={`${value}${suffix}`}
        />
      </div>
    </div>
  );
}

/**
 * Leverage is bounded by the live pool debt-ratio configuration (with a
 * conservative fallback while RPC metadata is unavailable). The SDK remains
 * the final authority when it plans the reviewed route.
 */
export function LeverageField({
  value,
  onChange,
  label = 'Leverage',
  min = 0.1,
  max = 20,
  error,
  compact = false,
  split,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  error?: string | null;
  compact?: boolean;
  /** Names the debt so the slider can say what the chosen leverage means. */
  split?: { side: LeverageSide; debtLabel: string };
}) {
  const inputId = useId();
  const sliderId = `${inputId}-slider`;
  const errorId = `${inputId}-error`;
  const splitId = `${inputId}-split`;
  const invalid = Boolean(error);
  const sliderValue = Math.min(max, Math.max(min, Number.isFinite(value) && value > 0 ? value : min));
  const fill = max === min ? 0 : ((sliderValue - min) / (max - min)) * 100;
  const [leverageDraft, setLeverageDraft] = useState(Number.isFinite(value) ? String(value) : '');
  const [leverageFocused, setLeverageFocused] = useState(false);
  const [leverageInputError, setLeverageInputError] = useState('');
  useEffect(() => {
    if (!leverageFocused && Number.isFinite(value)) {
      setLeverageDraft(String(value));
      setLeverageInputError('');
    }
  }, [leverageFocused, value]);
  useEffect(() => {
    if (!leverageFocused || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(leverageDraft)) return;
    const parsed = Number(leverageDraft);
    if (Number.isFinite(parsed) && parsed > 0 && (parsed < min || parsed > max)) {
      setLeverageInputError(`Enter leverage from ${min}× to ${max}×.`);
      onChange(Number.NaN);
    }
  }, [min, max, leverageFocused, leverageDraft, onChange]);
  const numberInput = (
    <DecimalInput
      id={inputId}
      value={leverageDraft}
      onInvalidInput={(message) => { if (message) { setLeverageDraft(''); setLeverageInputError(message); onChange(Number.NaN); } else setLeverageInputError(''); }}
      onValueChange={(next) => {
        setLeverageDraft(next);
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(next)) {
          setLeverageInputError('Enter leverage using digits and one decimal point.');
          onChange(Number.NaN);
          return;
        }
        const parsed = Number(next);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setLeverageInputError('Enter a leverage greater than 0.');
          onChange(Number.NaN);
          return;
        }
        if (parsed < min || parsed > max) {
          setLeverageInputError(`Enter leverage from ${min}× to ${max}×.`);
          onChange(Number.NaN);
          return;
        }
        setLeverageInputError('');
        onChange(parsed);
      }}
      onFocus={() => setLeverageFocused(true)}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
      onBlur={() => {
        haptic('selection');
        setLeverageFocused(false);
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(leverageDraft)) {
          setLeverageInputError('Enter leverage using digits and one decimal point.');
          onChange(Number.NaN);
          return;
        }
        const parsed = Number(leverageDraft);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setLeverageInputError('Enter a valid leverage greater than 0.');
          onChange(Number.NaN);
          return;
        }
        const normalized = Math.min(max, Math.max(min, parsed));
        setLeverageDraft(String(normalized));
        setLeverageInputError('');
        onChange(normalized);
      }}
      aria-invalid={invalid || Boolean(leverageInputError)}
      aria-describedby={[invalid || leverageInputError ? errorId : null, split ? splitId : null].filter(Boolean).join(' ') || undefined}
      className={`${styles.leverageInput} field-control min-h-[52px] min-w-0 flex-1 px-4 text-[20px] font-semibold outline-none`}
    />
  );
  // Both slider variants use live leverage bounds; the split adds a caption.
  const slider = split ? (
    <LeverageSplitRange
      id={sliderId}
      label={`${label} slider`}
      side={split.side}
      debtLabel={split.debtLabel}
      value={sliderValue}
      leverage={value}
      min={min}
      max={max}
      describedBy={splitId}
      captionId={splitId}
      onChange={onChange}
    />
  ) : (
    <>
      <input
        id={sliderId}
        type="range"
        className="lever"
        min={min}
        max={max}
        step="0.1"
        value={sliderValue}
        aria-label={`${label} slider`}
        aria-valuetext={`${sliderValue.toFixed(1)}×`}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={() => haptic('selection')}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
      />
      <div className="flex items-baseline justify-between gap-2 px-1 text-[11px] font-medium text-mut" data-leverage-bounds>
        <span aria-hidden="true">{min.toFixed(1)}×</span>
        <span aria-hidden="true">{max.toFixed(1)}×</span>
      </div>
    </>
  );
  return (
    <div className={compact ? styles.tradeCompactLeverage : undefined}>
      {compact ? (
        <>
          <div className={styles.tradeCompactLeverageHeader}>
            <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
            <div className={`${styles.rangeField} ${styles.tradeCompactLeverageValue} range-control ${invalid || leverageInputError ? 'field-error' : ''}`}>
              {numberInput}
              <span className="text-display text-[18px] font-semibold text-mint" aria-hidden="true">×</span>
            </div>
          </div>
          <div className={styles.tradeCompactLeverageSlider}>
            {slider}
          </div>
        </>
      ) : (
        <>
          {/* The live range is stated once, at the slider's ends, as on Trade. */}
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
          <div className={`${styles.rangeField} range-control p-3 ${invalid || leverageInputError ? 'field-error' : ''}`}>
            <div className="flex items-center gap-3">
              {numberInput}
              <span className="text-display text-[22px] font-semibold text-mint" aria-hidden="true">×</span>
            </div>
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              {slider}
            </div>
          </div>
        </>
      )}
      {(error || leverageInputError) && <p id={errorId} role="alert" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">{error || leverageInputError}</p>}
    </div>
  );
}

function displayTokenSymbol(symbol: string): string { return tokenSymbol(symbol); }
function displayTokenName(symbol: string): string { return tokenName(symbol); }
/** "ETH", "ETH or WETH", "ETH, WETH, or stETH". */
function listOfSymbols(symbols: readonly string[]): string {
  if (symbols.length < 3) return symbols.join(' or ');
  return `${symbols.slice(0, -1).join(', ')}, or ${symbols[symbols.length - 1]}`;
}

function optionBalanceLabel(balance: TokenBalanceView | undefined, symbol: string, listStatus?: string): ReactNode {
  const display = displayTokenSymbol(symbol);
  if (balance?.status === 'disconnected') return <ValueOrSkeleton value="—" width="sm" status="unavailable" label={balance.reason ?? 'Balance unavailable'} />;
  // A settled balance list without this token never fills in later: say so instead of loading forever.
  if (!balance) return listStatus === 'ready' || listStatus === 'unavailable'
    ? <ValueOrSkeleton value="—" width="sm" status="unavailable" label="Balance unavailable" />
    : <ValueOrSkeleton value="—" width="sm" label="Loading balance" />;
  if (balance.status === 'unavailable') return <ValueOrSkeleton value="—" width="sm" status="unavailable" label={balance.reason ?? 'Balance unavailable'} />;
  if (balance.status === 'loading') return <ValueOrSkeleton value="—" width="sm" label="Loading balance" />;
  if (balance.amount === undefined) return <ValueOrSkeleton value="—" width="sm" label="Loading balance" />;
  // Rounded down, like the field's own Available figure, so a row never shows more than the wallet holds.
  return `${formatBalanceDecimal(balance.amount, 4)} ${display}`;
}

function optionBalanceUsdContent(balance: TokenBalanceView | undefined, symbol: string, prices: UsdPriceMap): ReactNode {
  if (balance?.status === 'disconnected') return 'Connect wallet to see balances';
  if (balance?.status === 'loading') return <span className="skeleton inline-block h-3 w-20 align-middle" aria-label="Loading value" />;
  const cents = usdCentsForTokenBalance(balance, symbol, prices);
  if (balance?.status === 'ready' && cents === null) {
    return <span className="text-warn" aria-label="Price unavailable">Price unavailable</span>;
  }
  if (cents === null) return null;
  // An empty balance is exactly $0.00, and "<$0.01" already says it is approximate: "≈" marks only a priced estimate.
  if (cents === 0n) return /[1-9]/.test(balance?.amount ?? '') ? '<$0.01' : formatUsdCents(0n);
  return `≈ ${formatUsdCents(cents)}`;
}

export function ToggleRow({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic('selection');
        onChange(!checked);
      }}
      className="toggle-row glass-press flex w-full items-center gap-3 p-3.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-mut">{body}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-mint' : 'bg-[rgba(255,255,255,.12)]'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="info-note flex gap-2.5 p-3 text-[12px] leading-relaxed text-mut">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-mint" /> {children}
    </div>
  );
}
