import styles from './ProtocolPositionCard.module.css';

function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />;
}

/** A position row in outline, using the same layout as the row it stands in for. */
export function ProtocolPositionSkeleton() {
  return (
    <div role="status" aria-label="Loading positions" className={styles.row}>
      <span className={styles.content} aria-hidden="true">
        <span className={styles.identity}>
          <Skeleton className={styles.skeletonToken} />
          <span className={styles.identityText}>
            <span className={styles.identityLine}><Skeleton className={styles.skeletonMarket} /><Skeleton className={styles.skeletonValue} /></span>
            <span className={styles.identityLine}><Skeleton className={styles.skeletonMeta} /><Skeleton className={styles.skeletonBasis} /></span>
          </span>
        </span>
        <Skeleton className={styles.skeletonSplit} />
        <span className={styles.brake}><Skeleton className={styles.brakeSkeleton} /></span>
        <span className={styles.cardMetrics}>{[0, 1].map(index => <span key={index}><span className={styles.cardMetricLabel}><Skeleton className={styles.skeletonMetricLabel} /></span><span className={styles.cardMetricValue}><Skeleton className={styles.skeletonMetricValue} /></span></span>)}</span>
      </span>
    </div>
  );
}
