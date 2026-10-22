import type { ReactNode } from 'react';

export function SectionTitle({ children, right, level = 2 }: { children: ReactNode; right?: ReactNode; level?: 2 | 3 }) {
  // Nested surfaces (for example the wallet dialog) keep a single level-2 heading.
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div className="section-heading mb-2 flex items-center justify-between">
      <Heading className="text-[length:var(--fs-title)] font-semibold tracking-tight text-[var(--text)]">
        {children}
      </Heading>
      {right}
    </div>
  );
}
