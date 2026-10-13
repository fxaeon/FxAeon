'use client';

import { useEffect, useId, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { formatUnits } from 'viem';
import { ChevronRight } from 'lucide-react';
import { SettingsPopover } from '@/components/SettingsPopover';
import { DecimalInput } from '@/components/DecimalInput';
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
  return `${gwei < 1 ? gwei.toFixed(3) : gwei < 10 ? gwei.toFixed(2) : gwei.toFixed(1)} gwei`;
};

function useStoredSettings() {
  const [bps, setBps] = useState(() => Math.round(readSlippagePercent() * 100));
  const [tier, setTier] = useState<GasTier>(readGasTier);
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
export function TransactionSettings({ slippage = false, slippagePercent, onSlippageChange }: {
  slippage?: boolean;
  /** A restored form can differ from the saved preference. Show its actual input. */
  slippagePercent?: string;
  onSlippageChange?: (percent: string) => void;
}) {
  const { bps: storedBps, tier } = useStoredSettings();
  const wallet = usePrivyWallet();
  const providerMode = useWalletProviderMode();
  const walletSetsFees = providerMode === 'browser' || (Boolean(wallet.address) && !wallet.isEmbedded);
  if (!slippage && walletSetsFees) return null;
  // Keep a restored form's exact display text. Round-tripping through basis
  // points can turn 0.101% into 0.10100000000000002%.
  const percent = slippagePercent ?? percentNumber(storedBps);
  const summary = slippage ? `${percent}% slippage` : walletSetsFees ? 'Fees set in wallet' : `${SPEED_LABELS[tier]} speed`;
  const changes = [
    slippage && Number(percent) !== DEFAULT_SLIPPAGE_PERCENT ? `${percent}% slippage` : null,
    !walletSetsFees && tier !== DEFAULT_GAS_TIER ? SPEED_LABELS[tier] : null,
  ].filter(Boolean);
  return <SettingsPopover summary={summary} chip={changes.length ? changes.join(' · ') : null}>
    <TransactionSettingsPanel slippage={slippage} percent={percent} tier={tier} walletSetsFees={walletSetsFees} controlledSlippage={slippagePercent !== undefined} onSlippageChange={onSlippageChange} />
  </SettingsPopover>;
}

function TransactionSettingsPanel({ slippage, percent, tier, walletSetsFees, controlledSlippage, onSlippageChange }: {
  slippage: boolean; percent: string; tier: GasTier; walletSetsFees: boolean; controlledSlippage: boolean; onSlippageChange?: (percent: string) => void;
}) {
  const id = useId();
  // Show the current form value (or saved default); hold edits while focused.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [gas, setGas] = useState<GasTierQuotes | null>(null);
  const [gasStatus, setGasStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [inputError, setInputError] = useState('');
  const presetIndex = SLIPPAGE_PRESETS_BPS.findIndex((value) => value / 100 === Number(percent));


  useEffect(() => {
    if (walletSetsFees) return;
    let active = true;
    setGas(null);
    setGasStatus('loading');
    void fetchGasTierQuotes(1).then((quotes) => { if (active) { setGas(quotes); setGasStatus('ready'); } })
      .catch(() => { if (active) setGasStatus('unavailable'); });
    return () => { active = false; };
  }, [walletSetsFees]);

  const choosePreset = (value: number) => {
    haptic('selection');
    setDraft(null); setError(''); setInputError('');
    if (writeTransactionSettings({ slippageBps: value })) onSlippageChange?.(percentNumber(value));
  };
  const commit = () => {
    if (draft === null) return;
    // An untouched restored value is not a new saved preference. It can
    // legitimately have finer precision than the settings editor permits.
    if (controlledSlippage && draft === percent) { setError(''); return; }
    const text = draft.replace(',', '.');
    const value = Math.round(Number(text) * 100);
    if (!/^\d*\.?\d+$/.test(text) || !isSlippageBps(value) || Math.abs(Number(text) * 100 - value) > 1e-9) {
      setError(`Enter ${formatPercent(MIN_SLIPPAGE_BPS)} to ${formatPercent(MAX_SLIPPAGE_BPS)} in steps of 0.01%.`);
      return;
    }
    setError(''); setInputError(''); setDraft(null);
    if (writeTransactionSettings({ slippageBps: value })) onSlippageChange?.(percentNumber(value));
  };
  const chooseTier = (value: GasTier) => {
    haptic('selection');
    writeTransactionSettings({ gasTier: value });
  };

  return <div className={styles.panel}>
    {slippage && <section className={styles.section} aria-labelledby={`${id}-slippage`}>
      <div className={styles.heading}>
        <h3 id={`${id}-slippage`}>Max slippage</h3>
        <span className={styles.value}>{percent}%</span>
      </div>
      <p className={styles.help} id={`${id}-slippage-help`}>The transaction reverts if price moves past this limit before confirmation.</p>
      <div className={styles.choices} role="radiogroup" aria-labelledby={`${id}-slippage`} data-thumb={presetIndex >= 0 || undefined}
        style={{ '--seg-index': Math.max(presetIndex, 0), '--seg-count': SLIPPAGE_PRESETS_BPS.length } as CSSProperties}>
        {SLIPPAGE_PRESETS_BPS.map((value) => <button key={value} type="button" role="radio" aria-checked={value / 100 === Number(percent)}
          onClick={() => choosePreset(value)}>{formatPercent(value)}</button>)}
      </div>
      <label className={styles.custom} data-active={presetIndex < 0 || undefined} data-invalid={Boolean(error || inputError) || undefined}>
        <span>Custom</span>
        <DecimalInput enterKeyHint="done" autoComplete="off" value={draft ?? percent} aria-label="Slippage tolerance percentage" policy="comma-decimal"
          aria-describedby={`${id}-slippage-help`} aria-invalid={Boolean(error || inputError)}
          onFocus={() => setDraft(percent)} onInvalidInput={(message) => { if (message) { setDraft(''); setInputError(message); onSlippageChange?.(''); } else setInputError(''); }}
          onValueChange={(next) => {
            setDraft(next); setError(''); setInputError('');
            const text = next.replace(',', '.');
            const bps = Math.round(Number(text) * 100);
            const valid = /^\d*\.?\d+$/.test(text) && isSlippageBps(bps) && Math.abs(Number(text) * 100 - bps) <= 1e-9;
            onSlippageChange?.(valid ? next : '');
          }}
          onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } }} />
        <span aria-hidden="true">%</span>
      </label>
      {(inputError || error) && <p className={styles.error} role="alert">{inputError || error}</p>}
    </section>}
    <section className={styles.section} aria-label={walletSetsFees ? 'Network fee' : undefined} aria-labelledby={!walletSetsFees ? `${id}-speed` : undefined}>
      {walletSetsFees ? <p className={`${styles.help} ${styles.walletFeeNote}`}>Confirm the network fee in your wallet before signing.</p> : <>
      <div className={styles.heading}>
        <h3 id={`${id}-speed`}>Network speed</h3>
        <span className={styles.value}>{SPEED_LABELS[tier]}</span>
      </div>
      <p className={styles.help}>Faster speeds pay a higher priority fee so the transaction is included sooner.</p>
      <div className={styles.speeds} role="radiogroup" aria-labelledby={`${id}-speed`} data-thumb=""
        style={{ '--seg-index': GAS_TIERS.indexOf(tier), '--seg-count': GAS_TIERS.length } as CSSProperties}>
        {GAS_TIERS.map((value) => <button key={value} type="button" role="radio" aria-checked={tier === value} onClick={() => chooseTier(value)}>
          <span>{SPEED_LABELS[value]}</span>
          <small>{gas ? formatGwei(gas.tiers[value].gasPriceWei) : gasStatus === 'loading' ? <span className={`${styles.rateSkeleton} skeleton`} aria-label="Loading fee" /> : '—'}</small>
        </button>)}
      </div>
      </>}
    </section>
    <Link href="/settings" className={styles.more}>All settings<ChevronRight aria-hidden="true" /></Link>
  </div>;
}
