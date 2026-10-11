'use client';

import dynamic from 'next/dynamic';
import { PRIVY_APP_ID } from '@/lib/privyConfig';
import { ProviderLoadingState } from '@/components/ProviderLoadingState';

// The configured-provider browser check found different server/client useId
// paths under this boundary. Keep that branch client-only so descendants mount
// once; the no-Privy public/static build remains SSR-rendered.
const ClientWalletProvider = dynamic(
  () => import('@/components/ClientWalletProvider'),
  { loading: () => <ProviderLoadingState />, ssr: !PRIVY_APP_ID },
);

export default function WalletProviderBoundary({ children }: { children: React.ReactNode }) {
  return <ClientWalletProvider>{children}</ClientWalletProvider>;
}
