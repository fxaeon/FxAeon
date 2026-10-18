import Link from 'next/link';
import DocsShell from './DocsShell';
import { productSections } from './ProductArticle';
import { sdkSections } from './sdk/SdkArticle';
import { createDocsEntries, docsNavigation } from './docsSearch';
import styles from './Docs.module.css';
import { productHref } from './productNavigation';
import { ExternalLink } from './ExternalLink';
import { ArrowLeftRight, ArrowRight, CandlestickChart, Landmark, Sprout } from 'lucide-react';

export default function DocsPage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide').map(entry => ({ ...entry, href: productHref(entry.id) })),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="Product guide" entries={docsNavigation(entries, 'Product guide')} home>
    <div className={styles.articleBody}>
      <h2 id="what-is-fxaeon">What is FxAeon?</h2>
      <p>FxAeon is an independent interface for f(x) Protocol. Use it in your browser or inside Telegram to trade ETH and BTC, save with fxSAVE, borrow fxUSD, and move supported assets between chains.</p>
      <p>In Telegram, sign in with your Telegram account through Privy. On the web, connect an existing wallet. Your selected wallet confirms each transaction.</p>
      <h2 id="choose-a-product">What would you like to do?</h2>
      <div className={styles.productGuides}>
        {[
          { id: 'trade', title: 'Trade', Icon: CandlestickChart, text: 'Open and manage leveraged ETH or BTC positions.', network: 'Ethereum' },
          { id: 'earn', title: 'Earn', Icon: Sprout, text: 'Deposit into fxSAVE and manage withdrawals.', network: 'Ethereum' },
          { id: 'borrow', title: 'Borrow', Icon: Landmark, text: 'Borrow fxUSD against supported collateral.', network: 'Ethereum' },
          { id: 'move', title: 'Move', Icon: ArrowLeftRight, text: 'Bridge fxUSD or fxSAVE to your destination wallet.', network: 'Ethereum ↔ Base' },
        ].map(({ id, title, Icon, text, network }) => <Link key={id} href={productHref(id)}>
          <span className={styles.guideTitle}><Icon size={20} aria-hidden="true" /><strong>{title}</strong><ArrowRight size={16} aria-hidden="true" /></span>
          <span>{text}</span><small>{network}</small>
        </Link>)}
      </div>
      <h2 id="start-reading">Start here</h2>
      <ul>
        <li><Link href={productHref('getting-started')}>Your first transaction</Link> — Open the app, add funds, and review your first action.</li>
        <li><Link href={productHref('access')}>Your wallet and sign-in</Link> — Use Telegram or connect an existing wallet.</li>
        <li><Link href={productHref('fees')}>Fees and slippage</Link> — Understand the costs shown before confirmation.</li>
        <li><Link href={productHref('troubleshooting')}>Troubleshooting</Link> — Find the next step when an action stops.</li>
      </ul>
      <h2 id="protocol-and-interface">The protocol and the interface</h2>
      <p>These guides explain FxAeon’s screens and supported actions. The <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs">f(x) Protocol documentation</ExternalLink> explains the underlying contracts, economics, governance, and risk parameters.</p>
    </div>
  </DocsShell>;
}
