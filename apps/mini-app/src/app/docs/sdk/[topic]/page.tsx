import type { Metadata } from 'next';
import { pageMetadata } from '@/app/routeMetadata';
import { topicContent } from '../../DocsPrimitives';
import { notFound } from 'next/navigation';
import DocsShell from '../../DocsShell';
import { sdkSections } from '../SdkArticle';
import { sdkHref, sdkNavigation } from '../../sdkNavigation';
import styles from '../../Docs.module.css';

export function generateStaticParams() { return sdkNavigation.map(({ id }) => ({ topic: id.replace(/^sdk-/, '') })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const article = sdkNavigation.find(({ id }) => id === `sdk-${topic}`);
  if (!article) notFound();
  return pageMetadata(article.title + ' · FxAeon', article.description, sdkHref(article.id));
}

export default async function SdkTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const section = sdkSections.find(({ id }) => id === `sdk-${topic}`);
  const article = sdkNavigation.find(({ id }) => id === `sdk-${topic}`);
  if (!section || !article) notFound();
  return <DocsShell page="SDK reference" articleId={article.id}>
    <div id={section.id} className={styles.section}>{topicContent(section.content)}</div>
  </DocsShell>;
}
