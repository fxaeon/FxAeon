import styles from './DocsIcon.module.css';

const names = ['ArrowLeft', 'ArrowLeftRight', 'ArrowRight', 'ArrowUpRight', 'BookOpen', 'CandlestickChart', 'Check', 'ChevronDown', 'CircleHelp', 'Code2', 'Copy', 'EllipsisVertical', 'Globe', 'History', 'Landmark', 'List', 'Menu', 'MessageCircle', 'Rocket', 'Search', 'Settings2', 'ShieldCheck', 'Sprout', 'Wallet'] as const;
export type DocsIconName = typeof names[number];

/** Only decorative marks: the surrounding control or link supplies its name. */
export default function DocsIcon({ name, size = 16, className = '' }: { name: DocsIconName; size?: number; className?: string }) {
  return <i aria-hidden="true" className={[styles[`i${names.indexOf(name)}`], size !== 16 ? styles[`s${size}`] : '', className].filter(Boolean).join(' ')} />;
}
