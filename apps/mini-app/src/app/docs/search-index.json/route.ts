import { productSections } from '../ProductArticle';
import { sdkSections } from '../sdk/SdkArticle';
import { createDocsEntries } from '../docsSearch';
import { productHref } from '../productNavigation';

// A static export, shared by every docs page. No server or search service runs.
export const dynamic = 'force-static';

export function GET() {
  return Response.json([
    ...createDocsEntries(productSections, 'Product guide', '/docs/guide').map(entry => ({ ...entry, href: productHref(entry.id) })),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ]);
}
