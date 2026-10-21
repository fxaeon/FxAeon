import { productSections } from '../ProductArticle';
import { sdkSections } from '../sdk/SdkArticle';
import { createDocsEntries, createHeadingEntries } from '../docsSearch';
import { productHref } from '../productNavigation';
import { sdkHref } from '../sdkNavigation';

// A static export, shared by every docs page. No server or search service runs.
export const dynamic = 'force-static';

export function GET() {
  return Response.json([
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide').map(entry => ({ ...entry, href: productHref(entry.id) })),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk').map(entry => ({ ...entry, href: sdkHref(entry.id) })),
    ...createHeadingEntries(sdkSections, 'SDK reference', sdkHref),
  ]);
}
