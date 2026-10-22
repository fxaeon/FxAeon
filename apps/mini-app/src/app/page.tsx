import type { Metadata } from 'next';
import PortfolioPage from './portfolio/page';
import { BRAND_DESCRIPTION, BRAND_TITLE, pageMetadata } from './routeMetadata';

export const metadata: Metadata = pageMetadata(BRAND_TITLE, BRAND_DESCRIPTION, '/');

export default function HomePage() {
  return <PortfolioPage />;
}
