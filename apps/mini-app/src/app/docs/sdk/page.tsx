import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';
import DocsShell from '../DocsShell';
import { productSections } from '../ProductArticle';
import { createDocsEntries } from '../docsSearch';
import SdkArticle, { sdkSections } from './SdkArticle';

// The shared route metadata keeps the FxAeon banner on share cards. The title is
// absolute because the docs layout's own title stops the root template here.
const shared = routeMetadata('docsSdk');
export const metadata: Metadata = { ...shared, title: { absolute: 'f(x) SDK reference · FxAeon' } };

export default function SdkPage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide'),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="SDK reference" entries={entries}><SdkArticle /></DocsShell>;
}
