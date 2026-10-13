'use client';

import { useId } from 'react';

/**
 * FxAeon logo mark — two opposing ribbons join into an abstract x / bridge.
 * The blue ribbon silhouette is distinct from the f(x) protocol mark
 * and remains recognizable at favicon size.
 */

export function FxLogo({ size = 56, className = '' }: { size?: number; className?: string }) {
  // Multiple marks can coexist during transitions; unique SVG IDs prevent
  // one instance's gradient from being resolved against another instance.
  const id = `fxlogo-grad-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="FxAeon"
    >
      <defs>
        <linearGradient id={id} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="0.48" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <path
        d="M8 26.5C8 15.7 16.6 7 27.3 7H48c3.6 0 5.6 4.1 3.4 7L40.7 28.2A16 16 0 0 1 27.9 34H15.5A7.5 7.5 0 0 1 8 26.5Z"
        fill={`url(#${id})`}
      />
      <path
        d="M56 37.5C56 48.3 47.4 57 36.7 57H16c-3.6 0-5.6-4.1-3.4-7l10.7-14.2A16 16 0 0 1 36.1 30h12.4a7.5 7.5 0 0 1 7.5 7.5Z"
        fill={`url(#${id})`}
        stroke="var(--bg)"
        strokeWidth="2.5"
      />
      <path d="M24 32h16" stroke="#fff" strokeOpacity="0.92" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default FxLogo;
