'use client';

import { ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { useProtocolPositions } from './ProtocolPositionProvider';
import { confirmedPositionHintKey } from '@/lib/confirmedPositionStorage';
import { openExternalLink } from '@/lib/telegram';
import TokenIcon from '@/components/TokenIcon';
import styles from './ProtocolPositionCard.module.css';

export function ConfirmedPositionCards({ market }: { market?: 'ETH' | 'BTC' }) {
  const { pendingPositions, checkingConfirmedPositions, refreshConfirmedPositions } = useProtocolPositions();
  const hints = pendingPositions.filter((hint) => !market || hint.market === market);
  if (!hints.length) return null;
  // Receipt confirmation is shown separately until canonical position data arrives.
  return <div className={styles.confirmedList} aria-live="polite">
    {hints.map((hint) => <div key={confirmedPositionHintKey(hint)} data-confirmed-position-key={confirmedPositionHintKey(hint)} data-confirmed-position-status={checkingConfirmedPositions ? 'checking' : 'pending'} aria-busy={checkingConfirmedPositions} className={styles.confirmedRow}>
      <div className={styles.confirmedIdentity}>
        <TokenIcon symbol={hint.market === 'ETH' ? 'ETH' : 'WBTC'} size={34} />
        <div><p>{hint.market} {hint.side === 'long' ? 'Long' : 'Short'}</p><small>Position #{hint.positionId}</small></div>
        <span className={styles.confirmedBadge}>Confirmed</span>
      </div>
      <div role="status" className={styles.confirmedStatus}>
        {checkingConfirmedPositions && <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-mint" aria-hidden="true" />}
        <p>{checkingConfirmedPositions ? 'Checking confirmed position details…' : 'Transaction confirmed. Waiting for position details to sync.'}</p>
      </div>
      <div className={styles.confirmedActions}>
        <a href={`https://etherscan.io/tx/${hint.transactionHash}`} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(`https://etherscan.io/tx/${hint.transactionHash}`)) event.preventDefault(); }} aria-label="View position transaction" className="glass-press inline-flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-mint">View transaction<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
        <button type="button" aria-label="Retry position details" disabled={checkingConfirmedPositions} onClick={() => void refreshConfirmedPositions()} className="glass-press inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-mut disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${checkingConfirmedPositions ? 'animate-spin' : ''}`} aria-hidden="true" />{checkingConfirmedPositions ? 'Checking' : 'Retry details'}</button>
      </div>
    </div>)}
  </div>;
}
