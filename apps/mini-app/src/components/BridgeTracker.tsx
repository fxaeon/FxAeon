'use client';

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { getEidByChainId } from '@aladdindao/fx-sdk';
import { formatUnits, type Address, type Hex } from 'viem';
import { CheckCircle2, Clock3, ExternalLink, LoaderCircle, Network, RefreshCw, XCircle } from 'lucide-react';
import { assertPublicClientChain, getPublicClient } from '@/lib/fx/clients';
import { userSafeError } from '@/lib/errors';
import {
  findSourceOftSent,
  findDestinationOftReceived,
  OFT_RECEIVED_EVENT,
  scanDestinationOftReceivedInChunks,
  type BridgeEventLog,
  type SourceOftSentMatch,
} from '@/lib/fx/bridgeDelivery';
import { haptic, openExternalLink } from '@/lib/telegram';
import { isForegroundOnline, subscribeToForegroundResume } from '@/lib/foreground';
import { useTransactionEvidence } from './review/TransactionEvidenceContext';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { BridgeResultCard } from './review/BridgeResultCard';
import { updatePendingBridgeDeliveryProof } from '@/lib/fx/journal';
import type { PendingBridgeContext } from '@/lib/fx/types';

export type BridgeStepStatus = 'pending' | 'source_confirmed' | 'destination_verified' | 'failed';

export interface BridgeTrackerProps {
  sourceChain: 'Ethereum' | 'Base';
  destinationChain: 'Ethereum' | 'Base';
  token: string;
  amount: string;
  sourceTxHash?: string | null;
  /** A source receipt is not proof of LayerZero delivery. */
  status?: BridgeStepStatus;
  /** Immutable bridge facts captured in the reviewed route. */
  sourceOftAddress?: string;
  destinationOftAddress?: string;
  recipient?: string;
  sourceSender?: string;
  amountLD?: bigint;
  minAmountLD?: bigint;
  destinationBaselineBlock?: bigint;
  /** Recovery lists auto-start only a bounded number of expensive log scans. */
  autoStart?: boolean;
  className?: string;
  /** Presentation only; polling, matching and finality rules are unchanged. */
  compact?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Receipt facts share this tracker’s single Advanced disclosure. */
  completionContent?: (destinationTxHash: string) => ReactNode;
}

type GetLogsRequest = {
  address: Address;
  event: typeof OFT_RECEIVED_EVENT;
  args: { guid: Hex; toAddress: Address };
  fromBlock: bigint;
  toBlock: bigint;
};

type GetLogs = (request: GetLogsRequest) => Promise<readonly BridgeEventLog[]>;
const DESTINATION_CONFIRMATIONS = 1n;
const DESTINATION_CONFIRMATION_LABEL = `${DESTINATION_CONFIRMATIONS} destination confirmation${DESTINATION_CONFIRMATIONS === 1n ? '' : 's'}`;

function explorerFor(chain: 'Ethereum' | 'Base'): string {
  return chain === 'Base' ? 'https://basescan.org' : 'https://etherscan.io';
}

function chainIdFor(chain: 'Ethereum' | 'Base'): 1 | 8453 {
  return chain === 'Base' ? 8453 : 1;
}

/**
 * Show bridge progress without ever treating a balance increase as delivery.
 * The only successful terminal state is a matching LayerZero V2
 * OFTSent(guid, ...) -> OFTReceived(guid, ...) pair.
 */
export function BridgeTracker({
  sourceChain,
  destinationChain,
  token,
  amount,
  sourceTxHash,
  status = 'pending',
  sourceOftAddress,
  destinationOftAddress,
  recipient,
  sourceSender,
  amountLD,
  minAmountLD,
  destinationBaselineBlock,
  autoStart = true,
  className = '',
  compact = false,
  headingRef,
  completionContent,
}: BridgeTrackerProps) {
  const simulated = useTransactionEvidence() === 'simulation';
  const [verifiedContextKey, setVerifiedContextKey] = useState<string | null>(null);
  const [sourceEventFound, setSourceEventFound] = useState(false);
  const [sourceAmountProof, setSourceAmountProof] = useState<{ context: string; amount: bigint } | null>(null);
  const [destinationAmountProof, setDestinationAmountProof] = useState<{ context: string; amount: bigint } | null>(null);
  const [sourceReverted, setSourceReverted] = useState(false);
  const [detectedDestinationTxHash, setDetectedDestinationTxHash] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);
  const [manualStarted, setManualStarted] = useState(false);
  const destinationCursorRef = useRef<bigint | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const verificationContextKey = [
    status,
    sourceTxHash ?? '',
    sourceChain,
    destinationChain,
    token,
    sourceOftAddress ?? '',
    destinationOftAddress ?? '',
    recipient ?? '',
    sourceSender ?? '',
    amountLD?.toString() ?? '',
    minAmountLD?.toString() ?? '',
    destinationBaselineBlock?.toString() ?? '',
  ].join('|').toLowerCase();
  const sourceStatusConfirmed = status === 'source_confirmed' || status === 'destination_verified';
  const hasVerificationContext = Boolean(
    sourceTxHash && sourceOftAddress && destinationOftAddress && recipient && sourceSender
      && amountLD !== undefined && minAmountLD !== undefined && destinationBaselineBlock !== undefined,
  );

  useEffect(() => {
    setVerifiedContextKey(null);
    setSourceEventFound(false);
    setSourceAmountProof(null);
    setDestinationAmountProof(null);
    setSourceReverted(false);
    setDetectedDestinationTxHash(null);
    setVerificationError(null);
    setCanRetry(false);
    setRetrySequence(0);
    setManualStarted(false);
    destinationCursorRef.current = null;
  }, [verificationContextKey]);

  // A Telegram WebView may be backgrounded while LayerZero is delivering.
  // Pause the bounded poll loop while hidden and revalidate immediately when
  // the user returns or the network becomes reachable again.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    return subscribeToForegroundResume(() => setRetrySequence((value) => value + 1));
  }, []);

  useEffect(() => {
    if (!sourceStatusConfirmed || !sourceTxHash || (!autoStart && !manualStarted)) return;
    if (!sourceOftAddress || !destinationOftAddress || !recipient || !sourceSender || amountLD === undefined || minAmountLD === undefined || destinationBaselineBlock === undefined) {
      setVerificationError('Required recovery details are missing, so destination delivery cannot be verified from this hash alone.');
      return;
    }

    let cancelled = false;
    // Resume/retry revalidates proof rather than displaying cached success.
    setVerifiedContextKey(null);
    setDestinationAmountProof(null);
    setDetectedDestinationTxHash(null);
    setCanRetry(false);
    const sourceChainId = chainIdFor(sourceChain);
    const destinationChainId = chainIdFor(destinationChain);
    const maxAttempts = 24;
    const pollMs = 15_000;
    let attempts = 0;
    let sourceReceiptReverted = false;
    let sourceMessage: SourceOftSentMatch | undefined;
    // Advance this cursor between polls. Recovered bridges can be days old,
    // and a single baseline-to-head eth_getLogs request exceeds common RPC
    // range limits even though the matching delivery is valid.
    let nextDestinationBlock = destinationCursorRef.current ?? destinationBaselineBlock;

    const verify = async () => {
      if (!isForegroundOnline()) {
        if (!cancelled) setCanRetry(true);
        return;
      }
      try {
        const sourceClient = getPublicClient(sourceChainId);
        await assertPublicClientChain(sourceClient, sourceChainId);
        if (!sourceMessage) {
          const receipt = await sourceClient.getTransactionReceipt({ hash: sourceTxHash as Hex });
          if (cancelled) return;
          if (receipt.transactionHash.toLowerCase() !== sourceTxHash.toLowerCase()) {
            throw new Error('source bridge receipt hash does not match the submitted transaction');
          }
          if (typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber < 0n) {
            throw new Error('The source receipt is missing block information.');
          }
          if (receipt.status !== 'success') {
            sourceReceiptReverted = true;
            if (!cancelled) setSourceReverted(true);
            throw new Error('The source transaction reverted. Destination delivery will not occur.');
          }
          sourceMessage = findSourceOftSent(receipt.logs as unknown as readonly BridgeEventLog[], {
            sourceOftAddress: sourceOftAddress as Address,
            destinationEid: getEidByChainId(destinationChainId),
            sender: sourceSender as Address,
            amountLD,
            minimumReceivedLD: minAmountLD,
          });
          if (!cancelled) {
            setSourceEventFound(true);
            setSourceAmountProof({ context: verificationContextKey, amount: sourceMessage.amountSentLD });
          }
        }

        const destinationClient = getPublicClient(destinationChainId);
        await assertPublicClientChain(destinationClient, destinationChainId);
        const latestBlock = await destinationClient.getBlockNumber();
        if (latestBlock < destinationBaselineBlock) {
          throw new Error('The destination chain is still catching up.');
        }
        const getLogs = destinationClient.getLogs as unknown as GetLogs;
        const scan = await scanDestinationOftReceivedInChunks({
          fromBlock: nextDestinationBlock,
          toBlock: latestBlock,
          getLogs: ({ fromBlock, toBlock }) => getLogs({
            address: destinationOftAddress as Address,
            event: OFT_RECEIVED_EVENT,
            args: {
              guid: sourceMessage!.guid,
              toAddress: recipient as Address,
            },
            fromBlock,
            toBlock,
          }),
          expected: {
            destinationOftAddress: destinationOftAddress as Address,
            guid: sourceMessage.guid,
            sourceEid: getEidByChainId(sourceChainId),
            recipient: recipient as Address,
            amountReceivedLD: sourceMessage.amountReceivedLD,
          },
        });
        // A route change or retry can finish an old RPC request after the new
        // verification loop starts. Never let it move the new loop's cursor.
        if (cancelled) return;
        nextDestinationBlock = scan.nextBlock;
        destinationCursorRef.current = scan.nextBlock;
        if (!scan.match) {
          if (!cancelled) setDetectedDestinationTxHash(null);
          throw new Error(scan.complete
            ? 'destination chain has not emitted the matching OFTReceived event'
            : `Scanning historical destination blocks through ${scan.nextBlock - 1n}.`);
        }
        const received = scan.match;
        if (typeof received.blockNumber !== 'bigint' || received.blockNumber < destinationBaselineBlock) {
          throw new Error('The destination delivery is missing block information.');
        }
        if (typeof received.blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(received.blockHash)) {
          throw new Error('The destination delivery is missing block identity.');
        }
        if (typeof received.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(received.transactionHash)) {
          throw new Error('The destination delivery is missing transaction information.');
        }
        // Keep rescanning the candidate block until it is deep enough. If a
        // reorg removes or replaces the event, the exact-block proof below
        // fails and destination verification is revoked rather than cached.
        nextDestinationBlock = received.blockNumber;
        destinationCursorRef.current = received.blockNumber;
        if (latestBlock < received.blockNumber + DESTINATION_CONFIRMATIONS - 1n) {
          if (!cancelled) setDetectedDestinationTxHash(received.transactionHash ?? null);
          throw new Error(`Delivery observed in block ${received.blockNumber}; waiting for ${DESTINATION_CONFIRMATION_LABEL}.`);
        }
        const canonical = findDestinationOftReceived(await getLogs({
          address: destinationOftAddress as Address,
          event: OFT_RECEIVED_EVENT,
          args: {
            guid: sourceMessage.guid,
            toAddress: recipient as Address,
          },
          fromBlock: received.blockNumber,
          toBlock: received.blockNumber,
        }), {
          destinationOftAddress: destinationOftAddress as Address,
          guid: sourceMessage.guid,
          sourceEid: getEidByChainId(sourceChainId),
          recipient: recipient as Address,
          amountReceivedLD: sourceMessage.amountReceivedLD,
        });
        if (canonical.blockHash?.toLowerCase() !== received.blockHash.toLowerCase()
          || canonical.transactionHash?.toLowerCase() !== received.transactionHash.toLowerCase()) {
          throw new Error('The destination delivery changed while confirming. Checking again.');
        }
        if (!cancelled) {
          setDetectedDestinationTxHash(received.transactionHash ?? null);
          setVerifiedContextKey(verificationContextKey);
          setDestinationAmountProof({ context: verificationContextKey, amount: canonical.amountReceivedLD });
          setVerificationError(null);
          // Persist only a canonical, sufficiently confirmed observation. A
          // recovered record still goes through this full verification path.
          const bridge: PendingBridgeContext = {
            destinationChainId, sourceOftAddress: sourceOftAddress as Address,
            destinationOftAddress: destinationOftAddress as Address, recipient: recipient as Address,
            amountLD: amountLD.toString(), minAmountLD: minAmountLD.toString(),
            destinationBaselineBlock: destinationBaselineBlock.toString(),
            ...(token === 'fxUSD' || token === 'fxSAVE' ? { bridgeToken: token } : {}),
          };
          // Simulation receipts must never enter a live-wallet recovery journal.
          if (!simulated) updatePendingBridgeDeliveryProof({ walletAddress: sourceSender, chainId: sourceChainId, hash: sourceTxHash, bridge }, {
            guid: sourceMessage.guid, sourceTxHash: sourceTxHash as Hex,
            sourceAmountSentLD: sourceMessage.amountSentLD.toString(),
            sourceAmountReceivedLD: sourceMessage.amountReceivedLD.toString(),
            destinationTxHash: canonical.transactionHash!,
            destinationAmountReceivedLD: canonical.amountReceivedLD.toString(),
            destinationBlockNumber: canonical.blockNumber!.toString(),
            destinationBlockHash: canonical.blockHash!, verifiedAt: Date.now(),
          });
        }
        return;
      } catch (cause) {
        if (!cancelled) setVerificationError(userSafeError(cause, 'Destination delivery is not verified yet. Check again shortly.'));
      }
      if (sourceReceiptReverted) return;
      attempts += 1;
      if (!cancelled && attempts < maxAttempts && isForegroundOnline()) {
        retryTimerRef.current = window.setTimeout(() => { retryTimerRef.current = null; void verify(); }, pollMs);
      }
      else if (!cancelled) setCanRetry(true);
    };

    if (isForegroundOnline()) void verify();
    else setCanRetry(true);
    return () => {
      cancelled = true;
      if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [amountLD, autoStart, destinationBaselineBlock, destinationChain, destinationOftAddress, manualStarted, minAmountLD, recipient, retrySequence, sourceChain, sourceOftAddress, sourceSender, sourceStatusConfirmed, sourceTxHash, verificationContextKey, token, simulated]);

  // Never trust an externally supplied destination_verified flag without the
  // local GUID/event correlation above.
  const verified = sourceStatusConfirmed && hasVerificationContext && verifiedContextKey === verificationContextKey;
  const effectiveStatus: BridgeStepStatus = sourceReverted ? 'failed' : verified ? 'destination_verified' : status === 'destination_verified' ? 'source_confirmed' : status;
  const sourceDone = Boolean(sourceTxHash) && effectiveStatus !== 'pending' && effectiveStatus !== 'failed';
  const delivered = effectiveStatus === 'destination_verified';
  const failed = effectiveStatus === 'failed' || sourceReverted;
  const submitted = Boolean(sourceTxHash);
  const sourceExplorer = sourceTxHash ? `${explorerFor(sourceChain)}/tx/${sourceTxHash}` : null;
  const destinationExplorer = detectedDestinationTxHash ? `${explorerFor(destinationChain)}/tx/${detectedDestinationTxHash}` : null;
  const layerzeroScan = sourceTxHash ? `https://layerzeroscan.com/tx/${sourceTxHash}` : null;

  const retryAction = sourceDone && hasVerificationContext && !delivered && !failed && (canRetry || (!autoStart && !manualStarted)) ? (
    <button type="button" onClick={() => {
      haptic('light'); setVerificationError('Checking the destination chain again…');
      setCanRetry(false); setManualStarted(true); setRetrySequence(value => value + 1);
    }} className="button glass-press my-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-semibold text-mint">
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {manualStarted || canRetry ? 'Check destination again' : 'Check destination'}
    </button>
  ) : null;
  const deliveryHelp = !delivered && sourceDone && <div role="status">
    {canRetry && verificationError && <p className="text-[12px] text-mut">Delivery is still pending. Check the destination again or track your bridge.</p>}
    {!hasVerificationContext && <p className="text-[12px] text-mut">Delivery tracking is unavailable. Check your bridge before trying again.</p>}
    {!simulated && layerzeroScan && <a href={layerzeroScan} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-mint">Track bridge <ExternalLink size={13} aria-hidden="true" /></a>}
  </div>;
  if (compact) return <BridgeResultCard state={effectiveStatus} sourceChain={sourceChain} destinationChain={destinationChain}
    token={token} requestedAmount={amount}
    sourceAmount={sourceDone && sourceAmountProof?.context === verificationContextKey ? formatUnits(sourceAmountProof.amount, 18) : undefined}
    receivedAmount={delivered && destinationAmountProof?.context === verificationContextKey ? formatUnits(destinationAmountProof.amount, 18) : undefined}
    sourceTxHash={sourceTxHash} destinationTxHash={detectedDestinationTxHash} recipient={recipient}
    simulated={simulated} sourceReverted={sourceReverted}
    completionContent={delivered && detectedDestinationTxHash ? completionContent?.(detectedDestinationTxHash) : undefined} headingRef={headingRef} retryAction={<>{deliveryHelp}{retryAction}</>}
    />;
  return (
    <section data-compact-bridge={compact || undefined} aria-label="Bridge status" aria-live="polite" aria-atomic="false" className={`flex flex-col rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Network aria-hidden="true" className="h-4 w-4" /></span>
          <div>
            <h4 ref={headingRef} data-review-focus={headingRef ? true : undefined} tabIndex={headingRef ? -1 : undefined} className="text-[13px] font-semibold outline-none">{compact ? delivered ? 'Bridge complete' : failed ? 'Bridge needs attention' : sourceDone ? 'Source confirmed' : 'Bridge pending' : 'Bridge delivery'}</h4>
            <p className="text-[10px] text-mut">{!compact && amount ? <><ValueOrSkeleton value={amount} width="sm" label="Bridge amount loading" /> {token} · </> : null}{sourceChain} → {destinationChain}</p>
          </div>
        </div>
        {!compact && <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold ${delivered ? 'bg-[var(--success-dim)] text-success' : failed ? 'bg-[var(--danger-dim)] text-danger' : sourceDone ? 'bg-[var(--warn-dim)] text-warn' : 'bg-[var(--mint-dim)] text-mint'}`}>
          {delivered ? 'Destination received' : failed ? sourceReverted ? 'Source reverted' : 'Bridge interrupted' : sourceDone ? 'Source confirmed' : submitted ? 'Source pending' : 'Awaiting signature'}
        </span>}
      </div>
      {compact && <p className="mt-2 text-[12px] leading-relaxed text-mut">{delivered ? `Delivery verified on ${destinationChain}.` : failed ? 'Destination delivery is not verified. Check the details before trying again.' : sourceDone ? `Destination delivery on ${destinationChain} is not verified yet.` : 'Waiting for source confirmation.'}{simulated && ' Simulated receipts only.'}</p>}
      <div className="mt-4 flex flex-col gap-3">
        <TimelineRow
          state={failed ? 'failed' : submitted ? 'done' : 'active'}
          title={submitted ? 'Transaction submitted' : 'Awaiting signature'}
          body={failed ? submitted ? `Transaction hash saved on ${sourceChain}. Check the source explorer for its final status.` : 'No source transaction hash is available. Delivery has not been verified.' : submitted ? `Transaction hash saved on ${sourceChain}.` : 'Confirm the bridge transaction in your wallet.'}
          action={sourceExplorer ? { label: 'Explorer', onClick: () => { openExternalLink(sourceExplorer); } } : undefined}
        />
        <TimelineRow
          state={failed ? 'failed' : sourceDone ? 'done' : submitted ? 'active' : 'pending'}
          title="Source confirmed"
          body={failed ? sourceReverted ? 'The source receipt shows a revert.' : 'Source confirmation is unavailable. Check the transaction before trying another bridge.' : sourceDone ? sourceEventFound ? 'Source receipt confirmed; bridge message found.' : 'Source receipt confirmed. Checking the bridge message.' : submitted ? 'Waiting for the source-chain receipt.' : 'Starts after submission.'}
        />
        <TimelineRow
          state={delivered ? 'done' : sourceDone && !failed && hasVerificationContext && !canRetry && (autoStart || manualStarted) ? 'active' : 'pending'}
          title="Destination verification"
          body={delivered ? `Delivery was verified on ${destinationChain}.` : failed ? 'Destination delivery has not been verified.' : sourceDone ? !hasVerificationContext ? 'Recovery details are missing. Destination delivery cannot be checked.' : canRetry ? 'Automatic checking has paused. Check the destination again to resume.' : !autoStart && !manualStarted ? 'Start a destination check to verify delivery.' : `Checking ${destinationChain} for the matching delivery. No ETA is available.` : 'Starts after source confirmation.'}
          action={layerzeroScan ? { label: 'Track', onClick: () => { openExternalLink(layerzeroScan); } } : undefined}
        />
        <TimelineRow
          state={delivered ? 'done' : 'pending'}
          title="Destination received"
          body={delivered ? <>The matching {token} delivery was verified at the recipient on {destinationChain}.</> : 'Not verified on the destination yet.'}
          action={destinationExplorer ? { label: 'Explorer', onClick: () => { openExternalLink(destinationExplorer); } } : undefined}
        />
      </div>
      {deliveryHelp}
      {sourceDone && hasVerificationContext && !delivered && !failed && (canRetry || (!autoStart && !manualStarted)) && (
        <button
          type="button"
          onClick={() => {
            haptic('light');
            setVerificationError('Checking the destination chain again…');
            setCanRetry(false);
            setManualStarted(true);
            setRetrySequence((value) => value + 1);
          }}
          className="button glass-press mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-semibold text-mint"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {manualStarted || canRetry ? 'Check destination again' : 'Check destination'}
        </button>
      )}
    </section>
  );
}

function TimelineRow({
  state,
  title,
  body,
  action,
}: {
  state: 'done' | 'active' | 'pending' | 'failed';
  title: string;
  body: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const simulated = useTransactionEvidence() === 'simulation';
  const icon = state === 'done'
    ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
    : state === 'failed'
      ? <XCircle className="h-4 w-4" aria-hidden="true" />
      : state === 'active'
        ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        : <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />;
  const tone = state === 'done' ? 'bg-[var(--success-dim)] text-success' : state === 'failed' ? 'bg-[var(--danger-dim)] text-danger' : state === 'active' ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.05)] text-mut';
  return (
    <div className="flex items-start gap-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold">{title}</span>
          {action && (simulated ? <span className="text-[10px] text-mut">No on-chain link</span> : <button type="button" onClick={action.onClick} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[10px] text-mint hover:bg-[var(--mint-dim)] hover:underline">{action.label} <ExternalLink aria-hidden="true" className="h-3 w-3" /></button>)}
        </div>
        <p className="text-[10.5px] leading-relaxed text-mut">{body}</p>
      </div>
    </div>
  );
}
