import type { Metadata } from 'next';
import { pageMetadata } from '@/app/routeMetadata';
import { notFound } from 'next/navigation';
import DocsShell from '../../DocsShell';
import { productSections } from '../../ProductArticle';
import { topicContent } from '../../DocsPrimitives';
import { productHref, productNavigation } from '../../productNavigation';
import styles from '../../Docs.module.css';

export function generateStaticParams() { return productNavigation.map(({ id }) => ({ topic: id })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const page = productNavigation.find(({ id }) => id === topic);
  if (!page) notFound();
  return pageMetadata(page.title + ' · FxAeon', page.description, productHref(page.id));
}

export default async function TopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const section = productSections.find(({ id }) => id === topic);
  const article = productNavigation.find(({ id }) => id === topic);
  if (!section || !article) notFound();
  return <DocsShell page="Product guide" articleId={article.id}>
    <div id={section.id} className={styles.section}>{topicContent(section.content)}</div>
  </DocsShell>;
}
