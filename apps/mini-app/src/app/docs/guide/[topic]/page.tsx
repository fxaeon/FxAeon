import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DocsShell from '../../DocsShell';
import { productSections } from '../../ProductArticle';
import { sdkSections } from '../../sdk/SdkArticle';
import { createDocsEntries, docsNavigation } from '../../docsSearch';
import { productHref, productNavigation } from '../../productNavigation';
import styles from '../../Docs.module.css';

export function generateStaticParams() { return productNavigation.map(({ id }) => ({ topic: id })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const page = productNavigation.find(({ id }) => id === topic);
  return { title: { absolute: `${page?.title ?? 'Guide'} · FxAeon` }, description: page?.description };
}

export default async function TopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const section = productSections.find(({ id }) => id === topic);
  const article = productNavigation.find(({ id }) => id === topic);
  if (!section || !article) notFound();
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide').map(entry => ({ ...entry, href: productHref(entry.id) })),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="Product guide" entries={docsNavigation(entries, 'Product guide')} article={article}>
    <div id={section.id} className={`${styles.section} ${styles.articleBody}`}>{section.content}</div>
  </DocsShell>;
}
