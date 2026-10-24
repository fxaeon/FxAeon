'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { formatEther, formatUnits, isAddress, type Address } from 'viem';
import { ArrowLeft, ChevronRight, Clock3, Wallet } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { DecimalInput } from '@/components/DecimalInput';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
import { GroupedAddress } from '@/components/GroupedAddress';
import { WalletAvatar } from '@/components/WalletAvatar';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { useWalletAssets } from '@/components/WalletDataProvider';
import { useWalletDemand } from '@/components/WalletDemandProvider';
import { usePrivyWallet } from '@/lib/wallet';
import { prepareWalletSend, prepareWalletSendMax, type SendInput, type SendQuote } from '@/lib/walletSend';
import { useNativeMax } from '@/lib/fx/useNativeMax';
import { recordPendingHash } from '@/lib/fx/journal';
import { withWalletChainLock } from '@/lib/fx/lock';
import { readGasTier, SETTINGS_KEY, SETTINGS_UPDATED_EVENT, type GasTier } from '@/lib/settings';
import { userSafeError } from '@/lib/errors';
import { canonicalAsset } from '@/lib/walletAssets';
import { decimalInputError, decimalToUnits, formatBalanceDecimal, formatSignificantDecimalUp, groupDigits } from '@/lib/amount';
import { AmountUsd } from '@/components/review/AmountUsd';
import { CompactSubmissionFooter } from '@/components/review/CompactSubmissionFooter';
import { formatUsd } from '@/lib/prices';
import { displayAssetSymbol } from '@/components/AssetPresentation';
import { WalletAssetPicker } from '@/components/WalletAssetPicker';
import { StickyAction } from '@/components/StickyAction';
import { TransactionSettings } from '@/components/TransactionSettings';
import { StatusNotice } from '@/components/ProductUI';
import { useRefreshAction } from '@/lib/useRefreshAction';
import type { WalletAsset } from '@/lib/walletAssets';
import styles from './send.module.css';
const SEND_DEMAND = { expandedAssets: true, chainPulse: true, positions: false } as const;

const networkName = (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Base');
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function SendPage() {
  const wallet = usePrivyWallet();
  return <AppShell title="Send">{wallet.address
    ? <SendForm key={`${wallet.address.toLowerCase()}:${wallet.connectionVersion}`} />
    : <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to send." />}</AppShell>;
}

function SendForm() {
  const wallet = usePrivyWallet();
  useWalletDemand(SEND_DEMAND, wallet.ready && Boolean(wallet.address));
  const assets = useWalletAssets({ address: wallet.address, enabled: wallet.ready && Boolean(wallet.address) });
  const tokens = assets.data?.assets.filter((asset) => asset.balanceWei > 0n && canonicalAsset(asset.chainId, asset.tokenAddress)) ?? [];
  // Choose the default once. Price sorting and balance refreshes must never
  // turn an entered amount into another token or another network's holding.
  // Retain the identity when an exact zero read removes its funded row.
  const [selectedAsset, setSelectedAsset] = useState<WalletAsset>();
  const fundedAsset = selectedAsset ? tokens.find((item) => item.id === selectedAsset.id) : tokens[0];
  const asset = fundedAsset ?? selectedAsset;
  useEffect(() => {
    if (fundedAsset && fundedAsset !== selectedAsset) setSelectedAsset(fundedAsset);
  }, [fundedAsset, selectedAsset]);
  const selectedNetworkReady = Boolean(asset && assets.data?.networks[asset.chainId]?.status === 'ready');
  const missingBalance = Boolean(asset && !fundedAsset && !selectedNetworkReady);
  const emptyBalance = Boolean(asset && !fundedAsset && selectedNetworkReady);
  const readFailed = assets.status === 'unavailable' || assets.status === 'partial';
  const refreshAction = useRefreshAction(`${wallet.address?.toLowerCase()}:${wallet.connectionVersion}`);
  const refreshing = refreshAction.refreshing || assets.isFetching || assets.status === 'loading' || assets.status === 'idle';
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [tier, setTier] = useState<GasTier>(readGasTier);
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingSignature, setAwaitingSignature] = useState(false);
  const [error, setError] = useState('');
  const [amountEntryError, setAmountEntryError] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const recipientHintId = useId();
  const mounted = useRef(true);
  const identity = `${wallet.address?.toLowerCase()}:${wallet.connectionVersion}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const lock = useRef(false);
  const attempt = useRef(0);
  const signing = useRef(false);
  const requestedNetwork = useRef<{ walletKey: string; chainId: number } | null>(null);
  const walletKey = `${identity}:${wallet.isEmbedded}:${wallet.isEmbedded ? tier : ''}`;
  const context = `${identity}:${wallet.chainId}:${wallet.isEmbedded}:${wallet.isEmbedded ? tier : ''}`;
  const liveContext = useRef(context);
  liveContext.current = context;
  const previousContext = useRef(context);
  const acceptedContext = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (previousContext.current === context) return;
    previousContext.current = context;
    const requested = requestedNetwork.current;
    requestedNetwork.current = null;
    if (requested?.walletKey === walletKey && requested.chainId === wallet.chainId) return;
    // The send adapter may deliberately switch chains inside its wallet request.
    // Before that boundary, changed wallet/network/fee terms require a new review.
    if (signing.current || hash || !quote && !lock.current) return;
    attempt.current += 1;
    lock.current = false;
    setBusy(false);
    acceptedContext.current = null;
    setQuote(null);
    setError('Wallet, network, or fee preference changed. Review the transfer again.');
  }, [context, hash, quote, wallet.chainId, walletKey]);
  useEffect(() => {
    setQuoteExpired(false);
    if (!quote) return;
    const timer = window.setTimeout(() => setQuoteExpired(true), Math.max(0, quote.validUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quote]);
  useEffect(() => {
    const sync = (event: Event) => {
      if (event.type === 'storage' && (event as StorageEvent).key !== null && (event as StorageEvent).key !== SETTINGS_KEY) return;
      setTier(readGasTier());
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const current = () => mounted.current && currentIdentity.current === identity;
  const trimmedRecipient = recipient.trim();
  const recipientValid = isAddress(trimmedRecipient);
  const maxRecipient = recipientValid ? trimmedRecipient : wallet.address;
  const nativeMax = useNativeMax({
    contextKey: !quote && !busy && asset && !asset.tokenAddress && fundedAsset && selectedNetworkReady && wallet.address && maxRecipient
      ? JSON.stringify(['send', identity, wallet.chainId, wallet.isEmbedded, asset.id, asset.chainId, asset.balanceWei.toString(), maxRecipient.toLowerCase(), trimmedRecipient.toLowerCase(), wallet.isEmbedded ? tier : 'standard'])
      : null,
    calculate: () => prepareWalletSendMax({ walletAddress: wallet.address as Address, recipient: maxRecipient as Address,
      chainId: asset!.chainId, tokenAddress: null, tier: wallet.isEmbedded ? tier : 'standard' }, asset!.balanceWei),
    onAmount: (maximum) => setAmount(maximum === null ? '' : formatUnits(maximum, asset!.decimals)),
  });
  const input = (value = amount, to = trimmedRecipient): SendInput => {
    if (!asset || !wallet.address || !isAddress(to)) throw new Error('Enter a valid recipient address.');
    return { walletAddress: wallet.address as Address, recipient: to as Address, chainId: asset.chainId, tokenAddress: asset.tokenAddress,
      amount: value, tier: wallet.isEmbedded ? tier : 'standard' };
  };
  const symbol = asset ? displayAssetSymbol(asset.symbol) : '';
  const trimmedAmount = amount.trim();
  const amountProblem = asset && trimmedAmount ? decimalInputError(trimmedAmount, asset.decimals) : null;
  const amountUnits = asset && trimmedAmount && !amountProblem ? decimalToUnits(trimmedAmount, asset.decimals) : null;
  // The action names the one thing still missing, so a disabled button is never a mystery.
  const blocker = !asset ? (assets.status === 'loading' || assets.status === 'idle' ? 'Loading assets' : readFailed ? 'Check balances' : 'No assets to send')
    : missingBalance ? `Check ${symbol} balance`
      : emptyBalance ? `No ${symbol} to send`
        : !trimmedAmount ? 'Enter an amount'
          : amountUnits === null ? 'Enter a valid amount'
            : amountUnits > asset.balanceWei ? `Insufficient ${symbol}`
              : !trimmedRecipient ? 'Enter a recipient'
                : !recipientValid ? 'Enter a valid address'
                  : null;
  const run = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (lock.current) return;
    const generation = ++attempt.current;
    requestedNetwork.current = null;
    const isCurrent = () => current() && attempt.current === generation && liveContext.current === context
      && (!wallet.isEmbedded || readGasTier() === tier);
    lock.current = true; setBusy(true); setAwaitingSignature(false); setError('');
    try { await action(isCurrent); } catch (cause) {
      if (current() && attempt.current === generation) {
        setError(userSafeError(cause, 'Transfer could not be prepared. Try again.'));
        if (signing.current) setQuoteExpired(true);
      }
    }
    finally { if (attempt.current === generation) { lock.current = false; signing.current = false; if (current()) { setBusy(false); setAwaitingSignature(false); } } }
  };
  const maximum = () => {
    setAmountEntryError('');
    setError('');
    if (!asset) return;
    if (asset.tokenAddress) { nativeMax.cancel(); setAmount(asset.balance); return; }
    void nativeMax.resolveMax();
  };
  const review = () => void run(async (isCurrent) => {
    const result = await prepareWalletSend(quote ? { ...quote.input, tier: wallet.isEmbedded ? tier : 'standard' } : input());
    if (isCurrent()) { acceptedContext.current = context; setQuote(result); }
  });
  // No form element wraps the card, so Enter in either field asks for the review, as a submit would.
  const reviewOnEnter = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (!busy && blocker === null) review();
  };
  const confirm = () => void run(async (isCurrent) => {
    if (!quote || !isCurrent()) return;
    if (acceptedContext.current !== context) {
      setQuote(null);
      setError('Wallet, network, or fee preference changed. Review the transfer again.');
      return;
    }
    if (quote.validUntil <= Date.now()) { setQuoteExpired(true); return; }
    await withWalletChainLock({ walletAddress: quote.input.walletAddress, chainId: quote.input.chainId, requireWebLocks: true, run: async (assertOwned) => {
    if (!isCurrent()) return;
    // Rebuild only from the immutable reviewed input. A changed account cannot sign it.
    const fresh = await prepareWalletSend(quote.input);
    if (!isCurrent()) return;
    if (fresh.validUntil <= Date.now()) throw new Error('Network fee quote expired. Review the transfer again.');
    if (fresh.requiredNative > quote.requiredNative || fresh.estimatedFee > quote.estimatedFee
      || wallet.isEmbedded && (fresh.maxFeePerGas > quote.maxFeePerGas || fresh.maxPriorityFeePerGas > quote.maxPriorityFeePerGas)) {
      setQuote(fresh); throw new Error('Network cost changed. Review the updated amount.');
    }
    assertOwned();
    signing.current = true;
    requestedNetwork.current = { walletKey, chainId: quote.input.chainId };
    setAwaitingSignature(true);
    const result = await wallet.sendTransaction({ from: quote.input.walletAddress, chainId: quote.input.chainId, to: fresh.to, data: fresh.data, value: fresh.value, nonce: fresh.nonce,
      ...(wallet.isEmbedded ? { nonce: fresh.nonce, gasLimit: fresh.gas, maxFeePerGas: fresh.maxFeePerGas, maxPriorityFeePerGas: fresh.maxPriorityFeePerGas } : {}) },
    { description: `Send ${quote.input.amount} ${quote.symbol} to ${quote.input.recipient}`, action: 'Send', buttonText: 'Confirm' });
    // Submission belongs to the account that signed, even if the active account changed while its prompt was open.
    recordPendingHash({ operation: 'sendAsset', stepKind: 'action', intent: 'Send', walletAddress: quote.input.walletAddress,
      chainId: quote.input.chainId, hash: result.hash, to: fresh.to, data: fresh.data, value: fresh.value, nonce: fresh.nonce });
    window.dispatchEvent(new Event('fxaeon:activity-updated'));
    if (current()) { setHash(result.hash); void assets.refresh(); }
    } });
  });
  if (hash && quote) return <section className={`${styles.card} ${styles.done}`} aria-label="Send submitted">
    <span className={styles.doneMark} aria-hidden="true"><Clock3 /></span>
    <h2>Submitted</h2>
    <p className={styles.doneAmount}><strong>{groupDigits(quote.input.amount)} {quote.symbol}</strong> to {shortAddress(quote.input.recipient)}</p>
    <p className={styles.doneNote}>Not confirmed by the network yet. History shows its status.</p>
    <CompactSubmissionFooter chainId={quote.input.chainId} hash={hash} />
    <Link className={`button button-primary ${styles.action}`} href="/history">View history</Link>
  </section>;
  return <section className={styles.card} aria-label={quote ? 'Review send' : 'Send crypto'}>
    {quote ? <>
      <header className={styles.reviewHeader}>
        <button type="button" className={styles.back} aria-label="Edit transfer" disabled={busy} onClick={() => { setQuote(null); setError(''); }}><ArrowLeft aria-hidden="true" /></button>
        <h2 className="sr-only">Review send</h2>
      </header>
      <div className={styles.reviewHero}>
        <TokenIcon symbol={quote.symbol} size={48} />
        {/* The exact amount that will be signed; long amounts step the type down to fit, as in the amount field. */}
        <p className={styles.reviewAmount} style={{ '--amount-length': groupDigits(quote.input.amount).length + quote.symbol.length + 1 } as CSSProperties}>{groupDigits(quote.input.amount)} <span>{quote.symbol}</span></p>
      </div>
      <div className={styles.recipientReview}>
        <span className={styles.fieldLabel}>To</span>
        <div className={styles.recipientIdentity}>
          <WalletAvatar address={quote.input.recipient} size={32} />
          <GroupedAddress address={quote.input.recipient} />
        </div>
      </div>
      <dl className={styles.facts}>
        <div><dt>Network</dt><dd><ChainIcon chainId={quote.input.chainId} size={18} />{networkName(quote.input.chainId)}</dd></div>
        {/* An estimate, rounded up so the figure shown always covers it. */}
        <div><dt>Network cost · estimated</dt><dd><span title={`${formatEther(quote.estimatedFee)} ETH`}>≈ {formatSignificantDecimalUp(formatEther(quote.estimatedFee), 3)} ETH<AmountUsd amount={formatEther(quote.estimatedFee)} symbol="ETH" /></span></dd></div>
      </dl>
    </> : <>
      <div className={styles.cardHead}><h2>Send to a wallet</h2><TransactionSettings scope="Send" chainId={asset?.chainId ?? 1} /></div>
      <div data-focus-field className={styles.amountPanel}>
        <div className={styles.panelHead}>
          <label htmlFor="send-amount">Amount</label>
          <button type="button" className={styles.max} disabled={busy || nativeMax.pending || !fundedAsset || !asset?.tokenAddress && !selectedNetworkReady} aria-busy={nativeMax.pending || undefined} onClick={maximum}><span>{nativeMax.pending ? 'Checking Max…' : 'Max'}</span></button>
        </div>
        <div className={styles.amountRow}>
          <span className={styles.amountFit}><DecimalInput id="send-amount" className={styles.amountInput} style={{ '--amount-length': Math.max(trimmedAmount.length, 4) } as CSSProperties} autoComplete="off" spellCheck={false} placeholder="0.00" value={amount} disabled={busy} aria-invalid={Boolean(amountProblem || amountEntryError) || undefined} onKeyDown={reviewOnEnter} onInvalidInput={setAmountEntryError} onValueChange={(next) => { nativeMax.cancel(); setAmount(next); setError(''); setAmountEntryError(''); }} maxLength={100} /></span>
          <WalletAssetPicker label="Asset to send" assets={tokens} value={asset} disabled={busy} loading={assets.status === 'loading' || assets.status === 'idle'} emptyLabel={readFailed ? 'Unavailable' : undefined} onChange={(next) => { nativeMax.cancel(); setSelectedAsset(next); setAmount(''); setError(''); setAmountEntryError(''); }} />
        </div>
        {amountEntryError ? <p className={styles.hint} role="alert">{amountEntryError}</p>
          : amountProblem && trimmedAmount !== '.' ? <p className={styles.hint}>{amountProblem}</p>
          : asset && <p className={styles.balance}>{missingBalance ? 'Balance unavailable' : <>{fundedAsset && !selectedNetworkReady ? 'Last checked' : 'Available'}: <span title={fundedAsset ? `${fundedAsset.balance} ${symbol}` : undefined}>{fundedAsset ? formatBalanceDecimal(fundedAsset.balance, 8) : '0'} {symbol}</span>{fundedAsset?.usdValue != null && selectedNetworkReady && <span className={styles.balanceUsd}>{formatUsd(fundedAsset.usdValue)}</span>}</>}</p>}
      </div>
      {(readFailed || missingBalance) && <StatusNotice tone="warning" title={refreshing ? 'Checking balances…' : asset ? 'Couldn’t refresh balances' : 'Couldn’t load balances'}
        action={<button type="button" disabled={busy || refreshing} aria-busy={refreshing || undefined} onClick={() => void refreshAction.run([assets.refresh])}>{refreshing ? 'Checking…' : 'Retry'}</button>}>
        {fundedAsset ? 'Showing the last checked balance. Review checks it again before you can send.' : 'Retry to check your supported assets on Ethereum and Base.'}
      </StatusNotice>}
      <div data-focus-field className={styles.recipientPanel}>
        <label htmlFor="send-recipient" className={styles.fieldLabel}>To</label>
        <div className={styles.recipientRow}>
          {recipientValid ? <WalletAvatar address={trimmedRecipient} size={28} /> : <span className={styles.recipientEmpty} aria-hidden="true"><Wallet /></span>}
          {/* Two lines show the whole address while it is entered; Enter never adds a line break. */}
          <textarea id="send-recipient" rows={2} aria-label="Recipient address" aria-invalid={trimmedRecipient !== '' && !recipientValid} aria-describedby={trimmedRecipient && !recipientValid ? recipientHintId : undefined} placeholder="0x… wallet address" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={recipient} disabled={busy} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); reviewOnEnter(event); }} onChange={(event) => { setRecipient(event.target.value); setError(''); }} />
        </div>
        {trimmedRecipient && !recipientValid && <p id={recipientHintId} className={styles.hint}>Enter a complete 0x wallet address.</p>}
      </div>
    </>}
    {(error || nativeMax.error) && <p role="alert" className={styles.error}>{error || nativeMax.error}</p>}
    {quote && quoteExpired && <p role="status" className={styles.hint}>{quote.validUntil <= Date.now() ? 'Network fee quote expired. ' : ''}Review an updated fee before confirming.</p>}
    <StickyAction><button type="button" className={`button button-primary ${styles.action}`} aria-busy={busy || undefined} disabled={busy || !quote && blocker !== null} onClick={quote && !quoteExpired ? confirm : review}>{busy ? awaitingSignature ? 'Confirm in wallet' : 'Preparing' : quote ? quoteExpired ? 'Review updated fee' : 'Confirm' : blocker ?? <>Review<ChevronRight aria-hidden="true" /></>}</button></StickyAction>
  </section>;
}
