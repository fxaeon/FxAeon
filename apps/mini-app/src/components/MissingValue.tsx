import type { ReactNode } from 'react';

export type MissingValueWidth = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type MissingValueStatus = 'loading' | 'unavailable';

export type MissingValueProps = {
  width?: MissingValueWidth;
  status?: MissingValueStatus;
  loading?: boolean;
  announce?: boolean;
  label?: string;
  className?: string;
};

/**
 * A stable inline placeholder for values that have not been verified yet.
 * Pending reads shimmer; unavailable values reserve space without a visible marker.
 */
export function MissingValue({
  width = 'md',
  status,
  loading,
  announce = true,
  label,
  className = '',
}: MissingValueProps) {
  const unavailable = status ? status === 'unavailable' : loading === false;
  const accessibleLabel = label ?? (unavailable ? 'Value unavailable' : 'Loading value');
  return (
    <span
      role="status"
      aria-live={announce ? undefined : 'off'}
      aria-label={accessibleLabel}
      className={`missing-value missing-value-${width}${unavailable ? ' missing-value-unavailable' : ''} ${className}`.trim()}
    >
      {!unavailable && <span className="missing-value-bar" aria-hidden="true" />}
    </span>
  );
}

export type ValueOrSkeletonProps = MissingValueProps & {
  value?: ReactNode;
  children?: ReactNode;
};

/** Replace only exact display sentinels; formatted values and composed nodes pass through. */
export function ValueOrSkeleton({ value, children, ...placeholderProps }: ValueOrSkeletonProps) {
  const content = value ?? children;
  const unavailable = typeof content === 'string' && /^(?:Unavailable|Not quoted)$/i.test(content.trim());
  const isMissing = unavailable || (typeof content === 'string' && (content === '—' || content === '-'));
  return isMissing
    ? <MissingValue {...placeholderProps} status={unavailable ? 'unavailable' : placeholderProps.status} label={placeholderProps.label ?? (unavailable ? 'Value unavailable' : undefined)} />
    : <>{content}</>;
}
