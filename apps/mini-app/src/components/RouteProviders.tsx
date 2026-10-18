'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { ProviderLoadingState } from '@/components/ProviderLoadingState';

const ProductProviders = dynamic(() => import('@/components/ProductProviders'), {
  loading: () => <ProviderLoadingState />,
});

/** A docs visit needs no wallet graph. Once opened, keep the product providers
 * mounted across docs navigation so the selected wallet and caches survive. */
export default function RouteProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const docs = pathname === '/docs' || pathname.startsWith('/docs/');
  const [productVisited, setProductVisited] = useState(!docs);
  useEffect(() => { if (!docs) setProductVisited(true); }, [docs]);
  if (docs && !productVisited) return <>{children}</>;
  return <ProductProviders>{children}</ProductProviders>;
}
