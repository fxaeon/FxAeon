'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpDown } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { DecimalInput } from '@/components/DecimalInput';
import { useUsdPrices } from '@/components/PriceProvider';
import { ValueOrSkeleton } from '@/components/MissingValue';
import type { TokenBalanceView } from '@/components/wallet-balance-cache';
import { calculateFractionDecimal, compareExactDecimals, decimalInputError, formatBalanceDecimal, positiveDecimal, tokenAmountForUsd, usdEntryForToken } from '@/lib/amount';
import { useAmountUnit } from '@/lib/amountUnit';
import { formatUsd, formatUsdPrice, priceKeyForSymbol, usdValueForDecimal } from '@/lib/prices';
import { ASSET_PRICE_MAX_AGE_MS } from '@/lib/walletAssets';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { compactAmountEntry } from '@/lib/amountEntryPresentation';
import { haptic } from '@/lib/telegram';
import styles from './AmountField.module.css';

export type AmountFieldProps = {
  value: string; onChange: (value: string) => void; symbol: string; label: string;
  /** Visual context for a compact field; the plain label remains its input name. */
  labelContent?: ReactNode;
  hint?: string; balance?: string | null; balanceState?: TokenBalanceView;
  allowAll?: boolean; allowZero?: boolean; showPercentages?: boolean; showMax?: boolean;
  /** Keep unavailable presets visible, or hide the group; omitted uses wallet-aware visibility. */
  showShortcuts?: boolean;
  showUsdValue?: boolean; showUnitPrice?: boolean; compact?: boolean; disabled?: boolean;
  maxDecimals?: number; placeholder?: string; constraintError?: string | null;
  /** null means a route-aware maximum must be resolved before use. */
  maxAmount?: string | null; onMax?: () => void | Promise<void>; maxPending?: boolean;
  /** Name an explicit route-owned maximum instead of a wallet balance. */
  maxLabel?: string;
  tokenSelector?: ReactNode;
  inputPolicy?: 'dot-decimal' | 'comma-decimal';
};

export type AmountFieldViewProps = AmountFieldProps & { unitPrice?: number; priceStatus?: 'loading' | 'ready' | 'unavailable' };

/** One input for Trade, Earn, Borrow and Move. Shortcuts never round-trip
 * through USD; native-token maxima remain owned by the route/gas planner.
 * Tapping the value line switches entry to US dollars (as on Jumper): the
 * dollars typed are converted down to a token amount, which the form keeps,
 * reviews and signs. */
/** Connected convenience wrapper. Provider access stays at this boundary. */
export function AmountField(props: AmountFieldProps) {
  const quote = useUsdPrices();
  const key = priceKeyForSymbol(props.symbol);
  const timestamp = key ? quote.updatedAts?.[key] ?? quote.updatedAt : null;
  const candidate = key ? quote.prices[key] : undefined;
  const now = Date.now();
  const unitPrice = typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    && typeof timestamp === 'number' && timestamp > 0 && timestamp <= now + 30_000
    && now - timestamp <= ASSET_PRICE_MAX_AGE_MS ? candidate : undefined;
  return <AmountFieldView {...props} unitPrice={unitPrice} priceStatus={quote.status === 'loading' ? 'loading' : unitPrice ? 'ready' : 'unavailable'} />;
}

/**
 * No form element wraps an action editor, so Enter in its amount asks for the
 * form's own primary action (Review, or Connect wallet), as a submit would. A
 * disabled action already names what is missing; Enter then does nothing.
 */
function submitNearestAction(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  for (let scope = event.currentTarget.parentElement; scope; scope = scope.parentElement) {
    const action = scope.querySelector<HTMLButtonElement>('.reviewTrigger button');
    if (!action) continue;
    if (!action.disabled) {
      event.preventDefault();
      action.click();
    }
    return;
  }
}

/** Provider-independent field view for isolated use and component testing. */
export function AmountFieldView({ value, onChange, symbol, label, labelContent, hint, balance, balanceState,
  allowAll = false, allowZero = false, showPercentages = true, showMax = true, showShortcuts,
  showUsdValue = true, showUnitPrice = false, compact = false, disabled = false,
  maxDecimals = 18, placeholder = '0.00', constraintError, maxAmount, onMax,
  maxPending = false, maxLabel, tokenSelector, inputPolicy = 'dot-decimal', unitPrice: price, priceStatus = 'unavailable',
}: AmountFieldViewProps) {
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  const [maxError, setMaxError] = useState('');
  const [entryError, setEntryError] = useState('');
  const [entryExpanded, setEntryExpanded] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => { setMaxError(''); setEntryError(''); setEntryExpanded(false); }, [symbol]);
  // An explicit unavailable state always wins over a legacy balance prop.
  const available = balanceState ? balanceState.status === 'ready' ? balanceState.amount ?? null : null : balance;
  const entered = value.trim();
  // Keep the whole-balance sentinel internal. Show the exact balance when it
  // is known; an unavailable balance remains visibly empty instead of showing
  // a non-numeric sentinel or implying a guessed amount.
  const displayValue = allowAll && entered.toLowerCase() === 'all' ? available ?? '' : value;
  const preview = compactAmountEntry(displayValue, maxDecimals);
  useEffect(() => { if (displayValue.length <= 12) setEntryExpanded(false); }, [displayValue]);
  // "all" spends the whole balance, so it is worth what the balance is worth.
  const worthOf = allowAll && entered.toLowerCase() === 'all' ? available ?? '' : entered;
  const worth = worthOf && !decimalInputError(worthOf, maxDecimals, { allowZero: true }) ? usdValueForDecimal(worthOf, price) : null;
  // Nothing entered is exactly $0.00; "≈" marks only a priced estimate, and "<$0.01" already says it is approximate.
  const usd = /^[0.]*$/.test(entered) ? '$0.00' : worth === null ? null : worth > 0 && worth < 0.01 ? formatUsd(worth) : `≈ ${formatUsd(worth)}`;
  // Dollar entry needs a fresh price; without one the field stays in tokens.
  const [unit, toggleUnit] = useAmountUnit();
  const usdEntry = unit === 'usd' && showUsdValue && Boolean(price);
  const [usdDraft, setUsdDraft] = useState('');
  // The token amount this field last derived from typed dollars. Any other
  // change (a shortcut, Max, a reset) redraws the dollars from the tokens.
  const derived = useRef<string | null>(null);
  useEffect(() => {
    if (!usdEntry || !price) return;
    if (derived.current !== null && derived.current === worthOf) return;
    derived.current = null;
    setUsdDraft(worthOf ? usdEntryForToken(worthOf, price) : '');
  }, [usdEntry, worthOf, price]);
  const hasBalance = Boolean(available && positiveDecimal(available, maxDecimals));
  const maximum = maxAmount === null ? null : maxAmount ?? available;
  const hasMaximum = Boolean(maximum && positiveDecimal(maximum, maxDecimals));
  const exceedsBalance = Boolean(available && value && compareExactDecimals(value, available, maxDecimals) === 1);
  // An empty field is not an error: the form's action already says "Enter an amount",
  // so leaving the field (to pick an asset, say) never paints it red.
  const error = (entryError || decimalInputError(value, maxDecimals, { allowAll, allowZero })) ?? constraintError
    ?? (!exceedsBalance ? null : hasBalance
      ? `Amount exceeds your available ${formatBalanceDecimal(available!, 8)} ${tokenSymbol(symbol)}. Enter less${showMax ? ' or use Max' : ''}.`
      : `This wallet has no ${tokenSymbol(symbol)}. Add some${tokenSelector ? ' or choose another asset' : ''} to continue.`);
  const showBalance = balanceState?.status !== 'disconnected' && (balance !== undefined || balanceState !== undefined);
  const canUseMax = allowAll ? hasBalance : hasMaximum || (maxAmount === null && hasBalance);
  const percentagesVisible = showShortcuts !== false && showPercentages && (showShortcuts === true || balanceState?.status !== 'disconnected');
  const maxVisible = showShortcuts !== false && showMax && (showShortcuts === true || balanceState?.status !== 'disconnected' || typeof maxAmount === 'string');
  const hasShortcuts = percentagesVisible || maxVisible;
  const isMax = allowAll ? value.toLowerCase() === 'all' : Boolean(maximum && hasMaximum && compareExactDecimals(value, maximum, maxDecimals) === 0);
  const describedBy = [hint && `${id}-hint`, showBalance && `${id}-balance`, error && `${id}-error`, maxError && `${id}-max-error`].filter(Boolean).join(' ') || undefined;
  const inactive = disabled || !hydrated;
  const change = (next: string) => { setMaxError(''); setEntryError(''); onChange(next); };
  const changeUsd = (next: string) => {
    // Dollars carry cents at most; a further digit is ignored, as in a till.
    if (/\.\d{3,}$/.test(next) || !price) return;
    setUsdDraft(next);
    const tokens = next ? tokenAmountForUsd(next, price, maxDecimals) : '';
    derived.current = tokens;
    change(tokens);
  };
  const entryValue = usdEntry ? usdDraft : displayValue;
  const tokenWorth = `${worthOf && !decimalInputError(worthOf, maxDecimals, { allowZero: true }) ? formatBalanceDecimal(worthOf, 8) : '0'} ${tokenSymbol(symbol)}`;
  const switchUnit = () => { haptic('selection'); toggleUnit(); };
  const chooseMax = async () => {
    haptic('selection'); setMaxError(''); setEntryError('');
    if (allowAll) { change('all'); return; }
    // The route owner can apply a fresh verified maximum immediately or
    // prepare one. The field never substitutes the unreserved native balance.
    if (onMax) {
      try { await onMax?.(); } catch { setMaxError('The spendable maximum could not be checked. Try again.'); }
      return;
    }
    const next = maximum ? calculateFractionDecimal(maximum, 100, maxDecimals) : null;
    if (next) change(next);
  };
  return <div className={styles.field} data-amount-field="unified" data-compact={compact || undefined}>
    <div className={`${styles.surface} amount-control`} data-focus-field data-invalid={Boolean(error) || undefined}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{labelContent ?? label}</label>
      {hasShortcuts && <div role="group" aria-label={`${label} shortcuts`} className={styles.shortcuts}>
        {percentagesVisible && [25, 50, 75].map((percent) => <button key={percent} type="button" disabled={inactive || !hasBalance} onClick={() => {
          haptic('selection'); const next = calculateFractionDecimal(available, percent, maxDecimals); if (next) change(next);
        }}><span>{percent}%</span></button>)}
        {maxVisible && <button type="button" onClick={() => void chooseMax()} disabled={inactive || !canUseMax || maxPending || !allowAll && maxAmount === null && !onMax}
          aria-busy={maxPending || undefined} aria-label={maxLabel ?? (allowAll ? 'Use all' : onMax ? 'Calculate 100% after gas reserve' : 'Use 100% of available balance')}
          title={onMax ? 'Reserve network fees before using the maximum' : undefined} data-selected={isMax || undefined}><span>Max{maxPending && <span className={styles.maxSpinner} aria-hidden="true" />}</span></button>}
      </div>}
      </div>
      {hint && <span className={styles.meta} id={`${id}-hint`}>{hint}</span>}
      <div className={styles.entryRow}>
        <span className={styles.entryFit} data-amount-unit={usdEntry ? 'usd' : undefined} data-amount-preview={preview && !usdEntry ? '' : undefined} data-amount-expanded={!usdEntry && entryExpanded && displayValue.length > 12 ? '' : undefined} data-amount-long={!usdEntry && displayValue.length > 12 ? '' : undefined}
          style={{ '--amount-entry-length': Math.max(entryValue.length, placeholder.length, 1) + (usdEntry ? 1 : 0) } as CSSProperties}>
        {usdEntry && <span className={styles.currency} aria-hidden="true">$</span>}
        <DecimalInput id={id} value={entryValue} onValueChange={usdEntry ? changeUsd : next => { if (next.length > 12) setEntryExpanded(true); change(next); }} onInvalidInput={setEntryError} policy={usdEntry ? 'dot-decimal' : inputPolicy}
          title={preview && !usdEntry ? displayValue : undefined}
          onFocus={() => { if (!usdEntry && displayValue.length > 12) setEntryExpanded(true); }}
          onKeyDown={submitNearestAction} disabled={inactive} autoComplete="off" spellCheck={false} placeholder={usdEntry ? '0' : placeholder} maxLength={100}
          aria-label={usdEntry ? `${label} in US dollars` : `${label} in ${tokenSymbol(symbol)}`} aria-describedby={describedBy} aria-invalid={Boolean(error)} aria-errormessage={error ? `${id}-error` : undefined} required={!allowZero} />
        {preview && !usdEntry && <span className={styles.entryPreview} aria-hidden="true" style={{ '--amount-preview-length': preview.length } as CSSProperties}>{preview}</span>}
        </span>
        <div className={styles.token}>{tokenSelector ?? <span className={styles.tokenLabel} title={tokenSymbol(symbol)}><TokenIcon symbol={symbol} size={24} /><span>{tokenSymbol(symbol)}</span></span>}</div>
      </div>
      {(showUsdValue || showBalance) && <div className={styles.usd} data-amount-usd>
        {showUsdValue && <span>{usd !== null && price
          ? <button type="button" className={styles.unitToggle} onClick={switchUnit} disabled={!hydrated} data-unit-swap={usdEntry ? 'token' : 'usd'}>
            <span>{usdEntry ? tokenWorth : usd}</span><ArrowUpDown aria-hidden="true" />
            <span className="sr-only">{usdEntry ? `, enter the amount in ${tokenSymbol(symbol)}` : ', enter the amount in US dollars'}</span>
          </button>
          : usd ?? <ValueOrSkeleton value="—" width="sm" status={priceStatus === 'loading' ? 'loading' : 'unavailable'} label={priceStatus === 'loading' ? 'Loading USD value' : 'USD value unavailable'} />}</span>}
        {showBalance && <span className={styles.balance} id={`${id}-balance`} title={balanceState?.reason ?? (available ? `${available} ${tokenSymbol(symbol)}` : 'Balance unavailable')}>
          Available: <strong><ValueOrSkeleton value={available != null ? `${formatBalanceDecimal(available, 8)} ${tokenSymbol(symbol)}` : '—'} width="sm"
            status={balanceState?.status === 'loading' || !balanceState && available == null ? 'loading' : 'unavailable'} label="Available balance" /></strong>
        </span>}
        {showUnitPrice && price && <span>{formatUsdPrice(price)} / {tokenSymbol(symbol)}</span>}
      </div>}
    </div>
    {error && <p id={`${id}-error`} role="alert" className={styles.error}>{error}</p>}
    {maxError && <p id={`${id}-max-error`} role="status" className={styles.error}>{maxError}</p>}
  </div>;
}
