'use client';

import { usePathname } from 'next/navigation';
import WalletRecoveryCoordinator from '@/components/WalletRecoveryCoordinator';
import ProtocolPositionProvider from '@/components/ProtocolPositionProvider';
import PositionBrakeProvider from '@/components/PositionBrakeProvider';
import WalletDataProvider from '@/components/WalletDataProvider';
import { walletDemandForPathname } from '@/lib/walletDemand';
import WalletDemandProvider, { useEffectiveWalletDemand } from '@/components/WalletDemandProvider';

/** Both wallet adapters share the same route-scoped reads and recovery lifecycle. */
export default function WalletRouteProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  return <WalletDemandProvider routeDemand={walletDemandForPathname(pathname)} routeKey={pathname}>
    <RouteDataProviders>{children}</RouteDataProviders>
  </WalletDemandProvider>;
}

function RouteDataProviders({ children }: { children: React.ReactNode }) {
  const demand = useEffectiveWalletDemand();
  return <WalletDataProvider enabled={demand.enabled} expandedAssets={demand.expandedAssets} chainPulse={demand.chainPulse}>
    <ProtocolPositionProvider enabled={demand.positions}>
      <WalletRecoveryCoordinator />
      <PositionBrakeProvider>{children}</PositionBrakeProvider>
    </ProtocolPositionProvider>
  </WalletDataProvider>;
}
