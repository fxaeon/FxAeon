import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { USD_PRICE_MAX_AGE_MS, priceKeyForSymbol, usdValueForDecimal, type UsdPriceSnapshot } from '@/lib/prices';

/** Display only. Never infer a peg, swap units, or use a display price to sign. */
export function tokenAmountParts(fact: Pick<ReviewFact, 'value' | 'title'>) {
  const parse = (value?: string) => value && /^(?:≈\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9]*)(?:$|;\s|\s\()/.exec(value);
  const titleParts = parse(fact.title);
  const exact = titleParts || parse(fact.value);
  const source = titleParts ? fact.title! : fact.value;
  return exact ? { amount: exact[1], symbol: exact[2], approximate: fact.value.startsWith('≈'), exact: !source.startsWith('≈') } : null;
}

export function amountUsdValue(amount: string, symbol: string, quote: UsdPriceSnapshot, now = Date.now()) {
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(amount)) return null;
  const key = priceKeyForSymbol(symbol);
  const timestamp = key ? quote.updatedAts?.[key] ?? quote.updatedAt : null;
  if (!key || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 30_000 || now - timestamp > USD_PRICE_MAX_AGE_MS) return null;
  return usdValueForDecimal(amount.replace(/,/g, ''), quote.prices[key]);
}

const inputLabels = ['Amount', 'Input amount', 'Deposit', 'Repay', 'fxSAVE'];
export function transactionAmountFacts(facts: readonly ReviewFact[]): ReviewFact[] {
  const unique = facts.filter((fact, index) => facts.findIndex(other => other.label === fact.label) === index);
  const amount = (label: string) => unique.find(fact => fact.label === label && tokenAmountParts(fact) && /[1-9]/.test(tokenAmountParts(fact)!.amount));
  const first = (labels: string[]) => labels.map(amount).find((fact): fact is ReviewFact => Boolean(fact));
  const input = first(inputLabels);
  // Claim legs are separate payouts, never one token converted into the other.
  const claims = ['Estimated fxUSD payout', 'Estimated USDC payout', 'Minimum received (fxUSD leg)', 'Minimum received (USDC leg)'].map(label => unique.find(fact => fact.label === label && tokenAmountParts(fact))).filter((fact): fact is ReviewFact => Boolean(fact));
  if (!input && claims.length) return claims;
  // Quotes, minima and debt are not interchangeable exchange endpoints.
  // Prefer the net payout; retain gross debt/minimums in the compact fact rows.
  const output = first(['Estimated received', 'Estimated fxSAVE received', 'Estimated fxUSD received', 'Withdraw', 'Receive', 'Minimum received', 'Minimum fxSP']);
  if (output) return [...(input ? [input] : []), output];
  const tradePosition = input && ['Amount', 'Input amount'].includes(input.label) ? amount('Estimated collateral') : undefined;
  if (tradePosition) return [input!, tradePosition];
  // Borrow's gross debt is a consequence, not a second receive amount.
  const debt = amount('Debt added');
  return input ? [input] : debt ? [debt] : [];
}

export function plainAmountLabel(label: string): string {
  const labels: Record<string, string> = {
    Amount: 'You pay', 'Input amount': 'You pay', Deposit: 'You deposit', Repay: 'You repay', fxSAVE: 'You withdraw',
    'Debt added': 'Debt added', Withdraw: 'Collateral returned', 'Estimated collateral': 'Position size · estimated',
    'Estimated received': 'You receive · estimated', 'Estimated fxSAVE received': 'You receive · estimated',
    'Estimated fxUSD received': 'You receive · estimated', 'Estimated fxUSD payout': 'fxUSD payout · estimated', 'Estimated USDC payout': 'USDC payout · estimated', 'Minimum received': 'You receive · minimum',
    'Minimum received (fxUSD leg)': 'fxUSD · minimum', 'Minimum received (USDC leg)': 'USDC · minimum',
  };
  return labels[label] ?? label;
}


export function nativeCostAmount(fact: Pick<ReviewFact, 'value' | 'title'>): string | null {
  // The exact cap in the title is authoritative; never parse a lower-than bound.
  const match = /^(?:≈\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+ETH(?:$|\s)/.exec(fact.title ?? fact.value);
  return match?.[1] ?? null;
}

export function plainTransactionCopy(intent: { kind: string; mintAmount?: bigint; depositAmount?: bigint; minimumRepayAmount?: bigint; withdrawAmount?: bigint; instant?: boolean; directBasePool?: boolean } | undefined, fallback: string, bridgeToken?: string) {
  if (bridgeToken) return { title: `Bridge ${bridgeToken}`, review: 'Review bridge', confirm: `Send ${bridgeToken}` };
  if (intent?.kind === 'deposit-and-mint') return intent.mintAmount && intent.mintAmount > 0n
    ? { title: 'Borrow fxUSD', review: 'Review borrowing', confirm: 'Confirm borrowing' }
    : { title: 'Add collateral', review: 'Review collateral', confirm: 'Add collateral' };
  if (intent?.kind === 'repay-and-withdraw') {
    const repay = Boolean(intent.minimumRepayAmount && intent.minimumRepayAmount > 0n);
    const withdraw = Boolean(intent.withdrawAmount && intent.withdrawAmount > 0n);
    return repay && withdraw ? { title: 'Repay and withdraw', review: 'Review repayment', confirm: 'Confirm changes' }
      : repay ? { title: 'Repay fxUSD', review: 'Review repayment', confirm: 'Repay fxUSD' }
      : { title: 'Withdraw collateral', review: 'Review withdrawal', confirm: 'Withdraw collateral' };
  }
  if (intent?.kind === 'position-adjust') return { title: 'Change leverage', review: 'Review leverage change', confirm: 'Change leverage' };
  if (intent?.kind === 'fxsave-deposit') return { title: 'Deposit to savings', review: 'Review deposit', confirm: 'Deposit' };
  if (intent?.kind === 'fxsave-withdraw') return !intent.instant && !intent.directBasePool
    ? { title: 'Request withdrawal', review: 'Review withdrawal', confirm: 'Request withdrawal' }
    : { title: 'Withdraw savings', review: 'Review withdrawal', confirm: 'Withdraw' };
  if (intent?.kind === 'fxsave-claim') return { title: 'Claim withdrawal', review: 'Review claim', confirm: 'Claim' };
  return { title: fallback, review: fallback, confirm: 'Confirm' };
}

/** Keep approval requests distinct; normalize only action-wallet presentation. */
export function plainWalletStatus<T extends { label: string; body: string }>(status: T, awaitingUser: boolean, networkSwitching: boolean, nextKind: string | undefined, actionTitle: string): T {
  return awaitingUser && !networkSwitching && nextKind === 'action'
    ? { ...status, label: 'Confirm in wallet', body: `${actionTitle}. Review the transaction in your wallet.` }
    : status;
}
