'use client';

import RoutePriceProvider from '@/components/RoutePriceProvider';
import WalletProviderBoundary from '@/components/WalletProviderBoundary';

export default function ProductProviders({ children }: { children: React.ReactNode }) {
  return <RoutePriceProvider><WalletProviderBoundary>{children}</WalletProviderBoundary></RoutePriceProvider>;
}
