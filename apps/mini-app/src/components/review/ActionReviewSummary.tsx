import { ReviewFactValue } from './ReviewFactValue';
import { MetricLabel } from '../InfoHelp';
import { reviewHelpDefinition } from './reviewHelp';
import { formatReviewFactValue } from './reviewFactFormatting';
import { AmountUsd, FeeUsd } from './AmountUsd';
import { reviewFactLabel } from './reviewHierarchy';
import type { ChangedReviewFact, PairedPositionFact } from './actionReviewModel';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { receiptMovementLines, shouldShowReceiptMovementFallback, type ReceiptPresentation } from '@/lib/receiptPresentation';
import { StatusNotice, TransactionHashLink } from '@/components/review/ReviewProgress';
import presentationStyles from './ActionReviewPresentation.module.css';
import { ValueOrSkeleton } from '@/components/MissingValue';
import TokenIcon from '@/components/TokenIcon';

export function CompactQuoteMetrics({ facts, gasStatus }: {
  facts: readonly ReviewFact[];
  gasStatus: 'current' | 'refreshing' | 'unavailable';
}) {
  const byLabel = new Map(facts.map((fact) => [fact.label, fact]));
  const primaryOutcome = facts.find((fact) =>
    fact.label === 'Receive'
    || fact.label === 'Minimum received'
    || fact.label.startsWith('Minimum fxSP'),
  );
  const candidates: Array<ReviewFact | undefined> = [
    primaryOutcome ?? byLabel.get('Estimated collateral'),
    byLabel.get('Gas tier'),
    byLabel.get('Gas fee') ?? { label: 'Network fee max', value: '—' },
  ];
  const metrics = candidates
    .filter((fact): fact is ReviewFact => fact !== undefined)
    .filter((fact, index, all) => all.findIndex((candidate) => candidate.label === fact.label) === index);
  if (!metrics.length) return null;
  return <div className={presentationStyles.quoteMetrics} aria-label="Current quote estimates">
    {metrics.map((fact) => <div className={presentationStyles.quoteMetric} key={fact.label}>
      <span className={presentationStyles.quoteMetricLabel}>{fact.label}</span>
      <span className={presentationStyles.quoteMetricValue} title={fact.title}>{fact.label === 'Gas tier' ? fact.value : fact.value !== '—' ? <ReviewFactValue fact={fact} /> : <ValueOrSkeleton value={fact.value} width="sm" status={gasStatus === 'refreshing' ? 'loading' : 'unavailable'} label={fact.label} />}{['Gas fee', 'Network fee max'].includes(fact.label) && <FeeUsd fact={fact} />}</span>
    </div>)}
  </div>;
}

function SummaryRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="grid min-w-0 grid-cols-[minmax(84px,.72fr)_minmax(0,1.28fr)] gap-x-3 py-1 text-[13px] leading-snug">
    <span className="text-mut">{reviewFactLabel(label)}</span><span className="min-w-0 break-words text-right font-semibold tabular-nums" title={title}><ReviewFactValue fact={{ label, value, title }} />{['Gas fee', 'Bridge fee', 'Total cost'].includes(label) && <FeeUsd fact={{ value, title }} />}</span>
  </div>;
}

export function UpdatedQuoteSummary({ changes }: { changes: readonly ChangedReviewFact[] }) {
  // Keep route changes visible without repeating the full review in a second
  // card. Amount, fee, and approval changes still receive explicit comparison.
  const visibleChanges = changes.filter((change) => change.label !== 'Transaction route');
  if (!visibleChanges.length) return changes.length
    ? <p className="mt-3 rounded-2xl bg-[var(--warn-dim)] px-4 py-3 text-[13px] text-warn" role="status">Route updated. Check the details before confirming.</p>
    : null;
  return (
    <section className="mt-3 rounded-2xl bg-[var(--warn-dim)] px-4 py-3" aria-label="Updated transaction consequences">
      <p className="text-[12px] font-semibold text-warn">Changed since your previous review</p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {visibleChanges.map((change) => <div key={change.label} className="grid grid-cols-[minmax(84px,.7fr)_minmax(0,1.3fr)] gap-x-3 text-[13px]">
          <span className="text-mut">{reviewFactLabel(change.label)}</span>
          <span className="min-w-0 text-right font-semibold tabular-nums [overflow-wrap:anywhere]">{change.before && <><ReviewFactValue fact={{ label: `${change.label} before`, value: change.before }} /> → </>}{change.after ? <ReviewFactValue fact={{ label: `${change.label} after`, value: change.after }} /> : 'No longer included'}{change.after && ['Gas fee', 'Bridge fee', 'Total cost'].includes(change.label) && <FeeUsd fact={{ value: change.after }} />}</span>
        </div>)}
      </div>
    </section>
  );
}

export function ActionConsequenceSummary({ facts }: { facts: readonly ReviewFact[] }) {
  if (!facts.length) return null;
  return (
    <section className="mt-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3" aria-label="Action consequences">
      <p className="text-[12px] font-semibold text-mut">What changes</p>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {facts.map((fact) => <SummaryRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
      </div>
    </section>
  );
}

export function PositionOutcomeSummary({ facts }: { facts: readonly PairedPositionFact[] }) {
  if (!facts.length) return null;
  const display = (value: string) => formatReviewFactValue({ label: 'Position value', value }).display;
  return (
    <section className={presentationStyles.positionOutcome} aria-label="Current and expected position values">
      <div className={presentationStyles.positionOutcomeHeading}><span>Current → estimated</span></div>
      <dl>{facts.map((fact) => <div key={fact.label}>
        <dt><MetricLabel label={fact.label === 'Debt' ? 'Total debt' : fact.label === 'Loan-to-value' ? 'LTV' : fact.label} definition={reviewHelpDefinition(fact.label)} /></dt>
        <dd><details className={presentationStyles.positionPair}>
          <summary aria-label={`Show full ${fact.label.toLowerCase()} before and after`}><span>{display(fact.before)}</span><span aria-hidden="true">→</span><strong>{display(fact.after)}</strong></summary>
          <p><span>Before: {fact.before}{fact.beforeTitle && fact.beforeTitle !== fact.before && <><br />Source detail: {fact.beforeTitle}</>}</span><span>Estimated after: {fact.after}{fact.afterTitle && fact.afterTitle !== fact.after && <><br />Estimate detail: {fact.afterTitle}</>}</span></p>
        </details></dd>
      </div>)}</dl>
    </section>
  );
}

export function ReceiptSummary({ receipts, variant = 'default' }: { receipts: readonly ReceiptPresentation[]; variant?: 'default' | 'outcome' | 'details' }) {
  if (!receipts.length) return null;
  const { movements, nativeValueIsMovement } = receiptMovementLines(receipts);
  const technicalMovements = receipts.flatMap((receipt) => receipt.technicalMovements);
  const showMovementFallback = shouldShowReceiptMovementFallback(receipts);
  if (variant === 'outcome') {
    if (movements.length === 0) return null;
    // Receipt facts, never the earlier quote, lead the completed action.
    const ordered = [...movements].sort((a, b) => Number(b.startsWith('received ')) - Number(a.startsWith('received ')));
    return <section className={presentationStyles.receiptOutcome} aria-label="Verified receipt">
      <dl>{ordered.map((movement, index) => {
        const fact = /^(sent|received) (.+) ([A-Za-z][A-Za-z0-9]*)$/.exec(movement);
        return fact ? <div key={index} data-direction={fact[1]}>
          <dt>{fact[1] === 'received' ? 'Received' : 'Sent'}</dt>
          <dd><TokenIcon symbol={fact[3]} size={24} /><ReviewFactValue fact={{ label: fact[1] === 'received' ? 'Received' : 'Sent', value: `${fact[2]} ${fact[3]}` }} /></dd>
        </div> : <div key={index}><dd className={presentationStyles.receiptCaveat}>{movement}</dd></div>;
      })}</dl>
    </section>;
  }
  return (
    <section className={variant === 'details' ? presentationStyles.receiptDetails : 'mt-4 w-full rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-left'} aria-label={variant === 'details' ? 'Receipt fees and technical details' : 'Verified receipt'}>
      {variant === 'details' && movements.length === 0 && showMovementFallback && <p className="text-[12px] text-mut">No wallet token transfers appear in this receipt. Position changes and native ETH received are not represented by ERC-20 transfer logs.</p>}
      {variant === 'default' && <><p className="text-[13px] font-semibold">Verified receipt</p>
      {movements.map((movement, index) => <p key={`movement-${index}`} className="mt-1.5 text-[13px] first-letter:uppercase">{movement}</p>)}
      {movements.length === 0 && showMovementFallback && <p className="mt-1.5 text-[12px] text-mut">Token movements could not be established from the verified receipt logs.</p>}</>}
      {technicalMovements.length > 0 && <section className="mt-2 text-[12px]" aria-label="Technical movements"><p className="text-mut">Technical movements</p>{technicalMovements.map((movement, index) => <p key={`technical-${index}`} className="mt-1 break-all font-mono text-[11px] text-mut">{movement}</p>)}</section>}
      {receipts.map((receipt, index) => <div key={`fees-${index}`} className="mt-1.5 text-[12px] text-mut">
        {receipt.executionFee && <p>{receipt.feeLabel}: {receipt.executionFee}<AmountUsd amount={receipt.exactFees?.execution ?? ''} symbol="ETH" receipt /></p>}
        {receipt.l1DataFee && <p>Base L1 data fee: {receipt.l1DataFee}<AmountUsd amount={receipt.exactFees?.l1Data ?? ''} symbol="ETH" receipt /></p>}
        {receipt.operatorFee && <p>Base operator fee: {receipt.operatorFee}<AmountUsd amount={receipt.exactFees?.operator ?? ''} symbol="ETH" receipt /></p>}
        {receipt.totalExecutionFee && receipt.totalFeeLabel && <p>{receipt.totalFeeLabel}: {receipt.totalExecutionFee}<AmountUsd amount={receipt.exactFees?.total ?? ''} symbol="ETH" receipt /></p>}
        {receipt.feeCaveat && <p>{receipt.feeCaveat}</p>}
      </div>)}
      {receipts.map((receipt, index) => receipt.nativeValue && !(nativeValueIsMovement && receipt.nativeValueLabel === 'Native value sent')
        && <p key={`native-${index}`} className="mt-1 text-[12px] text-mut">{receipt.nativeValueLabel}: {receipt.nativeValue}{receipt.exactNativeValue && <AmountUsd amount={receipt.exactNativeValue} symbol="ETH" receipt />}</p>)}
    </section>
  );
}

export function TransactionProgressPresentation({
  label,
  status,
  stepResults,
  chainId,
  presentation,
}: {
  label: string;
  status: import('@/lib/fx').PlanStatus;
  stepResults: readonly import('@/lib/fx').TransactionStepResult[];
  chainId: number;
  presentation: { label: string; body: string; className: string; icon: import('react').ReactNode };
}) {
  const submitted = stepResults.filter((step) => Boolean(step.hash));
  if (status !== 'submitted' && status !== 'included' && status !== 'confirming' && status !== 'confirmed' && status !== 'partial' && status !== 'failed' && status !== 'awaiting-user') return null;
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <StatusNotice {...presentation} />
      {submitted.map((step) => <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={chainId} />)}
    </section>
  );
}
