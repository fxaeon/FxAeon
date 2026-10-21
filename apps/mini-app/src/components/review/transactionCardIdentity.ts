import type { PlannedRoute } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { positionPoolAddress } from '@/lib/fx/policy';
import { tokenAmountParts, transactionAmountFacts } from './transactionAmountPresentation';

/** Presentation names only. All amounts and capabilities still come from the accepted route. */
export function transactionCardIdentity(route: PlannedRoute, facts: readonly ReviewFact[], fallback: string) {
  const intent = route.policy?.reviewedAction;
  const find = (label: string) => facts.find(fact => fact.label === label);
  const first = transactionAmountFacts(facts)[0];
  const network = route.chainId === 1 ? 'Ethereum' : route.chainId === 8453 ? 'Base' : `Chain ${route.chainId}`;
  const positionId = intent && 'positionId' in intent ? intent.positionId : undefined;
  const pool = intent && 'poolAddress' in intent ? intent.poolAddress : undefined;
  const position = pool ? (['ETH', 'BTC'] as const).flatMap(market => (['long', 'short'] as const).map(side => ({ market, side })))
    .find(item => positionPoolAddress(item.market, item.side).toLowerCase() === pool.toLowerCase()) : undefined;
  const positionName = position ? `${position.market} ${position.side === 'long' ? 'Long' : 'Short'}` : fallback.replace(/^(?:Review|Open|Increase|Reduce|Close)\s+/i, '');
  const loanSubtitle = positionId ? `Loan #${positionId} · ${network}` : network;
  const defaults = { name: fallback, subtitle: network, symbol: first && tokenAmountParts(first)?.symbol, amount: first, amountLabel: undefined as string | undefined, value: undefined as string | undefined, review: 'Review transaction', confirm: undefined as string | undefined };
  if (route.operation === 'buildBridgeTx') {
    const asset = find('Asset')?.value ?? (first && tokenAmountParts(first)?.symbol) ?? 'asset';
    const destination = find('Destination network')?.value;
    return { ...defaults, name: `Bridge ${asset}`, symbol: asset, subtitle: destination ? `${network} → ${destination}` : network, amountLabel: 'You send', review: 'Review bridge', confirm: `Bridge ${asset}` };
  }
  if (!intent) return defaults;
  switch (intent.kind) {
    case 'position-increase': {
      const leverage = find('Target leverage')?.value;
      const opening = intent.positionId === 0;
      return { ...defaults, name: opening ? `${leverage ? `${leverage} ` : ''}${positionName}` : `Add to ${positionName}`, symbol: position?.market ?? defaults.symbol, subtitle: opening ? network : `Position #${intent.positionId}`, amountLabel: opening ? 'You pay' : 'You add', review: 'Review position', confirm: opening ? `Open ${positionName}` : 'Add to position' };
    }
    case 'position-reduce': return { ...defaults, name: `${intent.isClosePosition ? 'Close' : 'Reduce'} ${positionName}`, symbol: position?.market ?? defaults.symbol, subtitle: `Position #${intent.positionId}`, amountLabel: undefined, review: 'Review position', confirm: intent.isClosePosition ? 'Close position' : 'Reduce position' };
    case 'position-adjust': return { ...defaults, name: `Adjust ${positionName}`, symbol: position?.market, subtitle: `Position #${intent.positionId}`, amount: undefined, amountLabel: 'New leverage', value: find('Target leverage')?.value ?? 'Unavailable', review: 'Review leverage', confirm: 'Adjust leverage' };
    case 'deposit-and-mint': {
      const borrow = intent.mintAmount > 0n;
      const deposit = intent.depositAmount > 0n;
      const combined = borrow && deposit && intent.positionId > 0;
      return { ...defaults, name: combined ? 'Adjust fxUSD loan' : borrow ? (intent.positionId ? 'Borrow more fxUSD' : 'Borrow fxUSD') : 'Add collateral', subtitle: loanSubtitle, symbol: combined || !deposit ? 'fxUSD' : defaults.symbol, amount: combined ? find('Estimated fxUSD received') ?? find('Debt added') : first, amountLabel: combined ? (find('Estimated fxUSD received') ? 'You receive · est.' : 'Debt added') : deposit ? 'You lock' : (first?.label === 'Debt added' ? 'Debt added' : 'You receive · est.'), review: borrow ? 'Review borrow' : 'Review collateral', confirm: combined ? 'Adjust loan' : borrow ? 'Borrow fxUSD' : 'Add collateral' };
    }
    case 'repay-and-withdraw': {
      const repay = intent.minimumRepayAmount > 0n;
      const withdraw = intent.withdrawAmount > 0n;
      return { ...defaults, name: repay && withdraw ? 'Repay and withdraw' : repay ? 'Repay fxUSD debt' : 'Withdraw collateral', subtitle: loanSubtitle, amountLabel: repay ? 'You repay' : 'You withdraw', review: repay ? 'Review repayment' : 'Review withdrawal', confirm: repay && withdraw ? 'Confirm changes' : repay ? 'Repay fxUSD' : 'Withdraw collateral' };
    }
    case 'fxsave-deposit': return { ...defaults, name: 'Deposit into fxSAVE', symbol: 'fxSAVE', review: 'Review deposit', confirm: `Deposit ${defaults.symbol ?? 'asset'}` };
    case 'fxsave-withdraw': {
      const queued = !intent.directBasePool && !intent.instant;
      return { ...defaults, name: queued ? 'Queue fxSAVE withdrawal' : 'Withdraw fxSAVE', symbol: 'fxSAVE', subtitle: `${network} · ${intent.directBasePool ? 'Direct' : queued ? 'Queued' : 'Instant'}`, amountLabel: queued ? 'You queue' : 'You redeem', review: queued ? 'Review queued withdrawal' : 'Review withdrawal', confirm: intent.directBasePool ? 'Redeem to fxSP' : queued ? 'Queue withdrawal' : 'Withdraw instantly' };
    }
    case 'fxsave-claim': return { ...defaults, name: 'Claim withdrawal', symbol: 'fxSAVE', amount: undefined, amountLabel: 'Claimable assets', value: 'fxUSD / USDC', review: 'Review claim', confirm: 'Claim withdrawal' };
  }
  return defaults;
}
