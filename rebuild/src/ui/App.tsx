import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { parseAmount } from '../domain/amount';
import type { PreparedLong, Runtime, VerifiedReceipt } from '../domain/ports';
import type { AppController, AppState, Flow, HistoryEntry } from '../domain/view';
import { Dialog } from './Dialog';
import { EthereumMark, FxMark, Icon } from './icons';
import { amount, dateLabel, dollars, elapsedLabel, exactAmount, feeRate, multiplier, percent, shortAddress } from './format';
import './styles.css';

export interface AppProps { controller: AppController; runtime: Runtime }
type Overlay = 'wallet' | 'review' | null;
const lockedStages: readonly Flow['stage'][] = ['checking', 'signing', 'pending', 'unverified'];

function modeName(mode: Runtime['mode']): string {
  return mode === 'simulation' ? 'Simulation' : mode === 'fork' ? 'Local fork' : 'Ethereum';
}

function ModeTag({ mode }: { mode: Runtime['mode'] }) {
  return <span className={`mode-tag mode-tag--${mode}`}><span className="status-dot" />{modeName(mode)}</span>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  return <span className="copy-control">
    <button type="button" className="icon-button icon-button--small" aria-label={copyState === 'copied' ? `${label} copied` : `Copy ${label}`} onClick={() => {
      void navigator.clipboard?.writeText(value).then(() => setCopyState('copied'), () => setCopyState('blocked'));
      if (!navigator.clipboard) setCopyState('blocked');
    }}><Icon name={copyState === 'copied' ? 'check' : 'copy'} /></button>
    {copyState === 'blocked' && <span className="copy-feedback" role="status">Select the value to copy.</span>}
    <span className="sr-only" role="status">{copyState === 'copied' ? `${label} copied.` : ''}</span>
  </span>;
}

function Fact({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`fact ${className}`}><dt>{label}</dt><dd>{children}</dd></div>;
}

function TransactionHash({ hash, mode }: { hash: string; mode: Runtime['mode'] }) {
  return <div className="transaction-hash">
    <span className="micro-label">Transaction hash</span>
    <div className="exact-line"><code>{hash}</code><CopyButton value={hash} label="transaction hash" /></div>
    {mode === 'live' && /^0x[\da-f]{64}$/i.test(hash) && <a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer" className="text-link">View on Etherscan <Icon name="external" /></a>}
    {mode !== 'live' && <span className="fine-print">{mode === 'simulation' ? 'Simulation record. This hash is not a public-chain transaction.' : 'Local-fork transaction. This hash is not a mainnet transaction.'}</span>}
  </div>;
}

function ExactTransaction({ plan }: { plan: PreparedLong }) {
  return <details className="disclosure exact-transaction">
    <summary><span><strong>Transaction details</strong><small>Exact data sent to your wallet</small></span><Icon name="chevron" /></summary>
    <div className="disclosure-content">
      <dl className="exact-facts">
        <Fact label="Network">Ethereum · chain 1</Fact>
        <Fact label="From"><code>{plan.call.from}</code><CopyButton value={plan.call.from} label="sender address" /></Fact>
        <Fact label="To"><code>{plan.call.to}</code><CopyButton value={plan.call.to} label="recipient contract" /></Fact>
        <Fact label="Native value"><span>{exactAmount(plan.call.value)} ETH<small className="exact-unit">{plan.call.value.toString()} wei</small></span></Fact>
        <Fact label="Nonce"><code>{plan.call.nonce}</code></Fact>
        <Fact label="Gas limit"><code>{plan.gasLimit.toString()}</code></Fact>
        <Fact label="Fee estimate basis"><span>{exactAmount(plan.feePerGasWei, 9)} gwei<small className="exact-unit">Your external wallet chooses its gas settings.</small></span></Fact>
        <Fact label="Prepared at block"><code>{plan.blockNumber.toString()}</code></Fact>
      </dl>
      <div className="calldata-heading"><span className="micro-label">Calldata</span><CopyButton value={plan.call.data} label="calldata" /></div>
      <code className="calldata">{plan.call.data}</code>
    </div>
  </details>;
}

function AcceptedTerms({ plan, expanded = true }: { plan: PreparedLong; expanded?: boolean }) {
  const economics = plan.economics;
  const body = <>
    <div className="economic-pair">
      <div><span className="micro-label">Estimated collateral</span><strong>≈ {amount(economics.collateralStEthWei)} <span>stETH</span></strong><span className="fine-print" title={exactAmount(economics.collateralStEthWei)}>ETH-long accounting units</span></div>
      <div><span className="micro-label">Estimated debt</span><strong>≈ {amount(economics.debtFxUsdWei, 4)} <span>fxUSD</span></strong><span className="fine-print">Borrowed by this position</span></div>
    </div>
    <dl className="review-facts">
      <Fact label="Requested leverage">{multiplier(plan.intent.leverageBps)}</Fact>
      <Fact label="Estimated leverage"><span className="accent-text">≈ {multiplier(economics.estimatedLeverageBps)}</span></Fact>
      <Fact label="Estimated execution price">{dollars(economics.executionPriceUsdE18)}</Fact>
      <Fact label="Minimum received" className="fact--important"><span className="exact-amount">{exactAmount(economics.minimumWstEthWei)} wstETH</span></Fact>
      <Fact label="Slippage tolerance">{percent(plan.intent.slippageBps)}</Fact>
      <Fact label="Estimated network fee"><span className="exact-amount">≈ {exactAmount(plan.estimatedNetworkFeeWei)} ETH</span></Fact>
      <Fact label="Required wallet balance"><span className="exact-amount">{exactAmount(plan.requiredBalanceWei)} ETH</span></Fact>
    </dl>
    <details className="disclosure costs-disclosure">
      <summary><span>Fees &amp; risk estimates</span><Icon name="chevron" /></summary>
      <div className="disclosure-content"><dl className="review-facts">
        <Fact label="Borrow fee rate">{feeRate(economics.borrowFeeRatio)}</Fact>
        <Fact label="Supply fee rate">{feeRate(economics.supplyFeeRatio)}</Fact>
        <Fact label="Price impact"><span className="unavailable">Unavailable</span></Fact>
        <Fact label="Estimated rebalance price">{dollars(economics.rebalancePriceUsdE18)}</Fact>
        <Fact label="Estimated liquidation price">{dollars(economics.liquidationPriceUsdE18)}</Fact>
      </dl><p className="fine-print">A protocol fee rate is not an exact fee amount. Network fees are separate. Missing estimates do not mean zero cost or zero risk.</p></div>
    </details>
  </>;
  return expanded ? body : <details className="disclosure accepted-disclosure"><summary><span>Accepted terms</span><Icon name="chevron" /></summary><div className="disclosure-content">{body}</div></details>;
}

function ReceiptDetails({ receipt, mode }: { receipt: VerifiedReceipt; mode: Runtime['mode'] }) {
  const position = receipt.position;
  return <>
    {receipt.status === 'success' && receipt.positionId !== undefined && <div className="position-result">
      <span className="micro-label">Verified position</span>
      <div className="position-result-title"><EthereumMark /><strong>ETH long <span>#{receipt.positionId.toString()}</span></strong></div>
      {position ? <dl className="review-facts">
        <Fact label="Collateral"><span className="exact-amount">{exactAmount(position.collateralStEthWei)} stETH</span></Fact>
        <Fact label="Debt"><span className="exact-amount">{exactAmount(position.debtFxUsdWei)} fxUSD</span></Fact>
        <Fact label="Achieved leverage">{position.leverageBps === undefined ? 'Unavailable' : multiplier(position.leverageBps)}</Fact>
      </dl> : <p className="syncing-note"><Icon name="refresh" />Position accounting is syncing. The transaction receipt is confirmed.</p>}
    </div>}
    {receipt.status === 'success' && receipt.positionId === undefined && <p className="inline-message inline-message--warning"><Icon name="info" />The transaction is confirmed. A verified position identity is unavailable.</p>}
    <dl className="review-facts receipt-facts">
      <Fact label="Receipt status">{receipt.status === 'success' ? 'Confirmed' : 'Reverted'}</Fact>
      <Fact label="Network fee paid"><span className="exact-amount">{exactAmount(receipt.networkFeeWei)} ETH</span></Fact>
      <Fact label="Confirmed block"><code>{receipt.blockNumber.toString()}</code></Fact>
    </dl>
    <TransactionHash hash={receipt.hash} mode={mode} />
  </>;
}

function ReviewDialog({ state, controller, runtime, onClose, onHistory, onRefresh, returnFocus }: AppProps & { state: AppState; onClose(): void; onHistory(): void; onRefresh(): void; returnFocus: HTMLElement | null }) {
  const flow = state.flow;
  const plan = 'plan' in flow ? flow.plan : undefined;
  const [observing, setObserving] = useState(false);
  const check = () => {
    if (observing) return;
    setObserving(true);
    void controller.checkReceipt().finally(() => setObserving(false));
  };
  const reviewing = flow.stage === 'review' || flow.stage === 'expired';
  const remaining = plan ? Math.max(0, Math.ceil((plan.expiresAt - state.now) / 1000)) : 0;
  const expired = flow.stage === 'expired' || (flow.stage === 'review' && remaining === 0);
  const failed = flow.stage === 'failed';
  const reverted = failed && flow.error.code === 'reverted';
  const rejected = failed && flow.error.code === 'user-rejected';
  const confirmed = flow.stage === 'confirmed';
  const receipt = confirmed ? flow.receipt : failed ? flow.receipt : undefined;
  const hash = 'hash' in flow ? flow.hash : confirmed ? flow.receipt.hash : undefined;
  const title = expired ? 'Review expired' : reviewing ? 'Review ETH long' : flow.stage === 'checking' ? 'Checking transaction' : flow.stage === 'signing' ? 'Confirm in your wallet' : flow.stage === 'pending' ? 'Transaction submitted' : confirmed ? (flow.receipt.positionId !== undefined && flow.receipt.status === 'success' ? 'Position opened' : 'Transaction confirmed') : flow.stage === 'unverified' ? 'Confirmation unavailable' : reverted ? 'Transaction reverted' : rejected ? 'Request declined' : 'Review unavailable';
  const subtitle = expired ? 'Refresh the terms before you confirm.' : reviewing ? 'Your wallet opens only after you confirm these terms.' : flow.stage === 'checking' ? 'Verifying the same transaction before your wallet opens.' : flow.stage === 'signing' ? 'Waiting for a response from your selected wallet.' : flow.stage === 'pending' ? 'Waiting for a verified Ethereum receipt.' : confirmed ? 'The receipt has been verified on the selected chain.' : flow.stage === 'unverified' ? 'Keep this attempt in view. An uncertain result is not a failed transaction.' : rejected ? 'You can return to your deposit and prepare a fresh review.' : reverted ? 'The position was not opened. Network fees can still be charged.' : 'Your deposit remains in the editor.';
  let footer: ReactNode;
  if (reviewing) footer = <><button type="button" className="button button--secondary" onClick={onClose}>Edit deposit</button><button type="button" className="button button--primary" onClick={() => { if (expired) onRefresh(); else void controller.confirm(); }}>{expired ? 'Refresh review' : 'Confirm in wallet'}<Icon name={expired ? 'refresh' : 'arrow'} /></button></>;
  else if (flow.stage === 'checking' || flow.stage === 'signing') footer = <><div className="waiting-status" role="status"><span className="pending-mark" />{flow.stage === 'checking' ? 'Checking transaction…' : 'Waiting for your wallet…'}</div><button type="button" className="button button--secondary" onClick={onClose}>Close view</button></>;
  else if (flow.stage === 'pending' || flow.stage === 'unverified') footer = <><button type="button" className="button button--secondary" onClick={onHistory}>View history</button>{hash && <button type="button" className="button button--primary" disabled={observing} onClick={check}>{observing ? 'Checking receipt…' : 'Check receipt'}<Icon name="refresh" /></button>}</>;
  else if (confirmed || reverted) footer = <><button type="button" className="button button--secondary" onClick={onClose}>Done</button><button type="button" className="button button--primary" onClick={onHistory}>View history<Icon name="arrow" /></button></>;
  else footer = <button type="button" className="button button--primary" onClick={onClose}>Return to deposit<Icon name="back" /></button>;

  return <Dialog title={title} subtitle={subtitle} eyebrow={<><span>ETH LONG</span><ModeTag mode={runtime.mode} /></>} onClose={onClose} footer={footer} returnFocus={returnFocus}>
    {reviewing && plan && <>
      <div className="review-hero"><span className="micro-label">You pay</span><div><strong>{exactAmount(plan.intent.amountWei)}</strong><span>ETH</span></div><span className="review-account"><Icon name="wallet" />{shortAddress(plan.call.from)}<span>on Ethereum</span></span></div>
      <div className={`review-expiry ${expired || remaining <= 5 ? 'review-expiry--warning' : ''}`}><span><Icon name="clock" />{expired ? 'These terms are no longer signable' : `Terms valid for ${remaining}s`}</span><progress value={remaining} max={Math.max(1, Math.ceil((plan.expiresAt - plan.preparedAt) / 1000))} aria-label="Review time remaining" /></div>
      <AcceptedTerms plan={plan} />
      <p className="review-risk"><Icon name="info" />Leverage increases gains and losses. Rebalancing or liquidation can reduce your position.</p>
      <div className="simulation-check"><Icon name="shield" />{runtime.mode === 'simulation' ? 'Practice checks passed' : 'Transaction simulation passed'}<span>No token approval required</span></div>
      <ExactTransaction plan={plan} />
    </>}
    {!reviewing && (flow.stage === 'checking' || flow.stage === 'signing' || flow.stage === 'pending') && <>
      <div className={`transaction-state transaction-state--${flow.stage}`}><div className="state-symbol"><Icon name={flow.stage === 'signing' ? 'wallet' : flow.stage === 'checking' ? 'shield' : 'clock'} /></div><ol className="execution-stages" aria-label="Transaction progress"><li data-complete="true"><Icon name="check" /><span>Reviewed</span></li><li data-complete={flow.stage === 'pending'} aria-current={flow.stage !== 'pending' ? 'step' : undefined}>{flow.stage === 'pending' ? <Icon name="check" /> : <span className="stage-dot" />}<span>Wallet</span></li><li aria-current={flow.stage === 'pending' ? 'step' : undefined}><span className="stage-dot" /><span>Confirmation</span></li></ol></div>
      {hash && <TransactionHash hash={hash} mode={runtime.mode} />}
      <p className="fine-print progress-note">You may close this view. This attempt stays in your wallet’s history.</p>
      {plan && <><AcceptedTerms plan={plan} expanded={false} /><ExactTransaction plan={plan} /></>}
    </>}
    {receipt && <><div className={`outcome-banner ${receipt.status === 'success' ? 'outcome-banner--success' : 'outcome-banner--error'}`}><span className="outcome-icon"><Icon name={receipt.status === 'success' ? 'check' : 'close'} /></span><span>{receipt.status === 'success' ? 'Verified receipt' : 'Verified on-chain revert'}{runtime.mode !== 'live' && <small>{modeName(runtime.mode)} environment</small>}</span></div><ReceiptDetails receipt={receipt} mode={runtime.mode} />{plan && <><AcceptedTerms plan={plan} expanded={false} /><ExactTransaction plan={plan} /></>}</>}
    {flow.stage === 'unverified' && <><div className="inline-message inline-message--warning" role="status"><Icon name="warning" /><div><strong>Do not send this transaction again.</strong><p>{flow.error.message}</p><p>Check the receipt or your wallet’s activity. This view does not assume success or failure.</p></div></div>{hash && <TransactionHash hash={hash} mode={runtime.mode} />}<AcceptedTerms plan={flow.plan} expanded={false} /><ExactTransaction plan={flow.plan} /></>}
    {failed && !receipt && <><div className={`inline-message ${rejected ? '' : 'inline-message--error'}`} role="alert"><Icon name={rejected ? 'wallet' : 'warning'} /><p>{flow.error.message}</p></div>{hash && <TransactionHash hash={hash} mode={runtime.mode} />}{plan && <ExactTransaction plan={plan} />}</>}
  </Dialog>;
}

function WalletDialog({ state, controller, runtime, onClose, pending, onConnect, returnFocus }: AppProps & { state: AppState; onClose(): void; pending: string | null; onConnect(id: string): void; returnFocus: HTMLElement | null }) {
  const selectedChoice = state.choices.find(choice => choice.id === pending);
  const connected = state.wallet;
  return <Dialog title={connected ? 'Your wallet' : pending ? 'Approve the connection' : 'Connect your wallet'} subtitle={connected ? 'This wallet approves every transaction.' : pending ? `Check ${selectedChoice?.name ?? 'your selected wallet'} to continue.` : 'Choose a wallet to prepare your ETH long.'} eyebrow={<ModeTag mode={runtime.mode} />} variant="wallet" onClose={onClose} footer={connected ? <button type="button" className="button button--secondary" onClick={() => { controller.disconnect(); onClose(); }}>Disconnect wallet</button> : pending ? <button type="button" className="button button--secondary" onClick={onClose}>Cancel connection</button> : undefined} returnFocus={returnFocus}>
    {connected ? <div className="connected-wallet"><div className="wallet-symbol"><Icon name="wallet" /></div><strong>{connected.label}</strong><div className="exact-line"><code>{connected.address}</code><CopyButton value={connected.address} label="wallet address" /></div><span className={`network-label ${connected.chainId !== 1 ? 'warning-text' : ''}`}><span className="status-dot" />{connected.chainId === 1 ? 'Ethereum' : `Chain ${connected.chainId} · switch required`}</span></div> : pending ? <div className="connection-wait"><div className="wallet-symbol"><Icon name="wallet" /></div><p>The request is open in your wallet.</p><span className="fine-print">Closing this picker stops this connection attempt. It never continues a trade automatically.</span></div> : <>
      <div className="wallet-choices">
        {state.choices.map(choice => <button type="button" className="wallet-choice" key={choice.id} disabled={!choice.available} onClick={() => onConnect(choice.id)}><span className="wallet-choice-mark"><Icon name="wallet" /></span><span><strong>{choice.name}</strong><small>{choice.available ? runtime.mode === 'simulation' ? 'Simulation wallet' : 'Available in this browser' : 'Not available in this browser'}</small></span><Icon name="arrow" /></button>)}
      </div>
      {!state.choices.some(choice => choice.available) && <div className="wallet-empty"><Icon name="wallet" /><strong>No compatible wallet found</strong><p>Open FxAeon inside a wallet browser, or enable an Ethereum wallet extension.</p></div>}
      {runtime.mode === 'live' && <button type="button" className="button button--secondary wallet-handoff" onClick={() => runtime.host.openWallet()}>Open in MetaMask<Icon name="external" /></button>}
      <div className="wallet-principle"><Icon name="shield" /><p>Your wallet stays in control. Connecting does not approve a transaction.</p></div>
    </>}
    {state.notice && <div className="inline-message inline-message--error" role="alert"><Icon name="warning" /><p>{state.notice.message}</p></div>}
  </Dialog>;
}

function MarketContext({ state, runtime, controller }: AppProps & { state: AppState }) {
  const facts = state.market.facts;
  const minimum = facts ? Math.max(11_000, facts.minLeverageBps) : undefined;
  const maximum = facts ? Math.min(50_000, facts.maxLeverageBps) : undefined;
  return <section className="market-context" aria-labelledby="market-title">
    <div className="market-kicker"><span className="asset-avatar"><EthereumMark /></span><span>ETH / ETHEREUM</span><span className="direction-tag">Long<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 9 9 2M3 2h6v6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></span></div>
    <h1 id="market-title">Long Ethereum.<br /><span>Your terms.</span></h1>
    <p className="market-intro">Choose your exposure.<br className="desktop-break" /> Review every detail. Keep control.</p>
    <div className="market-reference">
      <div className="reference-label"><span className="micro-label">ETH reference price</span><button type="button" className="icon-button icon-button--small" aria-label="Refresh market data" disabled={state.market.status === 'loading'} onClick={() => { void controller.refreshMarket(); }}><Icon name="refresh" /></button></div>
      {state.market.status === 'loading' && !facts ? <span className="price-skeleton" aria-label="Loading ETH reference price" /> : <strong className={`reference-price ${facts?.priceUsdE18 === undefined ? 'reference-price--unavailable' : ''}`}>{dollars(facts?.priceUsdE18)}</strong>}
      <div className="reference-source">{facts ? <><span className="status-dot" />{runtime.mode === 'simulation' ? 'Fixture data' : 'On-chain read'}<span className="separator-dot">·</span>{elapsedLabel(facts.readAt, state.now)}</> : <span>{state.market.status === 'loading' ? 'Reading market conditions…' : 'A verified market read is required.'}</span>}</div>
      {state.market.status === 'error' && <p className="market-error">{state.market.message ?? 'Market data is unavailable. You can still enter your deposit.'}</p>}
    </div>
    <dl className="market-specs"><Fact label="Collateral">stETH</Fact><Fact label="Borrowed asset">fxUSD</Fact><Fact label="Available leverage">{minimum !== undefined && maximum !== undefined && maximum >= minimum && !facts?.paused ? `${multiplier(minimum)} – ${multiplier(maximum)}` : 'Unavailable'}</Fact></dl>
    <div className="position-explainer"><span className="explainer-mark"><FxMark /></span><p><strong>One position. More exposure.</strong><span>Your ETH funds a leveraged long through f(x) Protocol. All terms are checked before your wallet opens.</span></p></div>
    <p className="context-risk">Leverage increases gains and losses. Rebalancing and liquidation can reduce your position.</p>
  </section>;
}

function TradeTicket({ state, controller, onWallet, onProgress }: { state: AppState; controller: AppController; onWallet(): void; onProgress(): void }) {
  const rangeStart = useRef<string | null>(null);
  const facts = state.market.facts;
  const locked = lockedStages.includes(state.flow.stage);
  const preparing = state.flow.stage === 'preparing';
  const minimum = facts ? Math.max(11_000, facts.minLeverageBps) : 11_000;
  const maximum = facts ? Math.min(50_000, facts.maxLeverageBps) : 50_000;
  const boundsReady = state.market.status === 'ready' && !!facts && maximum >= minimum && !facts.paused;
  let amountError = '';
  let validAmount = false;
  if (state.input.amount) {
    try { validAmount = parseAmount(state.input.amount) > 0n; if (!validAmount) amountError = 'Enter an amount greater than zero.'; }
    catch (error) { amountError = error instanceof Error ? error.message : 'Enter a valid ETH amount.'; }
  }
  let leverageBps = 0;
  try { leverageBps = Number(parseAmount(state.input.leverage, 4)); } catch { /* Validation is presented below. */ }
  const leverageValid = Number.isSafeInteger(leverageBps) && leverageBps >= minimum && leverageBps <= maximum;
  const rangeValue = Math.max(minimum, Math.min(maximum, leverageBps || minimum)) / 10_000;
  const rangeProgress = maximum > minimum ? ((rangeValue * 10_000 - minimum) / (maximum - minimum)) * 100 : 0;
  const wrongChain = !!state.wallet && state.wallet.chainId !== 1;
  const noFunds = !!state.wallet && facts?.balanceWei === 0n;
  const buttonLabel = locked ? 'View transaction' : preparing ? 'Preparing review…' : !state.wallet ? 'Connect wallet' : wrongChain ? 'Switch to Ethereum' : !state.input.amount ? 'Enter an amount' : !validAmount ? 'Check your amount' : !leverageValid ? 'Check your leverage' : !boundsReady ? 'Market unavailable' : 'Review position';
  const disabled = !locked && !!state.wallet && !wrongChain && (preparing || !validAmount || !leverageValid || !boundsReady || noFunds);
  function primary() {
    if (locked) onProgress();
    else if (!state.wallet) onWallet();
    else if (wrongChain) void controller.switchChain();
    else void controller.prepare();
  }
  return <section className="trade-ticket" aria-labelledby="ticket-title">
    <header className="ticket-header"><div><span className="micro-label">ETHEREUM</span><h2 id="ticket-title">Open a long</h2></div><span className="ticket-asset"><EthereumMark /></span></header>
    <div className="ticket-content">
      <div className={`deposit-box ${amountError ? 'deposit-box--error' : ''}`}>
        <div className="deposit-label"><label htmlFor="eth-amount">Your deposit</label><span>{state.wallet ? facts?.balanceWei === undefined ? 'Balance unavailable' : <span title={`${exactAmount(facts.balanceWei)} ETH available`}>{amount(facts.balanceWei)} ETH available</span> : 'Wallet disconnected'}</span></div>
        <div className="amount-input-row"><input id="eth-amount" aria-label="Amount in ETH" aria-describedby="amount-help" aria-invalid={!!amountError} value={state.input.amount} onChange={event => controller.setAmount(event.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.00" maxLength={100} disabled={locked} /><span className="token-label">ETH</span></div>
        <div className="amount-support" id="amount-help">{amountError ? <span className="error-text">{amountError}</span> : noFunds ? <span className="warning-text">Add ETH to this wallet for your deposit and gas.</span> : <><span className="tiny-eth"><EthereumMark /></span>Native ETH on Ethereum</>}</div>
      </div>
      <fieldset className="leverage-control" disabled={locked || !boundsReady}>
        <div className="leverage-heading"><label htmlFor="leverage-amount">Leverage</label><span className={`leverage-value ${boundsReady && !leverageValid ? 'leverage-value--error' : ''}`}><input id="leverage-amount" aria-label="Requested leverage" value={state.input.leverage} inputMode="decimal" maxLength={8} onChange={event => controller.setLeverage(event.target.value)} onBlur={() => { if (boundsReady && Number.isSafeInteger(leverageBps) && leverageBps > 0 && !leverageValid) controller.setLeverage(exactAmount(BigInt(Math.max(minimum, Math.min(maximum, leverageBps))), 4)); }} /><span>×</span></span></div>
        <input type="range" className="leverage-range" min={minimum / 10_000} max={Math.max(minimum, maximum) / 10_000} step="0.1" value={rangeValue} aria-label="Leverage slider" aria-valuetext={`${rangeValue} times requested leverage`} onChange={event => controller.setLeverage(event.target.value)} onKeyDown={event => {
          if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
          event.preventDefault();
          const next = Math.max(minimum, Math.min(maximum, Math.round(rangeValue * 10_000) + (event.key === 'PageUp' ? 10_000 : -10_000)));
          controller.setLeverage(exactAmount(BigInt(next), 4));
        }} onPointerDown={() => { rangeStart.current = state.input.leverage; }} onPointerUp={() => { rangeStart.current = null; }} onPointerCancel={() => { if (rangeStart.current !== null) controller.setLeverage(rangeStart.current); rangeStart.current = null; }} style={{ '--range-progress': `${rangeProgress}%` } as CSSProperties} />
        <div className="range-labels"><span>{boundsReady ? multiplier(minimum) : 'Live limits required'}</span><span>{boundsReady ? multiplier(maximum) : 'Unavailable'}</span></div>
      </fieldset>
      {boundsReady && !leverageValid && <p className="field-error" role="status">Choose between {multiplier(minimum)} and {multiplier(maximum)}. Empty leverage cannot be reviewed.</p>}
      <details className="slippage-settings"><summary><span><Icon name="sliders" />Slippage tolerance</span><strong>{percent(state.input.slippageBps)}<Icon name="chevron" /></strong></summary><div className="slippage-content"><fieldset disabled={locked}><legend className="sr-only">Slippage tolerance</legend>{[10, 50, 100].map(bps => <label key={bps} className="slippage-option"><input type="radio" name="slippage" value={bps} checked={state.input.slippageBps === bps} onChange={() => controller.setSlippage(bps)} /><span>{percent(bps)}</span></label>)}</fieldset><p className="fine-print">The accepted route sets an exact minimum. A smaller tolerance may cause the transaction to revert.</p></div></details>
      <dl className="ticket-facts"><Fact label="Network fee"><span className="unavailable">Unavailable</span></Fact><Fact label="Review lifetime">30 seconds</Fact></dl>
      {wrongChain && <p className="inline-message inline-message--warning"><Icon name="info" />Switch your selected wallet to Ethereum to continue.</p>}
      {facts?.paused && <p className="inline-message inline-message--warning"><Icon name="info" />This market is paused. New positions are unavailable.</p>}
      {state.flow.stage === 'failed' && !state.flow.plan && <p className="inline-message inline-message--error" role="alert"><Icon name="warning" />{state.flow.error.message}</p>}
      <button type="button" className="button button--primary trade-action" disabled={disabled} onClick={primary}><span>{buttonLabel}</span><Icon name={locked ? 'clock' : !state.wallet ? 'wallet' : preparing ? 'shield' : 'arrow'} /></button>
      {preparing ? <div className="preparation-status"><span role="status">Checking the route, simulation and fees.</span><button type="button" className="text-button" onClick={() => controller.cancelReview()}>Cancel</button></div> : <p className="ticket-assurance"><Icon name="shield" />Review first. Your wallet approves the transaction.</p>}
    </div>
    <footer className="ticket-footer"><span className="protocol-dot" />Powered by f(x) Protocol<span>ETH long</span></footer>
  </section>;
}

function HistoryRow({ entry, controller, runtime }: { entry: HistoryEntry } & AppProps) {
  const [observing, setObserving] = useState(false);
  const verified = entry.verifiedInSession;
  const confirmed = entry.state === 'confirmed' && verified && entry.receipt?.status === 'success';
  const terminalNeedsCheck = !verified && (entry.state === 'confirmed' || entry.state === 'reverted');
  const labels: Record<HistoryEntry['state'], string> = { 'wallet-request': 'Wallet requested', pending: 'Pending', unverified: 'Unverified', reverted: 'Reverted', confirmed: 'Confirmed', declined: 'Declined' };
  const label = terminalNeedsCheck ? 'Needs verification' : labels[entry.state];
  let deposit = 'Unavailable';
  try { deposit = `${exactAmount(BigInt(entry.amountWei))} ETH`; } catch { /* A corrupt historical hint is not an amount. */ }
  return <details className="history-entry">
    <summary><span className="history-asset"><EthereumMark /></span><span className="history-description"><strong>{confirmed && entry.receipt?.positionId !== undefined ? 'Opened ETH long' : 'ETH long attempt'}</strong><span>{dateLabel(entry.createdAt)}<span className="history-dot">·</span>{multiplier(entry.leverageBps)} requested</span></span><span className="history-value"><strong>{deposit}</strong><span className={`history-status history-status--${terminalNeedsCheck ? 'unverified' : entry.state}`}>{label}</span></span><Icon name="chevron" /></summary>
    <div className="history-entry-body"><dl className="review-facts"><Fact label="Wallet"><code className="address-value">{entry.account}</code></Fact><Fact label="Network">Ethereum</Fact><Fact label="Requested leverage">{multiplier(entry.leverageBps)}</Fact></dl>
      {terminalNeedsCheck && <p className="inline-message inline-message--warning"><Icon name="info" />This saved status has not been verified in this session. Check the receipt for current evidence.</p>}
      {entry.receipt && verified ? <ReceiptDetails receipt={entry.receipt} mode={runtime.mode} /> : entry.hash ? <TransactionHash hash={entry.hash} mode={runtime.mode} /> : <p className="fine-print">No verified transaction hash was returned for this attempt.</p>}
      {entry.hash && <button type="button" className="button button--secondary history-check" disabled={observing} onClick={() => { setObserving(true); void controller.checkReceipt(entry.id).finally(() => setObserving(false)); }}>{observing ? 'Checking receipt…' : 'Check receipt'}<Icon name="refresh" /></button>}
    </div>
  </details>;
}

function HistoryPage({ state, controller, runtime, onWallet }: AppProps & { state: AppState; onWallet(): void }) {
  const entries = state.wallet ? state.history.filter(entry => entry.account.toLowerCase() === state.wallet!.address.toLowerCase()) : [];
  return <main id="main-content" className="history-page" tabIndex={-1}>
    <div className="page-eyebrow"><span className="status-dot" />ETHEREUM</div><div className="history-page-heading"><div><h1>Your history.</h1><p>Each attempt. Every verified outcome.</p></div>{state.wallet && <span className="history-account"><Icon name="wallet" />{shortAddress(state.wallet.address)}</span>}</div>
    <section className="history-panel" aria-label="Wallet transaction history">
      <div className="history-panel-header"><h2>ETH long transactions</h2><span>{entries.length} {entries.length === 1 ? 'record' : 'records'}</span></div>
      {entries.length ? <div className="history-list">{entries.map(entry => <HistoryRow key={entry.id} entry={entry} controller={controller} runtime={runtime} />)}</div> : <div className="empty-history"><span className="empty-history-icon"><Icon name="history" /></span><h3>{state.wallet ? 'A fresh start.' : 'Your history belongs to you.'}</h3><p>{state.wallet ? 'Your position attempts and submitted transactions will appear here.' : 'Connect your wallet to see its transaction attempts and verified receipts.'}</p><button type="button" className="button button--secondary" onClick={() => state.wallet ? controller.navigate('trade') : onWallet()}>{state.wallet ? 'Open an ETH long' : 'Connect wallet'}<Icon name={state.wallet ? 'arrow' : 'wallet'} /></button></div>}
    </section><p className="history-scope"><Icon name="shield" />{state.wallet ? 'Only records for this wallet are shown. Saved statuses are checked against chain evidence.' : 'Connecting does not approve a transaction.'}</p>
  </main>;
}

export function App({ controller, runtime }: AppProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const overlayRef = useRef<Overlay>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const connectingRef = useRef<string | null>(null);
  const connectionGeneration = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const marker = useRef<string | null>(null);
  const closingBack = useRef(false);
  const afterClose = useRef<(() => void) | null>(null);
  const closeRef = useRef<(after?: () => void) => void>(() => undefined);
  const previousStage = useRef<Flow['stage']>('editing');
  const returnFocus = useRef<HTMLElement | null>(null);

  const openOverlay = useCallback((kind: Exclude<Overlay, null>) => {
    if (closingBack.current) { afterClose.current = () => openOverlay(kind); return; }
    if (!overlayRef.current) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && active !== document.body && !active.closest('[inert]') ? active : document.querySelector<HTMLElement>(kind === 'review' ? '.trade-action' : '.wallet-trigger');
      const value = `fxaeon-overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.history.pushState({ ...window.history.state, fxaeonOverlay: value }, '', window.location.href);
      marker.current = value;
    }
    overlayRef.current = kind;
    setOverlay(kind);
  }, []);

  const dismissOverlay = useCallback((after?: () => void, fromBack = false) => {
    const old = overlayRef.current;
    if (old === 'wallet' && connectingRef.current) {
      connectionGeneration.current++;
      connectingRef.current = null;
      setConnecting(null);
      controller.disconnect();
    }
    if (old === 'review' && ['editing', 'preparing', 'review', 'expired', 'failed'].includes(stateRef.current.flow.stage)) controller.cancelReview();
    overlayRef.current = null;
    setOverlay(null);
    if (!fromBack && marker.current && window.history.state?.fxaeonOverlay === marker.current) {
      closingBack.current = true;
      afterClose.current = after ?? null;
      window.history.back();
    } else {
      marker.current = null;
      after?.();
    }
  }, [controller]);
  closeRef.current = dismissOverlay;

  useEffect(() => {
    const onPop = () => {
      if (closingBack.current) {
        closingBack.current = false;
        marker.current = null;
        const next = afterClose.current;
        afterClose.current = null;
        next?.();
      } else if (overlayRef.current && marker.current && window.history.state?.fxaeonOverlay !== marker.current) dismissOverlay(undefined, true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dismissOverlay]);

  useEffect(() => {
    runtime.host.setBackHandler(overlay ? () => { closeRef.current(); return true; } : null);
    return () => runtime.host.setBackHandler(null);
  }, [overlay, runtime.host]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.colorScheme = state.theme;
    runtime.host.setTheme(state.theme);
  }, [state.theme, runtime.host]);

  useEffect(() => {
    const previous = previousStage.current;
    previousStage.current = state.flow.stage;
    if (state.flow.stage === 'review' && previous !== 'review' && previous !== 'expired') openOverlay('review');
    if (state.flow.stage === 'editing' && overlayRef.current === 'review') closeRef.current();
  }, [state.flow.stage, openOverlay]);

  const connect = (id: string) => {
    if (connectingRef.current || stateRef.current.wallet) return;
    controller.clearNotice();
    const generation = ++connectionGeneration.current;
    connectingRef.current = id;
    setConnecting(id);
    void controller.connect(id).then(() => {
      if (generation !== connectionGeneration.current) return;
      connectingRef.current = null;
      setConnecting(null);
      if (controller.getSnapshot().wallet) dismissOverlay();
    }, () => {
      if (generation !== connectionGeneration.current) return;
      connectingRef.current = null;
      setConnecting(null);
    });
  };
  const active = lockedStages.includes(state.flow.stage);
  const progressLabel = state.flow.stage === 'checking' ? 'Checking transaction' : state.flow.stage === 'signing' ? 'Wallet request' : state.flow.stage === 'unverified' ? 'Check transaction' : 'Transaction pending';
  return <div className="fx-app" data-theme={state.theme}>
    <div className="app-surface" inert={overlay !== null}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="header-shell">
        {runtime.mode !== 'live' && <div className="environment-banner" role="region" aria-label="Environment"><span><span className="status-dot" />{modeName(runtime.mode)} environment</span><span>{runtime.mode === 'simulation' ? 'Practice transactions. No real funds.' : 'Disposable local chain. No mainnet funds.'}</span></div>}
        <header className="app-header"><button type="button" className="brand" aria-label="FxAeon Trade" onClick={() => controller.navigate('trade')}><FxMark /><span>FxAeon</span></button><nav className="primary-nav" aria-label="Main navigation"><button type="button" aria-current={state.route === 'trade' ? 'page' : undefined} onClick={() => controller.navigate('trade')}>Trade</button><button type="button" aria-current={state.route === 'history' ? 'page' : undefined} onClick={() => controller.navigate('history')}>History</button></nav><div className="header-actions"><button type="button" className="icon-button theme-toggle" aria-label={`Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => controller.setTheme(state.theme === 'dark' ? 'light' : 'dark')}><Icon name={state.theme === 'dark' ? 'sun' : 'moon'} /></button><button type="button" className={`wallet-trigger ${state.wallet ? 'wallet-trigger--connected' : ''}`} data-focus-fallback onClick={() => openOverlay('wallet')}><Icon name="wallet" /><span>{state.wallet ? shortAddress(state.wallet.address) : 'Connect wallet'}</span>{state.wallet && <span className="status-dot" />}</button></div></header>
      </div>
      {active && <div className="activity-strip" role="status"><span><span className="pending-mark" />{progressLabel}</span><button type="button" className="text-button" onClick={() => openOverlay('review')}>View progress<Icon name="arrow" /></button></div>}
      {state.notice && <div className="notice-banner" role="alert"><Icon name="info" /><p>{state.notice.message}</p><button type="button" className="icon-button" aria-label="Dismiss notice" onClick={() => controller.clearNotice()}><Icon name="close" /></button></div>}
      {state.route === 'trade' ? <main id="main-content" className="trade-page" tabIndex={-1}><div className="page-eyebrow"><span className="status-dot" />ON YOUR TERMS</div><div className="trade-workspace"><MarketContext state={state} controller={controller} runtime={runtime} /><TradeTicket state={state} controller={controller} onWallet={() => openOverlay('wallet')} onProgress={() => openOverlay('review')} /></div><div className="trade-bottom-note"><span>Clear terms. Explicit approval.</span><span>ETH long on Ethereum</span></div></main> : <HistoryPage state={state} controller={controller} runtime={runtime} onWallet={() => openOverlay('wallet')} />}
      <footer className="app-footer"><span><FxMark />FxAeon</span><p>Your wallet. Your position.</p><span className="footer-network"><span className="status-dot" />{modeName(runtime.mode)}</span></footer>
    </div>
    {overlay === 'wallet' && <WalletDialog state={state} controller={controller} runtime={runtime} onClose={() => dismissOverlay()} pending={connecting} onConnect={connect} returnFocus={returnFocus.current} />}
    {overlay === 'review' && <ReviewDialog state={state} controller={controller} runtime={runtime} onClose={() => dismissOverlay()} onHistory={() => dismissOverlay(() => controller.navigate('history'))} onRefresh={() => dismissOverlay(() => { void controller.prepare(); })} returnFocus={returnFocus.current} />}
  </div>;
}
