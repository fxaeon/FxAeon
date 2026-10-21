'use client';

import { AmountUsd } from '@/components/review/AmountUsd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { Address } from 'viem';
import { Button, Card, SectionTitle } from '@/components/ui';
import { BridgeTracker } from '@/components/BridgeTracker';
import {
  cancelSignatureRequiredDraft,
  getPublicClient,
  reconcileWalletJournal,
  readSignatureRequiredDrafts,
  signatureDraftResumePath,
  FX_TOKENS,
  type RecoveryViewModel,
  type SignatureRequiredDraft,
} from '@/lib/fx';
import { haptic, openExternalLink } from '@/lib/telegram';
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { createRecoveryWalletRefresh, createWalletReadScope } from '@/lib/walletDataRefresh';
import { selectWalletTasks, type WalletTask } from '@/lib/taskState';
import { buildReceiptPresentation, verifiedReceiptPositionIdentity } from '@/lib/receiptPresentation';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import type { ConfirmedPositionHint } from '@/lib/confirmedPositions';
import { useWalletDemand } from '@/components/WalletDemandProvider';

type Props = {
  walletAddress: Address;
  embedded?: boolean;
  hideWhenEmpty?: boolean;
};

const RECOVERY_POSITION_DEMAND = { expandedAssets: false, chainPulse: false, positions: true } as const;

function chainName(chainId: RecoveryViewModel['record']['chainId']): string {
  return chainId === 8453 ? 'Base' : 'Ethereum';
}

function operationName(operation: string, intent?: string, stepKind?: RecoveryViewModel['record']['stepKind'], to?: string): string {
  if (stepKind === 'approval') {
    const token = to ? Object.values(FX_TOKENS).find((candidate) => candidate.address.toLowerCase() === to.toLowerCase()) : undefined;
    return `Approve ${token?.key ?? 'token'}`;
  }
  if (stepKind === 'unknown' || stepKind === undefined) return 'Transaction';
  if (intent) return intent;
  const labels: Record<string, string> = {
    increasePosition: 'Opened or increased position',
    reducePosition: 'Reduced position',
    adjustPositionLeverage: 'Adjusted leverage',
    depositAndMint: 'Minted fxUSD',
    repayAndWithdraw: 'Repaid and withdrew',
    depositFxSave: 'Deposit Fx Save',
    withdrawFxSave: 'Withdraw fxSAVE',
    getRedeemTx: 'Claim fxSAVE',
    buildBridgeTx: 'Move assets',
  };
  return labels[operation]
    ?? operation.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
}

function nextAction(operation: string, positionHint?: Pick<ConfirmedPositionHint, 'market' | 'side' | 'positionId'>): { href: string; label: string } | null {
  if (positionHint) return {
    href: `/positions?position=${encodeURIComponent(`${positionHint.market}:${positionHint.side}:${positionHint.positionId}`)}`,
    label: `View ${positionHint.market} ${positionHint.side} #${positionHint.positionId}`,
  };
  if (['increasePosition', 'reducePosition', 'adjustPositionLeverage'].includes(operation)) return { href: '/positions', label: 'View positions' };
  if (['depositAndMint', 'repayAndWithdraw'].includes(operation)) return { href: '/borrow', label: 'View Borrow' };
  if (['depositFxSave', 'withdrawFxSave', 'getRedeemTx'].includes(operation)) return { href: '/earn', label: 'View Earn' };
  return null;
}

function draftOperationName(operation: string): string {
  const labels: Record<string, string> = {
    increasePosition: 'Open or increase position',
    reducePosition: 'Reduce position',
    adjustPositionLeverage: 'Adjust leverage',
    depositAndMint: 'Borrow fxUSD',
    repayAndWithdraw: 'Repay and withdraw',
    depositFxSave: 'Deposit to fxSAVE',
    withdrawFxSave: 'Withdraw from fxSAVE',
    getRedeemTx: 'Claim fxSAVE',
    buildBridgeTx: 'Move assets',
  };
  return labels[operation]
    ?? operation.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function submittedAt(timestamp: number): string {
  // UTC keeps the static/hydrated render deterministic and avoids implying
  // that a local timestamp is protocol state.
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'time pending';
  return date.toISOString().slice(0, 16).replace('T', ' UTC ');
}

function statusCopy(view: RecoveryViewModel): {
  label: string;
  icon: typeof Clock3;
  className: string;
} {
  if (view.status === 'confirmed') {
    return { label: view.record.stepKind === 'approval' ? 'Approval confirmed' : 'Completed', icon: CheckCircle2, className: 'text-success' };
  }
  if (view.status === 'failed') {
    return { label: 'Failed', icon: XCircle, className: 'text-danger' };
  }
  if (view.verification === 'confirming') {
    return { label: 'Confirming', icon: Clock3, className: 'text-mint' };
  }
  return { label: 'Submitted', icon: view.verification === 'rpc-error' || view.verification === 'mismatch' ? CircleAlert : Clock3, className: view.verification === 'rpc-error' || view.verification === 'mismatch' ? 'text-warn' : 'text-mint' };
}

function statusSummary(view: RecoveryViewModel, positionRefreshing = false): string {
  if (view.record.stepKind === 'approval') {
    if (view.status === 'confirmed') return 'Approval transaction confirmed on-chain. Check other saved transactions for action progress.';
    if (view.status === 'failed') return 'Approval transaction reverted on-chain. Check other saved transactions for action progress.';
    if (view.verification === 'confirming') return 'Approval receipt included. Waiting for 1 confirmation.';
    if (view.verification === 'not-found') return 'No approval receipt yet. The transaction may still be pending.';
    if (view.verification === 'rpc-error') return 'Network check unavailable. Approval status remains unverified.';
    return 'Approval transaction details did not match, so it remains unverified.';
  }
  if (view.record.stepKind !== 'action') {
    if (view.status === 'confirmed') return 'Transaction confirmed on-chain. No position outcome is inferred from this receipt.';
    if (view.status === 'failed') return 'Transaction reverted on-chain. No later step is resumed automatically.';
    if (view.verification === 'not-found') return 'No receipt yet. The transaction may still be pending.';
    if (view.verification === 'confirming') return 'Receipt included. Waiting for 1 confirmation.';
    if (view.verification === 'rpc-error') return 'Network check unavailable. Nothing was marked failed.';
    return 'Chain data did not match the saved transaction details, so it remains unverified.';
  }
  if (view.status === 'confirmed' && view.record.bridge) return 'Source confirmed after 1 confirmation. Destination delivery is tracked below.';
  if (view.status === 'confirmed' && positionRefreshing && ['increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw'].includes(view.record.operation)) {
    return 'Transaction confirmed. Position details are refreshing.';
  }
  if (view.status === 'confirmed') return 'Confirmed on-chain after 1 confirmation.';
  if (view.status === 'failed') return 'Transaction reverted on-chain. No later step is resumed automatically.';
  if (view.verification === 'not-found') return 'No receipt yet. The transaction may still be pending.';
  if (view.verification === 'confirming') return 'Receipt included. Waiting for 1 confirmation. Do not submit this action again.';
  if (view.verification === 'rpc-error') return 'Network check unavailable. Nothing was marked failed.';
  return 'Chain data did not match the saved transaction details, so it remains unverified.';
}

function DraftItem({ draft, onCancel }: { draft: SignatureRequiredDraft; onCancel: (id: string) => void }) {
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.025)] p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[12.5px] font-semibold">{draftOperationName(draft.operation)}</p>
              <p className="mt-0.5 text-[10.5px] text-mut">{chainName(draft.chainId)} · {submittedAt(draft.updatedAt)}</p>
            </div>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-mut">
              Unsubmitted
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <Link href={signatureDraftResumePath(draft)} className="inline-flex min-h-11 items-center rounded-lg px-2 text-[10.5px] font-semibold text-mint hover:bg-[var(--mint-dim)]">Continue</Link>
            <button type="button" onClick={() => onCancel(draft.id)} className="inline-flex min-h-11 items-center rounded-lg px-2 text-[10.5px] font-semibold text-mut hover:bg-[var(--surface-2)]">Dismiss</button>
          </div>
        </div>
      </div>
    </li>
  );
}

function RecoveryItem({ view, trackBridge, autoTrackBridge, task, positionHint, positionRefreshing = false }: { view: RecoveryViewModel; trackBridge: boolean; autoTrackBridge: boolean; task?: WalletTask; positionHint?: ConfirmedPositionHint; positionRefreshing?: boolean }) {
  const status = statusCopy(view);
  const verifiedPosition = view.record.stepKind === 'action' ? verifiedReceiptPositionIdentity({ status: view.status, verification: view.verification,
    transactionHash: view.record.hash, hint: positionHint }) : undefined;
  const action = view.record.stepKind === 'action' ? nextAction(view.record.operation, verifiedPosition ?? undefined) : null;
  const receiptFacts = view.verification === 'receipt' ? buildReceiptPresentation({
    chainId: view.record.chainId,
    walletAddress: view.record.walletAddress,
    status: view.status === 'confirmed' ? 'success' : 'reverted',
    transfers: view.receiptTransfers,
    executionCostWei: view.receiptExecutionCostWei,
    nativeValueWei: view.receiptNativeValueWei,
  }) : null;
  const showBridgeTracker = trackBridge && Boolean(view.record.bridge) && view.status === 'confirmed';
  const advancedContent = (
            <div className="pb-2 text-[10.5px] leading-relaxed text-mut">
              <p>{view.message}</p>
              {view.receiptBlockNumber !== undefined && <p className="mt-1">Block {view.receiptBlockNumber.toString()}</p>}
              {receiptFacts && (
                <div className="mt-2 space-y-1">
                  <p className="font-semibold text-[var(--text)]">Verified receipt facts</p>
                  {verifiedPosition && <p>Created position: {verifiedPosition.market} {verifiedPosition.side} #{verifiedPosition.positionId}</p>}
                  {view.status === 'failed' ? <p>Transaction reverted; token movements were not recorded.</p>
                    : receiptFacts.movements.length ? receiptFacts.movements.map((movement, index) => <p key={`${movement}:${index}`}>{movement}</p>)
                      : <p>Token movements could not be established from the verified receipt.</p>}
                  {receiptFacts.nativeValue && <p>Native value sent: {receiptFacts.nativeValue}<AmountUsd amount={receiptFacts.exactNativeValue ?? ''} symbol="ETH" receipt /></p>}
                  {receiptFacts.executionFee ? <p>{receiptFacts.feeLabel}: {receiptFacts.executionFee}<AmountUsd amount={receiptFacts.exactFees?.execution ?? ''} symbol="ETH" receipt />{receiptFacts.feeCaveat ? ` · ${receiptFacts.feeCaveat}` : ''}</p>
                    : <p>Actual transaction fee is unavailable from this RPC response.</p>}
                  {receiptFacts.technicalMovements.length > 0 && <section className="pt-1" aria-label="Technical token movements">
                    {receiptFacts.technicalMovements.map((movement) => <p key={movement} className="break-all">{movement}</p>)}
                  </section>}
                  {action && <Link className="mt-1 inline-flex min-h-11 items-center text-mint" href={action.href}>{action.label}</Link>}
                </div>
              )}
              <p className="mt-1 font-mono text-[10px] text-[var(--mut-2)]">{view.record.hash}</p>
            </div>
  );
  const Icon = status.icon;
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.025)] p-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] ${status.className}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[12.5px] font-semibold">{operationName(view.record.operation, view.record.intent, view.record.stepKind, view.record.to)}</p>
              <p className="mt-0.5 text-[10.5px] text-mut">{chainName(view.record.chainId)} · {submittedAt(view.record.submittedAt)}</p>
            </div>
              <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${status.className}`}>{view.record.stepKind === 'approval' ? status.label : task?.title ?? status.label}</span>
          </div>
          <p className="mt-2 break-words text-[11.5px] leading-relaxed text-mut">{statusSummary(view, positionRefreshing)}</p>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-[var(--mut-2)]">{shortHash(view.record.hash)}</span>
            <a
              href={view.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                // Telegram WebViews need their host-aware opener; keeping the
                // href preserves keyboard/middle-click behaviour in browsers.
                event.preventDefault();
                openExternalLink(view.explorerUrl);
              }}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[10.5px] font-semibold text-mint hover:bg-[var(--mint-dim)]"
            >
              Explorer <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
          {!showBridgeTracker && <details className="mt-1 border-t border-[var(--line)] pt-1">
            <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-mut">Advanced<ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 disclosure-chevron" /></summary>
            {advancedContent}
          </details>}
          {showBridgeTracker && view.record.bridge && (
            <BridgeTracker
              compact
              advancedContent={advancedContent}
              className="mt-3"
              sourceChain={view.record.chainId === 1 ? 'Ethereum' : 'Base'}
              destinationChain={view.record.bridge.destinationChainId === 1 ? 'Ethereum' : 'Base'}
              token={view.record.bridge.bridgeToken ?? 'Bridge asset'}
              amount={formatBridgeAmount(view.record.bridge.amountLD)}
              sourceTxHash={view.record.hash}
              status="source_confirmed"
              sourceOftAddress={view.record.bridge.sourceOftAddress}
              destinationOftAddress={view.record.bridge.destinationOftAddress}
              recipient={view.record.bridge.recipient}
              sourceSender={view.record.walletAddress}
              amountLD={BigInt(view.record.bridge.amountLD)}
              minAmountLD={BigInt(view.record.bridge.minAmountLD)}
              destinationBaselineBlock={BigInt(view.record.bridge.destinationBaselineBlock)}
              autoStart={autoTrackBridge}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function formatBridgeAmount(value: string): string {
  const whole = value.padStart(19, '0');
  const integer = whole.slice(0, -18).replace(/^0+(?=\d)/, '');
  const fraction = whole.slice(-18).replace(/0+$/, '').slice(0, 6);
  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * A wallet-scoped activity surface for submitted hashes and unsigned resume
 * drafts. Submitted transactions are reconciled from chain receipts. Drafts
 * only reopen the original product route; that route must rebuild and simulate
 * its transaction from current state before asking the wallet to sign.
 */
export default function PendingTransactionRecovery({ walletAddress, embedded = false, hideWhenEmpty = false }: Props) {
  const identity = walletAddress.toLowerCase();
  useWalletDemand(RECOVERY_POSITION_DEMAND, Boolean(walletAddress));
  const readScope = useRef(createWalletReadScope(walletAddress));
  readScope.current.select(walletAddress);
  const invalidateWalletData = useInvalidateWalletData();
  const positionState = useProtocolPositions();
  const refreshWallet = useMemo(() => createRecoveryWalletRefresh(invalidateWalletData), [invalidateWalletData]);
  const [snapshot, setSnapshot] = useState({ identity: '', views: [] as RecoveryViewModel[], drafts: [] as SignatureRequiredDraft[], loading: true, refreshing: false, error: '' });
  const current = snapshot.identity === identity;
  const views = useMemo(() => current ? snapshot.views : [], [current, snapshot.views]);
  const drafts = useMemo(() => current ? snapshot.drafts.filter((draft) => draft.status === 'signature-required') : [], [current, snapshot.drafts]);
  const loading = !current || snapshot.loading;
  const refreshing = !current || snapshot.refreshing;
  const error = current ? snapshot.error : '';

  const refresh = useCallback(async () => {
    const isCurrent = readScope.current.start(walletAddress);
    if (!isCurrent) return;
    setSnapshot((previous) => ({ identity, views: previous.identity === identity ? previous.views : [], drafts: previous.identity === identity ? previous.drafts : [], loading: previous.identity !== identity || previous.loading, refreshing: true, error: '' }));
    try {
      const localDrafts = readSignatureRequiredDrafts(walletAddress);
      const next = await reconcileWalletJournal({
        walletAddress,
        getClient: getPublicClient,
      });
      if (!isCurrent()) return;
      await refreshWallet(next, walletAddress, isCurrent);
      if (!isCurrent()) return;
      setSnapshot({ identity, views: [...next].reverse(), drafts: [...localDrafts].sort((left, right) => right.updatedAt - left.updatedAt), loading: false, refreshing: false, error: '' });
    } catch {
      if (!isCurrent()) return;
      setSnapshot((previous) => ({ ...previous, loading: false, refreshing: false, error: 'Saved transactions could not be checked. Nothing was marked complete or failed.' }));
    }
  }, [identity, refreshWallet, walletAddress]);

  useEffect(() => {
    const scope = readScope.current;
    void refresh();
    return () => scope.cancel();
  }, [refresh]);
  const autoBridgeIds = useMemo(() => new Set(
    views
      .filter((view) => view.status === 'confirmed' && Boolean(view.record.bridge))
      .slice(0, 2)
      .map((view) => view.record.id),
  ), [views]);
  const walletTasks = useMemo(() => new Map(selectWalletTasks({ walletAddress, transactions: views }).map((task) => [task.id, task])), [views, walletAddress]);
  const positionHints = positionState.walletAddress?.toLowerCase() === identity ? positionState.pendingPositions : [];
  const cancelDraft = useCallback((id: string) => {
    cancelSignatureRequiredDraft(id);
    setSnapshot((previous) => previous.identity === identity
      ? { ...previous, drafts: previous.drafts.map((draft) => draft.id === id ? { ...draft, status: 'cancelled', updatedAt: Date.now() } : draft) }
      : previous);
  }, [identity]);
  if (hideWhenEmpty && !loading && !error && views.length === 0 && drafts.length === 0) return null;
  return (
    <section aria-labelledby="transaction-recovery-title">
      {!embedded && <SectionTitle
        right={(
          <button
            type="button"
            aria-label="Refresh transaction recovery"
            className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint"
            onClick={() => {
              haptic('light');
              void refresh();
            }}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        )}
      >
        <span id="transaction-recovery-title">History</span>
      </SectionTitle>}
      {embedded && <h2 id="transaction-recovery-title" className="sr-only">History</h2>}
      <Card className="p-3.5">
        {error && <p role="status" className="mb-3 text-[11px] text-warn">{error}</p>}
        {loading ? (
          <div role="status" className="flex items-center gap-2 px-1 py-3 text-[11px] text-mut">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint border-t-transparent" aria-hidden="true" />
            Checking saved transactions…
          </div>
        ) : views.length === 0 && drafts.length === 0 ? (
          <p className="px-1 py-2 text-[12px] leading-relaxed text-mut">No transaction history is saved for this wallet.</p>
        ) : (
          <div className="flex flex-col gap-4" aria-live="polite">
            {drafts.length > 0 && (
              <details className="rounded-xl border border-[var(--line)] px-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-mut">
                  <span>Drafts ({drafts.length})</span>
                  <span className="ml-auto text-[10px] font-medium text-[var(--mut-2)]">Not submitted</span>
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 disclosure-chevron" />
                </summary>
                <p className="pb-2 text-[10.5px] leading-relaxed text-mut">Continue rebuilds the action from current details before asking for a signature.</p>
                <ul className="flex flex-col gap-2.5 pb-3">
                  {drafts.map((draft) => <DraftItem key={draft.id} draft={draft} onCancel={cancelDraft} />)}
                </ul>
              </details>
            )}
            {views.length > 0 && (
              <section aria-labelledby="submitted-history-title">
                <h3 id="submitted-history-title" className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-mut">Submitted transactions</h3>
                <ul className="flex flex-col gap-2.5">
                  {views.map((view) => (
                    <RecoveryItem
                      key={view.record.id}
                      view={view}
                      // Every independently confirmed bridge needs its own delivery
                      // correlation. Tracking only the first bridge would leave
                      // later transfers permanently unverified in the recovery UI.
                      trackBridge={view.status === 'confirmed' && Boolean(view.record.bridge)}
                      autoTrackBridge={autoBridgeIds.has(view.record.id)}
                      task={walletTasks.get(`transaction:${view.record.id}`)}
                      positionHint={positionHints.find((hint) => hint.transactionHash.toLowerCase() === view.record.hash.toLowerCase())}
                      positionRefreshing={positionState.walletAddress?.toLowerCase() === identity && positionState.refreshing}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        {!loading && (views.length > 0 || drafts.length > 0) && (
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-mut">Saved on this device for this wallet.</p>
        )}
        <Button
          variant="ghost"
          className="mt-2 min-h-11 text-[11px]"
          loading={refreshing}
          onClick={() => void refresh()}
        >
          Check status again
        </Button>
      </Card>
    </section>
  );
}
