import Link from 'next/link';
import DocsShell from './DocsShell';
import { productSections } from './ProductArticle';
import { sdkSections } from './sdk/SdkArticle';
import { createDocsEntries, docsNavigation } from './docsSearch';
import styles from './Docs.module.css';
import { productHref } from './productNavigation';
import { ExternalLink } from './ExternalLink';

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
      <div className={styles.referenceTable}>
        <table><thead><tr><th>Product</th><th>Use it to</th><th>Network</th></tr></thead><tbody>
          <tr><td><Link href={productHref('trade')}>Trade</Link></td><td>Open and manage leveraged ETH or BTC positions.</td><td>Ethereum</td></tr>
          <tr><td><Link href={productHref('earn')}>Earn</Link></td><td>Deposit into fxSAVE and manage withdrawals.</td><td>Ethereum</td></tr>
          <tr><td><Link href={productHref('borrow')}>Borrow</Link></td><td>Borrow fxUSD against supported collateral.</td><td>Ethereum</td></tr>
          <tr><td><Link href={productHref('move')}>Move</Link></td><td>Bridge fxUSD or fxSAVE to your destination wallet.</td><td>Ethereum ↔ Base</td></tr>
        </tbody></table>
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
