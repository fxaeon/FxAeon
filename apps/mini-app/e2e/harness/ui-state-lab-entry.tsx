import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AmountFieldView } from '@/components/AmountField';
import { buildReceiptPresentation } from '@/lib/receiptPresentation';
import { FX_TOKENS } from '@/lib/fx/tokens';
import { ActionConsequenceSummary, ReceiptSummary } from '@/components/review/ActionReviewSummary';
import { LabTransaction, labTransactionStages, type LabProduct, type LabTransactionStage } from './state-lab-transactions';

type DataState = 'loading' | 'zero' | 'positive' | 'partial' | 'stale' | 'unavailable';
const dataStates: DataState[] = ['loading', 'zero', 'positive', 'partial', 'stale', 'unavailable'];
const txStages = labTransactionStages;
const address = '0x00000000000000000000000000000000000000aa' as `0x${string}`;
const receiptExamples = {
  ethereum: buildReceiptPresentation({ chainId: 1, walletAddress: address, status: 'success', transfers: [{ token: FX_TOKENS.USDC.address, from: address, to: '0x00000000000000000000000000000000000000bb', amountRaw: 1_234_500n }] }),
  base: buildReceiptPresentation({ chainId: 8453, walletAddress: address, status: 'success', transfers: [{ token: '0x3333333333333333333333333333333333333333', from: address, to: '0x00000000000000000000000000000000000000bb', amountRaw: 9n }], executionCostWei: 21_000_000_000_000n }),
};
const dataFixtures: Record<DataState, { balanceState: { status: 'loading' | 'ready' | 'unavailable'; amount?: string; reason?: string }; title: string; detail: string }> = {
  loading: { balanceState: { status: 'loading' }, title: 'Checking balance', detail: 'The verified balance is still loading.' },
  zero: { balanceState: { status: 'ready', amount: '0' }, title: 'No available balance', detail: 'A verified zero is distinct from missing data.' },
  positive: { balanceState: { status: 'ready', amount: '1234.56789' }, title: 'Balance available', detail: 'Deterministic fixture: 1,234.56789 ETH.' },
  partial: { balanceState: { status: 'ready', amount: '12.5' }, title: 'Some data is unavailable', detail: 'Balance is verified; the USD price is unavailable.' },
  stale: { balanceState: { status: 'unavailable', reason: 'Fixture data is stale' }, title: 'Balance needs refresh', detail: 'Stale values are not presented as current.' },
  unavailable: { balanceState: { status: 'unavailable', reason: 'Fixture RPC unavailable' }, title: 'Balance unavailable', detail: 'Fixture RPC unavailable. Retry when data is available.' },
};

function Lab() {
  const [dataState, setDataState] = useState<DataState>('positive');
  const [amount, setAmount] = useState('1234.56789');
  const theme = 'dark';
  const query = new URLSearchParams(window.location.search);
  const initialStage = txStages.find(item => item.toLowerCase().replaceAll(' ', '-') === query.get('stage')) ?? 'Review';
  const [stage, setStage] = useState<LabTransactionStage>(initialStage);
  const [product, setProduct] = useState<LabProduct>(query.get('product') === 'earn' ? 'earn' : 'borrow');
  const transactionOnly = query.get('view') === 'transaction';
  const fixture = dataFixtures[dataState];
  const amountBalance = query.get('amountBalance');
  const balanceState = dataState === 'positive' && amountBalance && /^\d+(?:\.\d{1,18})?$/.test(amountBalance)
    ? { status: 'ready' as const, amount: amountBalance } : fixture.balanceState;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.productUi = 'v2';
  return <main data-harness-ready="true" data-theme={theme} className={`lab ${transactionOnly ? 'lab-transaction-only' : ''}`}>
    <style>{`
      html,body{height:auto;min-height:100%;overflow:auto}.lab{min-height:100vh;padding:20px;max-width:1100px;margin:auto;background:var(--bg);color:var(--text)}.lab>h1,.lab-panel>h2,.lab-panel>h3,.lab-panel>p{margin:0}.lab>h1{font-size:22px}.lab-panel>h2{font-size:16px;margin-bottom:10px}.lab-panel>h3,.receipt-example>h3,.consequence-example>h3{font-size:13px;margin:14px 0 8px}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}.toolbar label{display:flex;align-items:center;gap:6px;color:var(--mut)}.toolbar select,.toolbar button,.lab-states button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 10px}.lab-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.lab-panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg,14px);padding:16px;min-width:0}.subtle{color:var(--mut);font-size:12px}.field-shell{margin-top:12px}.lab-states{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.lab-states button[aria-pressed=true]{border-color:var(--mint);box-shadow:0 0 0 1px var(--mint)}.stage-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stage{border:1px solid var(--line);border-radius:9px;padding:9px;min-height:66px}.stage[data-current=true]{border-color:var(--mint)}.stage strong{display:block}.presentation{margin-top:16px}.transaction-preview{--font-sans:Inter,Arial,sans-serif;min-width:0;max-width:480px;margin:auto}.lab-transaction-only{max-width:560px;padding:12px}.lab-transaction-only>.toolbar{margin:8px 0 14px;gap:6px 12px}.lab-transaction-only>.toolbar label{font-size:12px;gap:5px}.lab-transaction-only>.toolbar select{min-height:44px;max-width:100%;padding:5px 8px;font-size:12px}.focused-preview{min-width:0;margin-top:12px}.lab-sheet-fixture{margin:5px 0 0;color:var(--mut);font-size:11px;line-height:1.4}.lab-preview-open{min-height:44px;padding:8px 12px;border-radius:12px;background:var(--surface-2)}body:has([data-mobile-review-sheet]) .fixture-banner{visibility:hidden}.transaction-panel{min-width:0}.receipt-example{margin-top:12px}.receipt-example pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.toolbar :where(button,select):focus-visible,.lab-states button:focus-visible{outline:2px solid var(--mint);outline-offset:3px}.amount-preview{font-size:26px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.long-label{overflow-wrap:anywhere}.access-note{margin-top:12px;color:var(--mut)}@media(max-width:620px){.lab{padding:12px}.lab-grid{grid-template-columns:1fr}.stage-list{grid-template-columns:1fr 1fr}}@media(max-height:620px){.lab{padding-top:8px}.lab-panel{padding:10px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
    `}</style>
    {!transactionOnly && <h1>FxAeon UI state lab</h1>}
    <p className="subtle fixture-banner">{transactionOnly ? 'Fixture preview · no transaction sent' : 'Fixture preview · no transaction sent · deterministic local data · no wallet or backend actions'}</p>
    <div className="toolbar" role="toolbar" aria-label="State lab controls">
      <label>Product <select aria-label="Fixture product" value={product} onChange={event => setProduct(event.target.value as LabProduct)}><option value="borrow">Borrow</option><option value="earn">Earn</option></select></label>
      <label>Transaction stage <select aria-label="Transaction stage" value={stage} onChange={(event) => setStage(event.target.value as LabTransactionStage)}>{txStages.map((item) => <option key={item}>{item}</option>)}</select></label>
      {!transactionOnly && <><button type="button" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Amount in ETH"]')?.focus()}>Focus amount</button>
      <button type="button" onClick={() => document.documentElement.style.setProperty('scroll-behavior', 'smooth')}>Motion sample</button></>}
    </div>
    {transactionOnly ? <div className="focused-preview"><LabTransaction key={`${product}-${stage}`} framed product={product} stage={stage} onReset={() => setStage('Review')} onContinue={() => setStage('Signature required')} /></div> : <div className="lab-grid">
      <section className="lab-panel" aria-labelledby="data-heading"><h2 id="data-heading">Data states</h2>
        <p className="subtle">{fixture.title} — {fixture.detail}</p>
        <div className="lab-states" role="group" aria-label="Balance fixture state">{dataStates.map((item) => <button key={item} type="button" aria-pressed={item === dataState} onClick={() => setDataState(item)}>{item}</button>)}</div>
        <div className="field-shell"><AmountFieldView value={amount} onChange={setAmount} symbol="ETH" label="Amount" balanceState={balanceState} unitPrice={dataState === 'positive' ? 3456.78 : undefined} priceStatus={dataState === 'loading' ? 'loading' : dataState === 'positive' ? 'ready' : 'unavailable'} showUnitPrice /></div>
      </section>
      <section className="lab-panel transaction-panel" aria-labelledby="transaction-heading"><h2 id="transaction-heading">Transaction stages</h2>
        <p className="subtle">Selected fixture: <strong>{stage}</strong>. These are display fixtures; signing and submission are disabled.</p>
        <div className="stage-list" aria-label="Transaction state examples">{txStages.map((item, index) => <div className="stage" data-current={item === stage || undefined} key={item}><strong>{item}</strong><span className="subtle">{['Edit terms', 'Quote pending', 'Accepted terms', 'Not submitted', 'Awaiting wallet', 'Hash available', 'One step remains', 'Receipt verified', 'Request declined', 'Status needs checking'][index]}</span></div>)}</div>
        <div className="presentation"><LabTransaction key={`${product}-${stage}`} product={product} stage={stage} onReset={() => setStage('Review')} onContinue={() => setStage('Signature required')} /></div>
        <div className="consequence-example"><h3>Review consequence summary</h3><ActionConsequenceSummary facts={[{ label: 'Deposit', value: '1.23456789 ETH' }, { label: 'Borrow', value: '4,000 fxUSD' }, { label: 'Estimated debt', value: '4,000 fxUSD' }]} /></div><p className="access-note">No transaction controls are connected in this catalog.</p>
      </section>
      <section className="lab-panel"><h2>Layout stress</h2><p className="subtle">Resize the viewport to inspect narrow phone, short phone, tablet, and desktop layouts.</p><div className="amount-preview" aria-label="Long amount example">1234567890.123456789012345</div><p className="long-label">Long label fixture: Expected receipt after estimated route and network fee adjustments</p></section>
      <section className="lab-panel"><h2>Appearance and access</h2><p>Use keyboard Tab navigation and the focus control. Reduced motion follows the browser’s prefers-reduced-motion setting.</p><p className="access-note">Try browser emulation with reduced motion enabled to inspect transitions.</p></section>
      <section className="lab-panel receipt-panel" aria-labelledby="receipt-heading"><h2 id="receipt-heading">Receipt detail fixtures</h2><p className="subtle">Deterministic receipt-derived display model; known and unknown assets stay distinguishable.</p>
        <article className="receipt-example"><h3>Ethereum · verified USDC movement</h3><ReceiptSummary receipts={[receiptExamples.ethereum]} /></article>
        <article className="receipt-example"><h3>Base · execution fee and unknown token</h3><ReceiptSummary receipts={[receiptExamples.base]} /></article>
      </section>
    </div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Lab />);
