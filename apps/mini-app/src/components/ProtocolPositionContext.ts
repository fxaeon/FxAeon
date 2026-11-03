'use client';

import { createContext, useContext } from 'react';
import type { PositionGroup, PositionGroupFailure, PositionReadResult, UiPosition } from '@/app/trade/fxUi';
import type { ConfirmedPositionHint } from '@/lib/confirmedPositions';
import type { PlannedRoute, TransactionExecutionResult } from '@/lib/fx';

export type ProtocolPositionStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

export interface ProtocolPositionRefreshResult extends PositionReadResult {
  newPositions: UiPosition[];
  readStartedAt?: number;
  readCompletedAt?: number;
}

export interface ProtocolPositionSnapshot {
  walletAddress: string | null;
  positions: UiPosition[];
  status: ProtocolPositionStatus;
  failedGroups: PositionGroupFailure[];
  lastVerifiedAt: number | null;
  refreshing: boolean;
  verifiedGroups: PositionGroup[];
}

export interface ProtocolPositionContextValue extends ProtocolPositionSnapshot {
  refresh: (options?: { afterConfirmation?: boolean }) => Promise<ProtocolPositionRefreshResult>;
  pendingPositions: ConfirmedPositionHint[];
  checkingConfirmedPositions: boolean;
  refreshConfirmedPositions: () => Promise<void>;
  trackConfirmedPosition: (execution: TransactionExecutionResult, route: PlannedRoute) => Promise<boolean>;
  reconcileClosedPosition: (position: Pick<UiPosition, 'market' | 'side'> & { info: Pick<UiPosition['info'], 'positionId'> }) => Promise<boolean>;
}

export const ProtocolPositionContext = createContext<ProtocolPositionContextValue | null>(null);

export function useProtocolPositions(): ProtocolPositionContextValue {
  const value = useContext(ProtocolPositionContext);
  if (!value) throw new Error('useProtocolPositions must be used inside ProtocolPositionProvider');
  return value;
}
