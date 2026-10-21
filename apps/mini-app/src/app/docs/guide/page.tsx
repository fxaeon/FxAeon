import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';
import DocsShell from '../DocsShell';
import { productSections } from '../ProductArticle';
import { legacyDocsDestinations } from '../docsSearch';
import { productHref, productNavigation } from '../productNavigation';
import LegacyDocsRedirect from '../LegacyDocsRedirect';
import Link from 'next/link';
import styles from '../Docs.module.css';

export const metadata: Metadata = routeMetadata('docsGuide');

export default function GuidePage() {
  return <DocsShell page="Product guide">
    <LegacyDocsRedirect destinations={legacyDocsDestinations(productSections, productHref)} />
    <div className={styles.topicGrid}>{productNavigation.map(item => <Link key={item.id} href={productHref(item.id)} className={styles.topicCard}>
      <strong>{item.title}</strong><span>{item.description}</span>
    </Link>)}</div>
  </DocsShell>;
}
