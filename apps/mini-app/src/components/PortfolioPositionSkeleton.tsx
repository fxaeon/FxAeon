import styles from './PortfolioPositionRows.module.css';

/** The collapsed Portfolio row, without importing wallet or position providers. */
export function PortfolioPositionSkeleton() {
  return <div role="status" aria-label="Loading positions" data-portfolio-position-skeleton>
    <div className={styles.skeletonRow} aria-hidden="true">
      <span className={`${styles.skeletonIcon} skeleton`} />
      <span className={styles.identity}>
        <strong className={styles.skeletonName}><span className="skeleton" /></strong>
        <small className={styles.skeletonMeta}><span className="skeleton" /></small>
      </span>
      <span className={styles.value}>
        <strong className={styles.skeletonAmount}><span className="skeleton" /></strong>
        <small className={styles.skeletonBasis}><span className="skeleton" /></small>
      </span>
      <span className={`${styles.skeletonChevron} skeleton`} />
    </div>
  </div>;
}
