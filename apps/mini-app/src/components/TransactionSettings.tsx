'use client';

import { useEffect, useId, useState, type CSSProperties, type ReactNode, type KeyboardEvent } from 'react';
import { formatUnits } from 'viem';
import { ChevronRight, Fuel, Percent, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { ChainIcon } from '@/components/TokenIcon';
import { SettingsPopover } from '@/components/SettingsPopover';
import { DecimalInput } from '@/components/DecimalInput';
import { MetricLabel } from '@/components/InfoHelp';
import { fetchGasTierQuotes, type GasTierQuotes } from '@/lib/fx/gasFeePolicy';
import { usePrivyWallet } from '@/lib/wallet';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { haptic } from '@/lib/telegram';
import {
  DEFAULT_GAS_TIER, DEFAULT_SLIPPAGE_PERCENT, GAS_TIERS, MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS, SETTINGS_KEY, SETTINGS_UPDATED_EVENT, SLIPPAGE_PRESETS_BPS,
  isSlippageBps, readGasTier, readSlippagePercent, writeTransactionSettings, type GasTier,
} from '@/lib/settings';
import styles from './TransactionSettings.module.css';

const SPEED_LABELS: Record<GasTier, string> = { standard: 'Standard', fast: 'Fast', rapid: 'Rapid' };
const percentNumber = (bps: number) => (bps / 100).toString();
const formatPercent = (bps: number) => `${percentNumber(bps)}%`;
const formatGwei = (wei: bigint) => {
  const gwei = Number(formatUnits(wei, 9));
  if (gwei > 0 && gwei < 0.001) return '<0.001 gwei';
  return `${gwei < 1 ? gwei.toFixed(3) : gwei < 10 ? gwei.toFixed(2) : gwei.toFixed(1)} gwei`;
};

function useStoredSettings() {
  // Match the static HTML on the first client render. Saved preferences are
  // applied by the effect below, after hydration, without replacing the page.
  const [bps, setBps] = useState(Math.round(DEFAULT_SLIPPAGE_PERCENT * 100));
  const [tier, setTier] = useState<GasTier>(DEFAULT_GAS_TIER);
  useEffect(() => {
    const sync = (event: Event) => {
      if (event.type === 'storage' && (event as StorageEvent).key !== SETTINGS_KEY) return;
      setBps(Math.round(readSlippagePercent() * 100));
      setTier(readGasTier());
    };
    sync(new Event(SETTINGS_UPDATED_EVENT));
    window.addEventListener(SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return { bps, tier };
}

/**
 * The one transaction-settings gear every action form carries, in the same
 * place: max slippage where a route converts assets, and network speed. It is
 * quiet at the defaults and shows a chip once something differs. Changes save
 * at once and reach every open form and review.
 */
export function TransactionSettings({ slippage = false, slippagePercent, onSlippageChange, chainId = 1, children, scope, presentation = 'icon' }: {
  presentation?: 'icon' | 'row';
  scope?: string;
  chainId?: 1 | 8453;
  children?: ReactNode;
  slippage?: boolean;
  /** A restored form can differ from the saved preference. Show its actual input. */
  slippagePercent?: string;
  onSlippageChange?: (percent: string) => void;
}) {
  const { bps: storedBps, tier } = useStoredSettings();
  const wallet = usePrivyWallet();
  const providerMode = useWalletProviderMode();
  const walletSetsFees = providerMode === 'browser' || (Boolean(wallet.address) && !wallet.isEmbedded);
  if (!slippage && walletSetsFees && !children) return null;
  // Keep a restored form's exact display text. Round-tripping through basis
  // points can turn 0.101% into 0.10100000000000002%.
  const percent = slippagePercent ?? percentNumber(storedBps);
  const summary = slippage ? `${percent}% slippage` : walletSetsFees ? 'Custom bridge settings' : `${SPEED_LABELS[tier]} speed`;
  const changes = [
    slippage && Number(percent) !== DEFAULT_SLIPPAGE_PERCENT ? `${percent}% slippage` : null,
    !walletSetsFees && tier !== DEFAULT_GAS_TIER ? SPEED_LABELS[tier] : null,
  ].filter(Boolean);
  return <SettingsPopover title={scope ? `${scope} settings` : 'Transaction settings'} summary={summary} chip={changes.length ? changes.join(' · ') : null}
    placement={presentation === 'row' ? 'center' : 'anchor'}
    triggerClassName={presentation === 'row' ? styles.rowTrigger : undefined}
    triggerContent={presentation === 'row' ? <><SlidersHorizontal size={20} aria-hidden="true" /><span className={styles.rowCopy}><strong>Transaction settings</strong></span><span className={styles.rowValue}>{slippage ? `${percent}%` : SPEED_LABELS[tier]}</span><ChevronRight size={18} aria-hidden="true" /></> : undefined}>
    <div className={styles.context}><ChainIcon chainId={chainId} size={18} /><span>{chainId === 8453 ? 'Base' : 'Ethereum'}</span>{!walletSetsFees && <><span>·</span><span>App-managed fees</span></>}</div>
    <TransactionSettingsPanel chainId={chainId} slippage={slippage} percent={percent} tier={tier} walletSetsFees={walletSetsFees} controlledSlippage={slippagePercent !== undefined} onSlippageChange={onSlippageChange} />
    {children}
  </SettingsPopover>;
}

function TransactionSettingsPanel({ slippage, percent, tier, walletSetsFees, controlledSlippage, onSlippageChange, chainId }: {
  chainId: 1 | 8453;
  slippage: boolean; percent: string; tier: GasTier; walletSetsFees: boolean; controlledSlippage: boolean; onSlippageChange?: (percent: string) => void;
}) {
  const id = useId();
  // Show the current form value (or saved default); hold edits while focused.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [gas, setGas] = useState<GasTierQuotes | null>(null);
  const [gasStatus, setGasStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [inputError, setInputError] = useState('');
  const [saveError, setSaveError] = useState('');
  const presetIndex = SLIPPAGE_PRESETS_BPS.findIndex((value) => value / 100 === Number(percent));


  useEffect(() => {
    if (walletSetsFees) return;
    let active = true;
    let inFlight = false;
    const load = () => {
      if (inFlight || document.visibilityState === 'hidden' || !navigator.onLine) return;
      inFlight = true; setGas(null); setGasStatus('loading');
      void fetchGasTierQuotes(chainId).then((quotes) => { if (active) { setGas(quotes); setGasStatus('ready'); } })
        .catch(() => { if (active) setGasStatus('unavailable'); })
        .finally(() => { inFlight = false; });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [walletSetsFees, chainId]);

  const navigateRadios = (event: KeyboardEvent<HTMLButtonElement>, index: number, count: number, select: (index: number) => void) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
      : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + count) % count;
    select(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  const choosePreset = (value: number) => {
    haptic('selection');
    setDraft(null); setError(''); setInputError('');
    if (writeTransactionSettings({ slippageBps: value })) { setSaveError(''); onSlippageChange?.(percentNumber(value)); }
    else setSaveError('This browser could not save the setting. Your previous value is still active.');
  };
  const commit = () => {
    if (draft === null) return;
    // An untouched restored value is not a new saved preference. It can
    // legitimately have finer precision than the settings editor permits.
    if (controlledSlippage && draft === percent) { setDraft(null); setError(''); return; }
    const text = draft.replace(',', '.');
    const value = Math.round(Number(text) * 100);
    if (!/^\d*\.?\d+$/.test(text) || !isSlippageBps(value) || Math.abs(Number(text) * 100 - value) > 1e-9) {
      setDraft(null);
      setError(`Enter ${formatPercent(MIN_SLIPPAGE_BPS)} to ${formatPercent(MAX_SLIPPAGE_BPS)} in steps of 0.01%.`);
      return;
    }
    setError(''); setInputError(''); setDraft(null);
    if (writeTransactionSettings({ slippageBps: value })) { setSaveError(''); onSlippageChange?.(percentNumber(value)); }
    else setSaveError('This browser could not save the setting. Your previous value is still active.');
  };
  const chooseTier = (value: GasTier) => {
    haptic('selection');
    setSaveError(writeTransactionSettings({ gasTier: value }) ? '' : 'This browser could not save the setting. Your previous value is still active.');
  };
  const canReset = (slippage && Number(percent) !== DEFAULT_SLIPPAGE_PERCENT) || (!walletSetsFees && tier !== DEFAULT_GAS_TIER);
  const reset = () => {
    const bps = Math.round(DEFAULT_SLIPPAGE_PERCENT * 100);
    if (!writeTransactionSettings({ ...(slippage ? { slippageBps: bps } : {}), ...(!walletSetsFees ? { gasTier: DEFAULT_GAS_TIER } : {}) })) {
      setSaveError('This browser could not save the setting. Your previous values are still active.'); return;
    }
    setSaveError(''); setDraft(null); setError(''); setInputError('');
    if (slippage) onSlippageChange?.(percentNumber(bps));
    haptic('selection');
  };

  return <div className={styles.panel}>
    {slippage && <section className={styles.section} aria-labelledby={`${id}-slippage`}>
      <div className={styles.heading}>
        <h3 id={`${id}-slippage`}><Percent size={17} aria-hidden="true" /><MetricLabel label="Max slippage" definition="maxSlippage" /></h3>
        <span className={styles.value}>{percent}%</span>
      </div>
      <p className={styles.help} id={`${id}-slippage-help`}>Reverts if price moves beyond the displayed slippage limit before confirmation.</p>
      <div className={styles.choices} role="radiogroup" aria-labelledby={`${id}-slippage`} data-thumb={presetIndex >= 0 || undefined}
        style={{ '--seg-index': Math.max(presetIndex, 0), '--seg-count': SLIPPAGE_PRESETS_BPS.length } as CSSProperties}>
        {SLIPPAGE_PRESETS_BPS.map((value, index) => <button key={value} type="button" role="radio" aria-checked={value / 100 === Number(percent)}
          tabIndex={index === Math.max(presetIndex, 0) ? 0 : -1}
          onKeyDown={event => navigateRadios(event, index, SLIPPAGE_PRESETS_BPS.length, next => choosePreset(SLIPPAGE_PRESETS_BPS[next]))}
          onClick={() => choosePreset(value)}>{formatPercent(value)}</button>)}
      </div>
      <label data-focus-field className={styles.custom} data-active={presetIndex < 0 || undefined} data-invalid={Boolean(error || inputError) || undefined}>
        <span>Custom</span>
        <DecimalInput enterKeyHint="done" autoComplete="off" value={draft ?? percent} aria-label="Slippage tolerance percentage" policy="comma-decimal"
          aria-describedby={`${id}-slippage-help`} aria-invalid={Boolean(error || inputError)}
          onFocus={() => setDraft(percent)} onInvalidInput={(message) => { if (message) { setDraft(''); setInputError(message); } else setInputError(''); }}
          onValueChange={(next) => {
            setDraft(next); setError(''); setInputError('');
          }}
          onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } }} />
        <span aria-hidden="true">%</span>
      </label>
      {(inputError || error) && <p className={styles.error} role="alert">{inputError || error}</p>}
    </section>}
    {!walletSetsFees && <section className={styles.section} aria-labelledby={`${id}-speed`}>
      <div className={styles.heading}>
        <h3 id={`${id}-speed`}><Fuel size={17} aria-hidden="true" /><MetricLabel label="Network speed" definition="networkSpeed" /></h3>
        <span className={styles.value}>{SPEED_LABELS[tier]}</span>
      </div>
      <p className={styles.help}>Gas prices in gwei on {chainId === 8453 ? 'Base' : 'Ethereum'}.</p>
      <div className={styles.speeds} role="radiogroup" aria-labelledby={`${id}-speed`} data-thumb=""
        style={{ '--seg-index': GAS_TIERS.indexOf(tier), '--seg-count': GAS_TIERS.length } as CSSProperties}>
        {GAS_TIERS.map((value, index) => <button key={value} type="button" role="radio" aria-checked={tier === value} onClick={() => chooseTier(value)}
          tabIndex={tier === value ? 0 : -1} onKeyDown={event => navigateRadios(event, index, GAS_TIERS.length, next => chooseTier(GAS_TIERS[next]))}>
          <span>{SPEED_LABELS[value]}</span>
          <small>{gas ? formatGwei(gas.tiers[value].gasPriceWei) : gasStatus === 'loading' ? <span className={`${styles.rateSkeleton} skeleton`} aria-label="Loading fee" /> : '—'}</small>
        </button>)}
      </div>
      {gasStatus === 'unavailable' && <p className={styles.help}>Live gas rates are unavailable. The fee will be checked again at review.</p>}
    </section>}
    {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    {(slippage || !walletSetsFees) && <div className={styles.preferenceFooter}>
      <span>Changes save on this device.</span>
      <button type="button" disabled={!canReset} onClick={reset}><RotateCcw size={14} aria-hidden="true" />Reset defaults</button>
    </div>}
  </div>;
}
