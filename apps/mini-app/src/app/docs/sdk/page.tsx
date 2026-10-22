import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';
import DocsShell from '../DocsShell';
import { legacyDocsDestinations } from '../docsSearch';
import { sdkSections } from './SdkArticle';
import { sdkHref, sdkNavigation } from '../sdkNavigation';
import LegacyDocsRedirect from '../LegacyDocsRedirect';
import Link from 'next/link';
import styles from '../Docs.module.css';

export const metadata: Metadata = routeMetadata('docsSdk');

export default function SdkPage() {
  return <DocsShell page="SDK reference">
    <LegacyDocsRedirect destinations={legacyDocsDestinations(sdkSections, sdkHref)} />
    <div className={styles.topicGrid}>{sdkNavigation.map(item => <Link key={item.id} href={sdkHref(item.id)} className={styles.topicCard}>
      <strong>{item.title}</strong><span>{item.description}</span>
    </Link>)}</div>
  </DocsShell>;
}
