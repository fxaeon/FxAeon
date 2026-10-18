'use client';

import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { ChainIcon } from '@/components/TokenIcon';
import styles from './PositionsPageHeader.module.css';

/** Positions remain a child of their product, including on a direct visit. */
export function PositionsPageHeader({ product, onReturn }: { product: 'Trade' | 'Borrow'; onReturn?: () => void }) {
  const href = product === 'Trade' ? '/trade' : '/borrow';
  const back = <><ArrowLeft size={17} aria-hidden="true" />{product}</>;
  const create = <><Plus size={16} aria-hidden="true" />New position</>;
  return <header className={styles.header} data-positions-header>
    <nav aria-label={`${product} navigation`}>
      {onReturn
        ? <button type="button" className={styles.back} onClick={onReturn} aria-label={`Back to ${product}`}>{back}</button>
        : <Link href={href} className={styles.back} aria-label={`Back to ${product}`}>{back}</Link>}
    </nav>
    <div className={styles.row}>
      <h1 tabIndex={-1} data-borrow-positions-heading={product === 'Borrow' ? '' : undefined}>Positions</h1>
      {onReturn
        ? <button type="button" className={styles.create} onClick={onReturn}>{create}</button>
        : <Link href={href} className={styles.create}>{create}</Link>}
    </div>
    <span className={styles.network}><ChainIcon chainId={1} size={14} />Ethereum</span>
  </header>;
}
