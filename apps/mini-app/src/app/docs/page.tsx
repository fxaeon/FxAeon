import Link from 'next/link';
import { ArrowLeftRight, BookOpen, CandlestickChart, Landmark, Sprout, Wallet } from 'lucide-react';
import DocsShell from './DocsShell';
import { productSections } from './ProductArticle';
import { sdkSections } from './sdk/SdkArticle';
import { createDocsEntries } from './docsSearch';
import styles from './Docs.module.css';

const topics = [
  { id: 'getting-started', title: 'Get started with FxAeon', description: 'Open the app, choose your wallet, and make your first move.', icon: BookOpen },
  { id: 'trade', title: 'Trade ETH and BTC', description: 'Choose a direction, set leverage, and manage your positions.', icon: CandlestickChart },
  { id: 'earn', title: 'Earn with fxSAVE', description: 'Deposit into the savings vault and understand withdrawals.', icon: Sprout },
  { id: 'borrow', title: 'Borrow against your assets', description: 'Use collateral to borrow fxUSD and manage your debt.', icon: Landmark },
  { id: 'move', title: 'Move between chains', description: 'Bridge fxUSD and fxSAVE between Ethereum and Base.', icon: ArrowLeftRight },
  { id: 'access', title: 'Your wallet and sign-in', description: 'Sign in with Telegram or connect a wallet you already use.', icon: Wallet },
];

export default function DocsPage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide'),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="Product guide" entries={entries} home>
    <div className={styles.welcomeGrid}>
      {topics.map(({ id, title, description, icon: Icon }) => <Link key={id} href={`/docs/guide#${id}`} className={styles.welcomeCard}>
        <Icon size={24} strokeWidth={1.6} aria-hidden="true" />
        <h2>{title}</h2>
        <p>{description}</p>
      </Link>)}
    </div>
  </DocsShell>;
}
