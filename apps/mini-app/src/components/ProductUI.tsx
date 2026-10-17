'use client';

import { useId, type ReactNode, type HTMLAttributes } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink, Info, type LucideIcon } from 'lucide-react';
import { haptic, openExternalLink } from '@/lib/telegram';
import styles from './ProductUI.module.css';
import { ValueOrSkeleton } from './MissingValue';

/** Shared presentation only. Quotes, balances, eligibility and signing remain
 * owned by the product routes and their existing providers. */
export function ProductSurface({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`${styles.surface} ${className}`}>{children}</div>;
}

export function PageHeading({ title, backHref, action, visible = false }: { title: string; backHref?: string; action?: ReactNode; visible?: boolean }) {
  if (!backHref && !action) return <h1 className={visible ? styles.visibleTitle : 'sr-only'} data-page-heading>{title}</h1>;
  return <header className={styles.heading} data-page-heading>
    <div>{backHref && <Link href={backHref} aria-label="Go back" className={styles.iconButton}><ArrowLeft aria-hidden="true" size={20} /></Link>}<h1 className={visible ? styles.visibleTitle : 'sr-only'}>{title}</h1></div>
    {action}
  </header>;
}

export type MetricRow = { label: string; value: ReactNode; detail?: ReactNode; emphasis?: boolean };
export function MetricRows({ rows, label }: { rows: readonly MetricRow[]; label?: string }) {
  return <dl className={styles.metrics} aria-label={label}>
    {rows.map((row) => <div key={row.label} className={row.emphasis ? styles.emphasizedMetric : undefined}>
      <dt>{row.label}</dt><dd><ValueOrSkeleton value={row.value} status="unavailable" label={row.label} />{row.detail && <small>{row.detail}</small>}</dd>
    </div>)}
  </dl>;
}

export function StatusNotice({ title, children, action, tone = 'neutral', urgent = false }: {
  title?: string; children?: ReactNode; action?: ReactNode;
  tone?: 'neutral' | 'warning' | 'success' | 'danger'; urgent?: boolean;
}) {
  return <div className={styles.notice} data-tone={tone} role={urgent ? 'alert' : 'status'}>
    <Info size={18} aria-hidden="true" />
    <div>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
    {action && <span className={styles.noticeAction}>{action}</span>}
  </div>;
}

export function Disclosure({ title, summary, children, defaultOpen = false }: {
  title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  return <details className={styles.disclosure} open={defaultOpen || undefined}>
    <summary><span>{title}</span>{summary && <span className={styles.disclosureHint}>{summary}</span>}<ChevronDown size={17} aria-hidden="true" /></summary>
    <div className={styles.disclosureBody}>{children}</div>
  </details>;
}

export function ChoiceCards<T extends string>({ value, onChange, label, options }: {
  value: T; onChange: (value: T) => void; label: string;
  options: readonly { value: T; label: string; description?: ReactNode; disabled?: boolean }[];
}) {
  const id = useId();
  return <fieldset className={styles.choices}>
    <legend>{label}</legend>
    {options.map((option) => <label key={option.value} className={styles.choice} data-selected={option.value === value} data-disabled={option.disabled || undefined}>
      <input type="radio" name={id} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => { haptic('selection'); onChange(option.value); }} />
      <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      <span className={styles.radioMark} aria-hidden="true">{value === option.value && <Check size={13} />}</span>
    </label>)}
  </fieldset>;
}

export function RowGroup({ title, children, id }: { title?: string; children: ReactNode; id?: string }) {
  const generatedId = useId();
  const headingId = id ?? generatedId;
  return <section className={styles.group} aria-labelledby={title ? headingId : undefined}>
    {title && <h2 id={headingId}>{title}</h2>}
    <div className={styles.rowGroup}>{children}</div>
  </section>;
}

type ActionRowBase = { icon?: LucideIcon; title: string; description?: ReactNode; value?: ReactNode };
type ActionRowLink = ActionRowBase & { href: string; external?: boolean; onClick?: () => void; disabled?: never };
type ActionRowButton = ActionRowBase & { href?: never; external?: never; onClick: () => void; disabled?: boolean };
export function ActionRow(props: ActionRowLink | ActionRowButton) {
  const { icon: Icon, title, description, value } = props;
  const href = 'href' in props ? props.href : undefined;
  const external = 'external' in props ? props.external ?? false : false;
  const onClick = props.onClick;
  const disabled = 'disabled' in props ? props.disabled ?? false : false;
  // An external row says so in its name, after its title and description.
  const content = <>{Icon && <Icon className={styles.rowIcon} size={20} aria-hidden="true" />}<span className={styles.rowCopy}><strong>{title}</strong>{description && <small>{description}</small>}{external && <span className="sr-only"> (opens in a new tab)</span>}</span>{value && <span className={styles.rowValue}>{value}</span>}{external ? <ExternalLink size={17} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}</>;
  if (href && external) return <a className={styles.actionRow} href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    haptic('light'); onClick?.();
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(href)) event.preventDefault();
  }}>{content}</a>;
  if (href) return <Link className={styles.actionRow} href={href} onClick={() => { haptic('light'); onClick?.(); }}>{content}</Link>;
  return <button className={styles.actionRow} type="button" disabled={disabled} onClick={() => { haptic('light'); onClick?.(); }}>{content}</button>;
}
