import React, { useRef, useState, type ReactNode } from 'react';
import { Button, Card } from '@/components/ui';
import { MobileFlowSheet } from '@/components/MobileFlowSheet';
import { PendingTransactionSummary } from '@/components/review/PendingTransactionSummary';
import { TransactionResultView } from '@/components/review/TransactionResultView';
import { TransactionAmountFlow } from '@/components/review/TransactionAmountFlow';
import { ReviewTermRow } from '@/components/review/ReviewTermRow';
import { ReviewViewport } from '@/components/review/ReviewViewport';
import { TransactionEvidenceContext } from '@/components/review/TransactionEvidenceContext';
import { resultPresentation } from '@/components/review/executionResult';
import { transactionCardIdentity } from '@/components/review/transactionCardIdentity';
import { buildReceiptPresentation } from '@/lib/receiptPresentation';
import { borrowFundingDisplay } from '@/lib/fx/borrowFunding';
import { positionPoolAddress } from '@/lib/fx/policy';
import { FX_TOKENS } from '@/lib/fx/tokens';
import type { PlannedRoute, TransactionExecutionResult, TransactionStepResult } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import styles from '@/components/review/ActionReviewPresentation.module.css';
import flowStyles from '@/components/FlowWorkspace.module.css';

export type LabProduct = 'borrow' | 'earn';
export const labTransactionStages = ['Editing', 'Preparing', 'Review', 'Signature required', 'Wallet request', 'Submitted', 'Partial completion', 'Confirmed', 'Failed', 'Uncertain'] as const;
export type LabTransactionStage = typeof labTransactionStages[number];

const account = '0x00000000000000000000000000000000000000aa' as const;
const recipient = '0x00000000000000000000000000000000000000bb' as const;
const hash = `0x${'1'.repeat(64)}` as `0x${string}`;
const blockHash = `0x${'2'.repeat(64)}` as `0x${string}`;

function fixture(product: LabProduct) {
  const borrow = product === 'borrow';
  const operation: PlannedRoute['operation'] = borrow ? 'depositAndMint' : 'depositFxSave';
  const transaction = { chainId: 1, from: account, to: recipient, data: '0x12345678', value: borrow ? 10n ** 18n : 0n, kind: 'action', operation, type: operation } as const;
  const receipt: NonNullable<TransactionStepResult['receipt']> = {
    transactionHash: hash, transactionIndex: 0, blockHash, blockNumber: 1n, from: account, to: recipient,
    cumulativeGasUsed: 125000n, gasUsed: 125000n, effectiveGasPrice: 1000000000n,
    contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}` as `0x${string}`, status: 'success', type: 'legacy',
  };
  const facts: ReviewFact[] = borrow
    ? [{ label: 'Deposit', value: '1 ETH' }, { label: 'Estimated fxUSD received', value: '1,194 fxUSD' }]
    : [{ label: 'Deposit', value: '1,000 USDC' }, { label: 'Estimated shares', value: '952.380952380952380952 fxSAVE' }];
  const annualFundingRatio = 35_000_000_000_000_000n; // 3.5% gross annual charge; short offset verified zero.
  const funding = borrow ? borrowFundingDisplay({ market: 'ETH', pool: positionPoolAddress('ETH', 'long'), ratio: annualFundingRatio, netRatio: annualFundingRatio, readAt: Date.now() }) : undefined;
  const terms: ReviewFact[] = borrow
    ? [{ label: 'Estimated debt', value: '1,200 fxUSD' }, { label: 'Loan-to-value', value: '50%' }, { label: 'Borrow rate', value: funding!.value, equivalent: funding!.status, title: `Fixture only. ${funding!.title}` }]
    : [{ label: 'Current APY', value: '6.25%', title: 'Fixture only: variable yield, not a promised return.' }, { label: 'Minimum received', value: '947.619047619047619047 fxSAVE' }];
  terms.push({ label: 'Gas fee', value: '0.000125 ETH', title: '0.000125 ETH (simulated estimate, not a live gas quote)' });
  if (borrow) terms.push({ label: 'f(x) fee', value: '6 fxUSD (0.5%)', title: '6 fxUSD; simulated 0.5% of 1,200 fxUSD gross debt, deducted before the 1,194 fxUSD payout. Excludes gas.', feeAmounts: [{ amount: '6', symbol: 'fxUSD' }] });
  const route: PlannedRoute = { chainId: 1, walletAddress: account, operation, transactions: [transaction] };
  const identity = { ...transactionCardIdentity(route, facts, borrow ? 'Borrow fxUSD' : 'Deposit into fxSAVE'), review: borrow ? 'Review borrowing' : 'Review deposit', confirm: borrow ? 'Borrow fxUSD' : 'Deposit USDC' };
  const movementReceipt = buildReceiptPresentation({ chainId: 1, walletAddress: account, status: 'success', transactionKind: 'action', executionCostWei: 125000000000000n,
    nativeValueWei: borrow ? 10n ** 18n : 0n,
    transfers: borrow ? [{ token: FX_TOKENS.fxUSD.address, from: recipient, to: account, amountRaw: 1194n * 10n ** 18n }]
      : [{ token: FX_TOKENS.USDC.address, from: account, to: recipient, amountRaw: 1000n * 10n ** 6n }, { token: FX_TOKENS.fxSAVE.address, from: recipient, to: account, amountRaw: 952380952380952380952n }],
  });
  return { transaction, receipt, facts, terms, route, identity, movementReceipt, operation, borrow };
}

/** Real presentation components; every callback stays within this local catalog. */
export function LabTransaction({ product, stage, onReset, onContinue, framed = false }: { product: LabProduct; stage: LabTransactionStage; onReset: () => void; onContinue: () => void; framed?: boolean }) {
  const sample = fixture(product);
  // Explicit missing-quote scenario stays available beside the funded example.
  if (new URLSearchParams(window.location.search).get('protocolFee') === 'unavailable') {
    const fee = sample.terms.find(fact => fact.label === 'f(x) fee');
    if (fee) { fee.value = 'Unavailable'; fee.title = 'Fixture only: no protocol fee amount quote is available.'; delete fee.feeAmounts; }
  }
  const step: TransactionStepResult = { index: 0, transaction: sample.transaction, hash, status: 'confirmed', receipt: sample.receipt };
  const approval: TransactionStepResult = { ...step, transaction: { ...sample.transaction, kind: 'approval', value: 0n, type: 'approveToken' } };
  const resultStage = ['Confirmed', 'Partial completion', 'Failed', 'Uncertain'].includes(stage);
  const result: TransactionExecutionResult = { chainId: 1, walletAddress: account, operation: sample.operation,
    status: stage === 'Confirmed' ? 'confirmed' : stage === 'Partial completion' ? 'partial' : 'failed',
    error: stage === 'Failed' ? 'User declined the wallet request.' : undefined,
    steps: stage === 'Confirmed' ? [step] : stage === 'Partial completion' ? [approval, { index: 1, transaction: sample.transaction, status: 'failed' }]
      : stage === 'Uncertain' ? [{ ...step, status: 'failed', receipt: undefined, error: 'Fixture receipt lookup unavailable' }]
        : [{ index: 0, transaction: sample.transaction, status: 'failed' }],
  };
  const pending = ['Signature required', 'Wallet request', 'Submitted'].includes(stage);
  const content = <>
      {resultStage ? <TransactionResultView result={result}
        presentation={resultPresentation(result, false, sample.borrow ? 'fxUSD borrowed' : 'Deposited into fxSAVE')}
        refreshing={false} positionAction={sample.borrow} reviewedFacts={[...sample.facts, ...sample.terms]} reviewIdentity={sample.identity}
        confirmedPosition={stage === 'Confirmed' && sample.borrow ? { walletAddress: account, chainId: 1, transactionHash: hash, key: 'ETH:long:42', readAt: Date.now(),
          facts: [{ label: 'Collateral', value: '1 ETH' }, { label: 'Debt', value: '1,200 fxUSD' }, { label: 'Leverage', value: '2×' }] } : undefined}
        receipts={stage === 'Confirmed' ? [sample.movementReceipt] : stage === 'Partial completion' ? [buildReceiptPresentation({ chainId: 1, status: 'success', transactionKind: 'approval', executionCostWei: 30000000000000n })] : []}
        nextLabel={stage === 'Confirmed' ? sample.borrow ? 'View position' : 'Back to Earn' : stage === 'Uncertain' ? 'Check History' : 'Review again'} onNext={onReset} />
        : <ReviewViewport phase={pending ? 'executing' : 'review'}>
          <header data-review-header className={styles.reviewHeader}><h3>{pending ? sample.identity.name : sample.identity.review}</h3></header>
          <div data-review-scroll className={styles.reviewScrollBody} role="region" aria-label="Review information" tabIndex={0}>
          {pending ? <PendingTransactionSummary identity={sample.identity} facts={sample.facts} chainId={1} status={stage === 'Submitted' ? 'submitted' : 'awaiting-user'}
            steps={stage === 'Submitted' ? [{ ...step, receipt: undefined, status: 'submitted' }] : []} networkSwitching={false} nextKind="action" showIdentity={false}
            requestLabel={stage === 'Signature required' ? 'Signature required · not submitted' : sample.identity.name} requestNumber={1} requestCount={1} />
            : <div data-review-essential className={styles.amountLedReview}>
              {stage === 'Preparing' && <p role="status" className={styles.stableReviewStatus}>Preparing fixture terms</p>}
              {stage === 'Editing' && <p className={styles.stableReviewStatus}>Unsubmitted fixture draft</p>}
              <TransactionAmountFlow facts={sample.facts} chainId={1} compact />
              <div className={styles.consequenceGroup}>{sample.terms.map(fact => <ReviewTermRow key={fact.label} fact={fact} displayLabel={fact.label === 'Borrow rate' ? 'Funding status' : fact.label === 'Current APY' ? 'APY' : fact.label === 'Gas fee' ? 'Network fee' : undefined} />)}</div>
            </div>}
          </div>
          {!pending && <div data-review-actions className={`${flowStyles.reviewInlineActions} ${styles.actions}`}><Button className={flowStyles.primaryAction} disabled={stage !== 'Review'} onClick={onContinue}>{sample.identity.confirm}</Button></div>}
        </ReviewViewport>}
    </>;
  return <TransactionEvidenceContext.Provider value="simulation">{framed
    ? <FocusedTransactionFrame product={product} stage={stage} title={resultStage ? stage === 'Confirmed' ? sample.borrow ? 'fxUSD borrowed' : 'Deposited into fxSAVE' : 'Review transaction' : pending ? sample.identity.name : sample.identity.review} hideTitle={resultStage}>{content}</FocusedTransactionFrame>
    : <section className="transaction-preview" data-fixture-product={product} data-fixture-stage={stage} aria-label={`${product === 'borrow' ? 'Borrow' : 'Earn'} transaction preview`}>{content}</section>}</TransactionEvidenceContext.Provider>;
}

/** The same desktop Card and phone sheet used by ActionReview's ReviewSurface.
 * The catalog controls and fixture notice stay outside the product surface. */
function FocusedTransactionFrame({ product, stage, title, hideTitle, children }: { product: LabProduct; stage: LabTransactionStage; title: string; hideTitle: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!open) return <button ref={triggerRef} type="button" className="lab-preview-open" onClick={() => setOpen(true)}>Show transaction preview</button>;
  return <MobileFlowSheet title={title} hideTitle={hideTitle} onClose={() => setOpen(false)} triggerRef={triggerRef}
    subtitle={<p className="lab-sheet-fixture">Fixture preview · no transaction sent</p>}>
    <Card data-review-surface data-fixture-product={product} data-fixture-stage={stage} role="region" aria-label={`${product === 'borrow' ? 'Borrow' : 'Earn'} transaction preview`}
      className={`transaction-preview ${flowStyles.reviewCard} ${flowStyles.reviewInlineCard} p-4 sm:p-5`}>{children}</Card>
  </MobileFlowSheet>;
}
