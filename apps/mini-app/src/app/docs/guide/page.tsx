import type { Metadata } from 'next';
import DocsShell from '../DocsShell';
import ProductArticle, { productSections } from '../ProductArticle';
import { sdkSections } from '../sdk/SdkArticle';
import { createDocsEntries } from '../docsSearch';

export const metadata: Metadata = { title: { absolute: 'Product guide · FxAeon' } };

export default function GuidePage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide'),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="Product guide" entries={entries}><ProductArticle /></DocsShell>;
}
