import { formatUnits } from 'viem';
import { FX_TOKENS } from '@/lib/fx/tokens';
import { acceptedFxSaveQuote } from '@/lib/fx/fxSaveReviewQuote';
import type { PlannedRoute } from '@/lib/fx/types';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { formatReviewFactValue } from './reviewFactFormatting';
import styles from './ActionReviewPresentation.module.css';

/** Separate the direct return from the signed swap floor; neither is a total minimum. */
export function InstantWithdrawalDetails({ route, facts }: { route: PlannedRoute; facts: readonly ReviewFact[] }) {
  const intent = route.policy?.reviewedAction;
  if (intent?.kind !== 'fxsave-withdraw' || !intent.instant || intent.directBasePool) return null;
  const output = intent.tokenOutAddress.toLowerCase();
  const symbol = output === FX_TOKENS.fxUSD.address.toLowerCase() ? 'fxUSD'
    : output === FX_TOKENS.USDC.address.toLowerCase() ? 'USDC' : null;
  if (!symbol) return null;
  const other = symbol === 'fxUSD' ? 'USDC' : 'fxUSD';
  const direct = facts.find(fact => fact.label === `Minimum received (${symbol} leg)`);
  const swap = facts.find(fact => fact.label === `Minimum received (${other} leg)`);
  if (!direct && !swap) return null;
  const quote = acceptedFxSaveQuote(route);
  const directAmount = quote?.kind === 'instant-withdraw'
    ? symbol === 'fxUSD' ? quote.netFxUSD : quote.netUSDC : undefined;
  const estimate = directAmount === undefined ? undefined : formatReviewFactValue({ label: 'Direct return', value: `≈ ${formatUnits(BigInt(directAmount), symbol === 'fxUSD' ? 18 : 6)} ${symbol}` }).display;
  return <details className={styles.withdrawalDetails}>
    <summary>Withdrawal details</summary>
    {estimate && <div className={styles.detailFact}><span>Direct {symbol} · est.</span><span>{estimate}</span></div>}
    {swap && <div className={styles.detailFact} data-review-fact={swap.label}><span>Swap minimum · {other} → {symbol}</span><span>{swap.value}</span></div>}
    {direct && <div className={styles.detailFact} data-review-fact={direct.label}><span>Direct leg minimum</span><span>{direct.value}</span></div>}
    <p>The direct leg is returned without a swap. Its separate conversion minimum can be zero; these are not a minimum for the total received.</p>
  </details>;
}
