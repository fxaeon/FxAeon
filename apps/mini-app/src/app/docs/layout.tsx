import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';
import { structuredData } from './structuredData';

export const metadata: Metadata = routeMetadata('docs');

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    {children}
  </>;
}
