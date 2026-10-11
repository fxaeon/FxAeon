'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check } from 'lucide-react';
import { formatUnits } from 'viem';
import { AppShell, Button, Skeleton } from '@/components/ui';
import { AccountSummary, SessionControl } from '@/components/AccountControls';
import AppearancePreference from '@/components/AppearancePreference';
import { Disclosure, PageHeading, ProductSurface } from '@/components/ProductUI';
import { MissingValue } from '@/components/MissingValue';
import { usePrivyWallet } from '@/lib/wallet';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { useLocale } from '@/lib/i18n';
import { haptic } from '@/lib/telegram';
import { announceSettingsUpdated, GAS_TIERS, readGasTier, readSlippagePercent, SETTINGS_KEY, SLIPPAGE_PRESETS_BPS, type GasTier } from '@/lib/settings';
import { fetchGasTierQuotes, type GasTierQuotes } from '@/lib/fx/gasFeePolicy';
import { createCoalescedRefresh } from '@/lib/coalescedRefresh';
import styles from '@/components/SettingsWorkspace.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';
import { StickyAction } from '@/components/StickyAction';

const WalletSection = dynamic(() => import('@/components/WalletSection'), { ssr: false, loading: () => <Skeleton className="h-24" /> });
const PRESETS: readonly number[] = SLIPPAGE_PRESETS_BPS;

function formatGwei(value: bigint): string {
  const gwei = Number(formatUnits(value, 9));
  return gwei > 0 && gwei < 0.001
    ? '<0.001'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(gwei);
}

export default function SettingsPage() {
  const { t } = useLocale();
  const wallet = usePrivyWallet();
  const providerMode = useWalletProviderMode();
  const showGasSettings = providerMode === 'privy' && (!wallet.address || wallet.isEmbedded);
  const [ready, setReady] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50);
  const [savedBps, setSavedBps] = useState(50);
  const [gasTier, setGasTier] = useState<GasTier>('standard');
  const [savedGasTier, setSavedGasTier] = useState<GasTier>('standard');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [gas, setGas] = useState<GasTierQuotes | null>(null);
  const [gasLoading, setGasLoading] = useState(true);
  const [gasError, setGasError] = useState(false);
  const gasRefreshRef = useRef<ReturnType<typeof createCoalescedRefresh<GasTierQuotes>> | null>(null);
  const id = useId();
  const dirty = slippageBps !== savedBps || (showGasSettings && gasTier !== savedGasTier);
  useEffect(() => {
    const value = Math.round(readSlippagePercent() * 100);
    const tier = readGasTier();
    setGasTier(tier); setSavedGasTier(tier);
    setSlippageBps(value); setSavedBps(value); setReady(true);
  }, []);
  const refreshGas = useCallback(() => {
    void gasRefreshRef.current?.refresh();
  }, []);
  useEffect(() => {
    if (!showGasSettings) return;
    const refresh = createCoalescedRefresh<GasTierQuotes>({
      fetch: () => fetchGasTierQuotes(1),
      onStart: () => { setGasLoading(true); setGasError(false); },
      onSuccess: setGas,
      onError: () => setGasError(true),
      onSettled: () => setGasLoading(false),
    });
    gasRefreshRef.current = refresh;
    refreshGas();
    const refreshVisible = () => { if (document.visibilityState === 'visible') refreshGas(); };
    const timer = setInterval(refreshVisible, 30_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      refresh.dispose();
      if (gasRefreshRef.current === refresh) gasRefreshRef.current = null;
    };
  }, [refreshGas, showGasSettings]);
  const select = (value: number) => { setSlippageBps(value); setSaved(false); setError(''); haptic('selection'); };
  const selectGas = (value: GasTier) => { setGasTier(value); setSaved(false); setError(''); haptic('selection'); };
  const save = () => {
    if (!ready || !dirty) return;
    setError('');
    try {
      // Preserve appearance and any other independently managed preferences.
      let previous: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
      } catch { /* A corrupt old value can be replaced by the selected preference. */ }
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...previous, slippageBps, ...(showGasSettings ? { gasTier } : {}) }));
      announceSettingsUpdated(slippageBps, showGasSettings ? gasTier : undefined);
      setSavedBps(slippageBps); if (showGasSettings) setSavedGasTier(gasTier); setSaved(true); haptic('success');
    } catch {
      setSaved(false);
      setError('This browser blocked local preference storage. Your changes have not been saved. Your wallet and onchain state were not affected.');
      haptic('error');
    }
  };
  return <AppShell>
    <AccountWorkspace className={styles.workspace + ' ' + styles.settingsWorkspace}>
      <PageHeading title={t('settings.title')} backHref="/more" />
      <section className={styles.section} aria-labelledby={`${id}-wallet`}>
        <h2 id={`${id}-wallet`}>Wallet</h2>
        <AccountSummary />
        <div className={styles.walletManagement}><Disclosure title="Change wallet"><WalletSection /></Disclosure></div>
      </section>
      <section className={styles.section} aria-labelledby={`${id}-preferences`}>
        <h2 id={`${id}-preferences`}>Transaction preferences</h2>
        <ProductSurface className={styles.panel}>
          <div className={styles.preferenceHeading}><h3 id={`${id}-slippage`}>Slippage tolerance</h3>
            <span className={saved ? styles.saved : undefined} role="status" aria-live="polite">{saved ? <><Check size={14} aria-hidden="true" />Saved</> : dirty ? 'Unsaved changes' : ''}</span>
          </div>
          <p id={`${id}-help`} className={styles.help}>If the price moves more than this before your transaction confirms, it fails rather than complete at a worse price.</p>
          <div className={styles.choices} role="radiogroup" aria-label={t('settings.maxSlippage')} aria-describedby={`${id}-help`}>
            {PRESETS.map((bps, index) => <button type="button" key={bps} role="radio" aria-checked={slippageBps === bps} disabled={!ready} tabIndex={slippageBps === bps || (!PRESETS.includes(slippageBps) && index === 0) ? 0 : -1}
              onClick={() => select(bps)} onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? PRESETS.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + PRESETS.length) % PRESETS.length;
                select(PRESETS[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}>{bps / 100}%</button>)}
          </div>
          {!PRESETS.includes(slippageBps) && <p className={styles.scope}>Custom {slippageBps / 100}% is set from a form’s settings. Choose a preset to replace it.</p>}
          <p className={styles.scope}>Applies to Trade, Positions and eligible fxSAVE actions, on this device.</p>
          {showGasSettings && <div className={styles.gasPreference}>
            <div className={styles.preferenceHeading}>
              <h3 id={`${id}-gas`}>Gas speed</h3>
              <button type="button" className={styles.refresh} onClick={refreshGas} disabled={gasLoading} aria-label={gasError ? 'Retry gas fees' : 'Refresh gas fees'}>{gasError ? 'Retry' : 'Refresh'}</button>
            </div>
            <p id={`${id}-gas-help`} className={styles.help}>Ethereum · Gwei{gasError && gas ? ' · last update' : ''}</p>
            <div className={`${styles.choices} ${styles.gasChoices}`} role="radiogroup" aria-label="Gas speed" aria-describedby={`${id}-gas-help`}>
              {GAS_TIERS.map((tier, index) => <button type="button" key={tier} role="radio" aria-checked={gasTier === tier} disabled={!ready} tabIndex={gasTier === tier ? 0 : -1}
                onClick={() => selectGas(tier)} onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? GAS_TIERS.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + GAS_TIERS.length) % GAS_TIERS.length;
                  selectGas(GAS_TIERS[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}>
                <span>{tier === 'standard' ? 'Standard' : tier === 'fast' ? 'Fast' : 'Rapid'}</span>
                <span className={styles.gasRate}>{gas ? formatGwei(gas.tiers[tier].gasPriceWei) : <MissingValue width="xs" status={gasLoading ? 'loading' : 'unavailable'} label={`${tier} gas fee ${gasLoading ? 'loading' : 'unavailable'}`} />}</span>
              </button>)}
            </div>
          </div>}
          <StickyAction><Button onClick={save} disabled={!ready || !dirty} className={styles.save}>Save preferences</Button></StickyAction>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </ProductSurface>
      </section>
      <AppearancePreference />
      <div className={styles.disconnect}><SessionControl /></div>
    </AccountWorkspace>
  </AppShell>;
}
