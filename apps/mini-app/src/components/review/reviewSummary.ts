import type { ReviewFact } from '@/lib/fx/reviewFormatting';

const ALWAYS_VISIBLE = new Set([
  'Amount', 'Deposit', 'Borrow', 'Debt added', 'Repay', 'Withdraw', 'fxSAVE', 'Receive', 'Asset',
  'Estimated fxSAVE received', 'Estimated received', 'Estimated fxUSD received', 'f(x) fee rate', 'Availability',
  'Action', 'Position', 'Mode', 'Slippage', 'Minimum received', 'Quoted minimum received',
  'Minimum fxSP', 'Final fxSAVE minimum', 'Minimum converted input', 'Minimum converted deposit',
  'Minimum debt repaid', 'Minimum received (fxUSD leg)', 'Minimum received (USDC leg)',
  'Gas tier', 'Gas fee', 'f(x) fee', 'Total cost', 'Bridge fee', 'Loan-to-value',
]);

/** Separate concise decision facts from exact quote and route metadata. */
export function splitReviewFacts(facts: readonly ReviewFact[]): {
  summary: ReviewFact[];
  details: ReviewFact[];
} {
  const hasTargetLeverage = facts.some((fact) => fact.label === 'Target leverage');
  const isBridge = facts.some((fact) => fact.label === 'Destination network');
  const summary: ReviewFact[] = [];
  const details: ReviewFact[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    if (fact.label === 'Leverage' && hasTargetLeverage) {
      details.push({ ...fact, label: 'Quoted leverage' });
      continue;
    }
    const identity = `${fact.label}:${fact.value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    (ALWAYS_VISIBLE.has(fact.label) || fact.label === 'Target leverage'
      || (isBridge && ['Source network', 'Destination network', 'Recipient', 'Delivery estimate'].includes(fact.label)) ? summary : details).push(fact);
  }
  return { summary, details };
}
