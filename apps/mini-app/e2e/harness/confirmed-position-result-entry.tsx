import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileFlowSheet } from '@/components/MobileFlowSheet';
import { Card } from '@/components/ui';
import { TransactionResultView } from '@/components/review/TransactionResultView';
import { TransactionEvidenceContext } from '@/components/review/TransactionEvidenceContext';
import { resultPresentation } from '@/components/review/executionResult';
import { buildReceiptPresentation } from '@/lib/receiptPresentation';
import { FX_TOKENS } from '@/lib/fx/tokens';
import { USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '@/lib/prices';
import { AMOUNT_UNIT_KEY } from '@/lib/amountUnit';
import type { TransactionExecutionResult } from '@/lib/fx/types';
import type { ConfirmedPositionReadback } from '@/components/review/positionReview';
import flow from '@/components/FlowWorkspace.module.css';

const wallet = '0x1111111111111111111111111111111111111111';
const hash = `0x${'a'.repeat(64)}`;
const query = new URLSearchParams(location.search);
const operation = query.get('product') === 'borrow' ? 'depositAndMint' : 'increasePosition';
const snapshotTime = Date.now();
export const fixture = {
  prices: { prices: { stETH: 2000, fxUSD: .97, ETH: 2000, USDC: 1.01 }, status: 'ready', updatedAt: snapshotTime,
    updatedAts: { stETH: snapshotTime, fxUSD: snapshotTime } } as UsdPriceSnapshot,
  readback: { walletAddress: wallet, chainId: 1, transactionHash: hash, key: 'ETH:long:42', readAt: snapshotTime,
    facts: [{ label: 'Collateral', value: '0.358481260986328125 stETH' }, { label: 'Debt', value: '720.89147659306640625 fxUSD' }, { label: 'Leverage', value: '2×' }] } as ConfirmedPositionReadback,
  rerender: () => {}, maxAge: USD_PRICE_MAX_AGE_MS,
};
localStorage.setItem(AMOUNT_UNIT_KEY, query.get('unit') === 'usd' ? 'usd' : 'token');
if (query.get('prices') === 'stale') fixture.prices.updatedAts = { stETH: snapshotTime - USD_PRICE_MAX_AGE_MS - 1, fxUSD: snapshotTime - USD_PRICE_MAX_AGE_MS - 1 };
if (query.get('prices') === 'missing') fixture.prices.prices = { ETH: 2000 };
if (query.get('prices') === 'partial') fixture.prices.updatedAts!.fxUSD = snapshotTime - USD_PRICE_MAX_AGE_MS - 1;
if (query.has('mismatch')) fixture.readback.transactionHash = `0x${'b'.repeat(64)}`;
if (query.has('unavailable')) fixture.readback.facts[0].value = 'Unavailable';
if (query.has('long')) {
  fixture.readback.facts[0].value = '1234567890.123456789012345 stETH';
  fixture.readback.facts[1].value = '9876543210.987654321098765 fxUSD';
}
if (query.has('tiny')) fixture.readback.facts[0].value = '0.00000000123456789 stETH';
const transaction = { chainId: 1, from: wallet, to: wallet, data: '0x', value: 0n, kind: 'action', operation };
const result = { chainId: 1, walletAddress: wallet, operation, status: 'confirmed', steps: [
  { index: 0, transaction, hash, status: 'confirmed', receipt: { status: 'success' } },
] } as unknown as TransactionExecutionResult;
const receipts = [buildReceiptPresentation({ chainId: 1, walletAddress: wallet, transactionKind: 'action', status: 'success', executionCostWei: 125000000000000n,
  transfers: [{ token: FX_TOKENS.USDC.address, from: wallet, to: '0x2222222222222222222222222222222222222222', amountRaw: 100000000n }] })];

function Harness() {
  const [, render] = useState(0);
  fixture.rerender = () => render(value => value + 1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <TransactionEvidenceContext.Provider value={query.has('simulated') ? 'simulation' : 'live'}>
    <MobileFlowSheet title="Transaction complete" hideTitle onClose={() => {}} triggerRef={triggerRef}>
      <Card className={`${flow.reviewCard} ${flow.reviewInlineCard} p-4 sm:p-5`}>
        <TransactionResultView result={result} presentation={resultPresentation(result, false, operation === 'depositAndMint' ? 'fxUSD borrowed' : 'ETH Long opened')}
          receipts={receipts} positionAction refreshing={false} confirmedPosition={fixture.readback} nextLabel="View position" onNext={() => {}} />
      </Card>
    </MobileFlowSheet>
  </TransactionEvidenceContext.Provider>;
}
(window as unknown as { confirmedFixture: typeof fixture }).confirmedFixture = fixture;
createRoot(document.getElementById('root')!).render(<Harness />);
