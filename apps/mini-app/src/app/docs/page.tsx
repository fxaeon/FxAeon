import Link from 'next/link';
import DocsIcon from './DocsIcon';
import DocsShell from './DocsShell';
import { productSections } from './ProductArticle';
import { legacyDocsDestinations } from './docsSearch';
import LegacyDocsRedirect from './LegacyDocsRedirect';
import { productHref } from './productNavigation';
import { ExternalLink } from './ExternalLink';
import styles from './Docs.module.css';

export default function DocsPage() {
  return <DocsShell page="Product guide" home>
    <LegacyDocsRedirect destinations={legacyDocsDestinations(productSections, productHref)} />
    <Link href={productHref('getting-started')} className={styles.startGuide}>
      <span><strong>Your first transaction</strong><small>From choosing a wallet to understanding the receipt. Start here.</small></span>
      <DocsIcon name="ArrowRight" size={22} />
    </Link>
    <h2 id="use-fxaeon">Use FxAeon</h2>
    <p>Trade, earn, borrow, and move assets through one independent interface for f(x) Protocol.</p>
    <div className={styles.productGuides}>
      {[
        { id: 'trade', title: 'Trade', icon: 'CandlestickChart' as const, text: 'Open and manage leveraged ETH or BTC positions.', network: 'Ethereum' },
        { id: 'earn', title: 'Earn', icon: 'Sprout' as const, text: 'Deposit into fxSAVE and choose your withdrawal path.', network: 'Ethereum' },
        { id: 'borrow', title: 'Borrow', icon: 'Landmark' as const, text: 'Put collateral to use and manage your fxUSD debt.', network: 'Ethereum' },
        { id: 'move', title: 'Move', icon: 'ArrowLeftRight' as const, text: 'Bridge fxUSD or fxSAVE to your destination wallet.', network: 'Ethereum ↔ Base' },
      ].map(({ id, title, icon, text, network }) => <Link key={id} href={productHref(id)}>
        <span className={styles.guideTitle}><DocsIcon name={icon} size={22} /><strong>{title}</strong><DocsIcon name="ArrowRight" size={16} /></span>
        <span>{text}</span><small>{network}</small>
      </Link>)}
    </div>
    <h2 id="understand-your-action">Understand your action</h2>
    <div className={styles.resourceLinks}>
      {[
        ['review', 'Read a review & receipt'],
        ['fees', 'Fees & slippage'],
        ['risks', 'Risks & rebalancing'],
        ['history', 'Track or recover a transaction'],
        ['troubleshooting', 'Resolve a problem'],
        ['glossary', 'Look up a term'],
      ].map(([id, title]) => <Link key={id} href={productHref(id)}>{title}<DocsIcon name="ArrowRight" size={16} /></Link>)}
    </div>
    <h2 id="for-developers">For developers</h2>
    <p>Understand the integration, make your first read, and follow a transaction from its SDK plan to a verified receipt.</p>
    <div className={styles.productGuides}>
      <Link href="/docs/sdk/setup"><span className={styles.guideTitle}><DocsIcon name="Code2" size={22} /><strong>Read-only quickstart</strong><DocsIcon name="ArrowRight" size={16} /></span><span>Working examples, units, and the app’s read facade.</span><small>TypeScript · SDK 1.0.5</small></Link>
      <Link href="/docs/sdk/overview"><span className={styles.guideTitle}><DocsIcon name="BookOpen" size={22} /><strong>SDK reference</strong><DocsIcon name="ArrowRight" size={16} /></span><span>Supported methods, execution rules, and reviewed patches.</span><small>15 supported methods</small></Link>
    </div>
    <p>For protocol economics, contracts, and governance, read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs">f(x) Protocol documentation</ExternalLink>.</p>
  </DocsShell>;
}
