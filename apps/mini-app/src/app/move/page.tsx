'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, ChevronDown, Code2, UserRound } from 'lucide-react';
import { formatUnits, isAddress, type Address } from 'viem';
import { amountBlocker } from '@/lib/formBlockers';
import { TransactionSettings } from '@/components/TransactionSettings';
import { MoveSections } from '@/components/ProductSections';
import { AppShell, Card } from '@/components/ui';
import { PageHeading } from '@/components/ProductUI';
import { ActionWorkspace } from '@/components/ProductLayout';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { AmountField, TokenSelect, type TokenBalanceView } from '@/components/ProtocolForm';
import { useMoveBalances } from '@/components/WalletDataProvider';
import {
  asFxSdkRpcTransport,
  assertAddress,
  assertBridgeActionTarget,
  advancedBridgePolicy,
  assertChecksummedAddress,
  assertPublicClientChain,
  bridgeDeliveryLowerBound,
  getBridgeApprovalAllowance,
  getFxReadFacade,
  withReadDeadline,
  getPublicClient,
  planBridgeRoute,
  resolveBridgeApprovalTokenAddress,
  resolveBridgeTokenAddress,
  requireRpcUrl,
  restoreSignatureRequiredDraftFromSearch,
  validateAdvancedBridgeContracts,
  type FxChainId,
} from '@/lib/fx';
import { configuredRpcUrls } from '@/lib/fx/config';
import { getRpcTransport } from '@/lib/fx/clients';
import { usePrivyWallet } from '@/lib/wallet';
import { parseAmount } from '@/app/trade/fxUi';
import { resetTransactionAmounts } from '@/lib/transactionState';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
import styles from '@/components/FlowWorkspace.module.css';
import moveStyles from './Move.module.css';

const ERC20_BALANCE_ABI = [{
  type: 'function',
  name: 'balanceOf',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;
const ERC20_DECIMALS_ABI = [{
  type: 'function',
  name: 'decimals',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'uint8' }],
}] as const;
const OFT_TOKEN_ABI = [{
  type: 'function',
  name: 'token',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const;

type Direction = 'ethereum_to_base' | 'base_to_ethereum';
type BridgeAsset = 'fxUSD' | 'fxSAVE';
// Kept in draft compatibility so old signature-required links remain safe;
// the user-facing bridge starts with canonical routes and exposes Advanced OFT
// only after the explicit expert disclosure is opened.
type BridgeMode = 'canonical' | 'advanced';

const MOVE_DRAFT_ACTION_KEYS = {
  ethereum_to_base: {
    canonical: { fxUSD: 'move:ethereum_to_base:canonical:fxUSD', fxSAVE: 'move:ethereum_to_base:canonical:fxSAVE' },
    advanced: { fxUSD: 'move:ethereum_to_base:advanced:fxUSD', fxSAVE: 'move:ethereum_to_base:advanced:fxSAVE' },
  },
  base_to_ethereum: {
    canonical: { fxUSD: 'move:base_to_ethereum:canonical:fxUSD', fxSAVE: 'move:base_to_ethereum:canonical:fxSAVE' },
    advanced: { fxUSD: 'move:base_to_ethereum:advanced:fxUSD', fxSAVE: 'move:base_to_ethereum:advanced:fxSAVE' },
  },
} as const;

type MoveDraftState = {
  direction: Direction;
  mode: BridgeMode;
  token: BridgeAsset;
  amount: string;
  sourceOft: string;
  destinationOft: string;
  approvalToken: string;
  recipientInput: string;
  customRecipient: boolean;
};

const MOVE_DRAFT_CANDIDATES: readonly MoveDraftState[] = (Object.keys(MOVE_DRAFT_ACTION_KEYS) as Direction[]).flatMap((direction) => (
  (Object.keys(MOVE_DRAFT_ACTION_KEYS[direction]) as BridgeMode[]).flatMap((mode) => (
    (Object.keys(MOVE_DRAFT_ACTION_KEYS[direction][mode]) as BridgeAsset[]).map((token) => ({
      direction,
      mode,
      token,
      amount: '',
      sourceOft: '',
      destinationOft: '',
      approvalToken: '',
      recipientInput: '',
      customRecipient: false,
    }))
  ))
));

function moveDraftActionKey(direction: Direction, mode: BridgeMode, token: BridgeAsset): string {
  return MOVE_DRAFT_ACTION_KEYS[direction][mode][token];
}

function draftString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length <= 512 ? value : fallback;
}

function draftEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fallback;
}

function draftBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export default function MovePage() {
  const wallet = usePrivyWallet();
  const [direction, setDirection] = useState<Direction>('ethereum_to_base');
  const [mode, setMode] = useState<BridgeMode>('canonical');
  const [token, setToken] = useState<BridgeAsset>('fxUSD');
  const [amount, setAmount] = useState('');
  const [sourceOft, setSourceOft] = useState('');
  const [destinationOft, setDestinationOft] = useState('');
  const [approvalToken, setApprovalToken] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [customRecipient, setCustomRecipient] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const [advancedBalance, setAdvancedBalance] = useState<TokenBalanceView | undefined>(undefined);
  const previousWalletContextRef = useRef<string | null>(null);
  // A review-rail connection is part of the current move action. Do not
  // clear its amount/recipient while the first wallet is hydrating; changes
  // after a wallet is selected still invalidate the wallet-scoped form.
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const reviewedBridgeRef = useRef<{
    sourceChainId: FxChainId;
    destinationChainId: FxChainId;
    sourceTokenAddress: `0x${string}`;
    destinationTokenAddress: `0x${string}`;
    approvalTokenAddress?: `0x${string}`;
    spender: `0x${string}`;
    recipient: `0x${string}`;
  } | null>(null);

  const sourceChainId: FxChainId = direction === 'ethereum_to_base' ? 1 : 8453;
  const destinationChainId: FxChainId = direction === 'ethereum_to_base' ? 8453 : 1;
  const sourceName = sourceChainId === 1 ? 'Ethereum' : 'Base';
  const destinationName = destinationChainId === 1 ? 'Ethereum' : 'Base';
  // Canonical and advanced OFTs share the SDK's 18-decimal amount model. The
  // token key is only used for the canonical picker and display formatting.
  const amountWei = parseAmount(amount, 'fxUSD');
  const advanced = mode === 'advanced';
  const recipientValue = customRecipient ? recipientInput.trim() : wallet.address || '';
  const draftState = useMemo(() => ({
    direction,
    mode,
    token,
    amount,
    sourceOft,
    destinationOft,
    approvalToken,
    recipientInput,
    customRecipient,
  }), [amount, approvalToken, customRecipient, destinationOft, direction, mode, recipientInput, sourceOft, token]);
  const draftActionKey = moveDraftActionKey(direction, mode, token);
  const draftRestoreRef = useRef<string | null>(null);
  const contextAppliedRef = useRef(false);

  // History stores only a primitive form snapshot. Try every supported bridge
  // scope and accept a draft only after the wallet, chain, operation, and
  // stable caller-known action key all match. The route is still rebuilt and
  // simulated by ActionReview; no executable route data is restored.
  useEffect(() => {
    if (reviewStage === 'executing' || reviewStage === 'result') return;
    if (!wallet.ready || !wallet.authenticated || !wallet.address || typeof window === 'undefined') return;
    const search = window.location.search;
    if (draftRestoreRef.current === search) return;
    draftRestoreRef.current = search;
    for (const candidate of MOVE_DRAFT_CANDIDATES) {
      const candidateChainId: FxChainId = candidate.direction === 'ethereum_to_base' ? 1 : 8453;
      const restored = restoreSignatureRequiredDraftFromSearch(search, {
        walletAddress: wallet.address as Address,
        chainId: candidateChainId,
        operation: 'buildBridgeTx',
        actionKey: moveDraftActionKey(candidate.direction, candidate.mode, candidate.token),
      });
      if (!restored) continue;
      const state = restored.formState;
      const restoredDirection = draftEnum(state.direction, ['ethereum_to_base', 'base_to_ethereum'] as const, candidate.direction);
      const restoredMode = draftEnum(state.mode, ['canonical', 'advanced'] as const, candidate.mode);
      const restoredToken = draftEnum(state.token, ['fxUSD', 'fxSAVE'] as const, candidate.token);
      // A tampered form snapshot must never silently change the action scope
      // represented by its stable draft key. Older drafts may omit these
      // fields, so only an explicitly conflicting value rejects the draft.
      if ((state.direction !== undefined && restoredDirection !== candidate.direction)
        || (state.mode !== undefined && restoredMode !== candidate.mode)
        || (state.token !== undefined && restoredToken !== candidate.token)) continue;
      setDirection(candidate.direction);
      setMode(restoredMode);
      setToken(candidate.token);
      setAmount(draftString(state.amount));
      setSourceOft(draftString(state.sourceOft));
      setDestinationOft(draftString(state.destinationOft));
      setApprovalToken(draftString(state.approvalToken));
      setRecipientInput(draftString(state.recipientInput));
      setCustomRecipient(draftBoolean(state.customRecipient));
      setReviewStage('input');
      setReviewRevision((revision) => revision + 1);
      setResumeReview((revision) => revision + 1);
      break;
    }
  }, [reviewStage, wallet.address, wallet.authenticated, wallet.ready]);

  useEffect(() => {
    if (contextAppliedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('fxDraft')) return;
    const nextToken = params.get('token');
    if (nextToken === 'fxUSD' || nextToken === 'fxSAVE') setToken(nextToken);
    contextAppliedRef.current = true;
  }, []);

  const resetBridgeContext = useCallback((nextToken: BridgeAsset = token) => {
    const defaults = resetTransactionAmounts();
    setToken(nextToken);
    setAmount(defaults.amount);
    setSourceOft('');
    setDestinationOft('');
    setApprovalToken('');
    setRecipientInput('');
    setCustomRecipient(false);
    setReviewStage('input');
    reviewedBridgeRef.current = null;
    setReviewRevision((revision) => revision + 1);
  }, [token]);

  const changeDirection = useCallback(() => {
    setDirection((current) => current === 'ethereum_to_base' ? 'base_to_ethereum' : 'ethereum_to_base');
    resetBridgeContext();
  }, [resetBridgeContext]);

  const changeToken = useCallback((nextToken: BridgeAsset) => {
    resetBridgeContext(nextToken);
  }, [resetBridgeContext]);

  const changeMode = useCallback((nextMode: BridgeMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetBridgeContext();
  }, [mode, resetBridgeContext]);

  const changeRecipientMode = useCallback(() => {
    const next = !customRecipient;
    setCustomRecipient(next);
    setRecipientInput(next && wallet.address ? wallet.address : '');
    reviewedBridgeRef.current = null;
    setReviewRevision((revision) => revision + 1);
  }, [customRecipient, wallet.address]);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    if (previous !== null && previous !== context && (walletChanged || chainChanged)) {
      // A network switch can be part of the bridge execution itself. Retain
      // its progress/result, then reset the form when Edit returns to input.
      if (reviewStage === 'executing' || reviewStage === 'result') return;
      resetBridgeContext();
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetBridgeContext, reviewStage, wallet.address, wallet.chainId]);

  const balanceQuery = useMoveBalances({ address: wallet.address, chainId: sourceChainId, enabled: !advanced });
  const moveBalances = !advanced ? balanceQuery.data?.balances : undefined;
  const moveBalanceStatusForPicker = !advanced && wallet.address
    ? (balanceQuery.status === 'idle' ? 'loading' : balanceQuery.status)
    : undefined;
  const moveBalanceState = advanced ? advancedBalance : moveBalances?.[token]
    ?? (moveBalanceStatusForPicker ? { status: moveBalanceStatusForPicker } : undefined);

  // Custom OFTs do not have a canonical asset identity for the shared wallet
  // cache. Read the validated source OFT's underlying token directly, scoped
  // to this wallet and source chain, and keep stale responses from replacing
  // a newer address/session.
  const advancedBalanceRevision = useRef(0);
  useEffect(() => {
    const revision = advancedBalanceRevision.current + 1;
    advancedBalanceRevision.current = revision;
    if (!advanced || !wallet.address || !sourceOft.trim()) {
      setAdvancedBalance(undefined);
      return;
    }
    let reviewedOft: Address;
    try {
      reviewedOft = assertChecksummedAddress(sourceOft, 'source OFT');
    } catch (cause) {
      setAdvancedBalance({ status: 'unavailable', reason: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    setAdvancedBalance({ status: 'loading', reason: 'Reading the source OFT balance.' });
    void (async () => {
      try {
        const client = getPublicClient(sourceChainId);
        await assertPublicClientChain(client, sourceChainId);
        const localToken = assertAddress(String(await client.readContract({ address: reviewedOft, abi: OFT_TOKEN_ABI, functionName: 'token' })), 'source OFT underlying token');
        const decimals = await client.readContract({ address: localToken, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' });
        if (Number(decimals) !== 18) throw new Error('source OFT underlying token must expose exactly 18 decimals');
        const balance = await client.readContract({ address: localToken, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [wallet.address as Address] });
        if (typeof balance !== 'bigint' || balance < 0n) throw new Error('source OFT underlying balance returned malformed data');
        if (advancedBalanceRevision.current !== revision) return;
        setAdvancedBalance({ status: 'ready', amount: formatUnits(balance, 18) });
      } catch (cause) {
        if (advancedBalanceRevision.current !== revision) return;
        setAdvancedBalance({ status: 'unavailable', reason: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
  }, [advanced, sourceChainId, sourceOft, wallet.address]);

  // The action names the missing piece: an empty source balance, the amount, or a recipient.
  const reviewBlocker = !wallet.address ? null
    : amountBlocker(amount, 18, advanced ? 'tokens' : token, moveBalanceState, { emptyLabel: advanced ? undefined : `No ${token} on ${sourceName}` })
      ?? (customRecipient && !recipientInput.trim() ? `Enter a recipient on ${destinationName}` : null)
      ?? (customRecipient && !isAddress(recipientInput.trim()) ? 'Enter a valid address' : null);

  const planBuilder = useMemo(() => {
    if (!wallet.address || !amountWei) return null;
    return async () => {
      const signer = assertAddress(wallet.address!, 'selected wallet');
      const recipient = assertAddress(recipientValue, 'bridge recipient');
      const lowerBound = bridgeDeliveryLowerBound(amountWei);
      await withReadDeadline(Promise.all([
        assertPublicClientChain(getPublicClient(sourceChainId), sourceChainId),
        assertPublicClientChain(getPublicClient(destinationChainId), destinationChainId),
      ]));
      const sdk = getFxReadFacade();
      let sourceToken: string = token;
      let sourceOftAddress: `0x${string}`;
      let sourceTokenAddress: `0x${string}`;
      let destinationOftAddress: `0x${string}`;
      let destinationTokenAddress: `0x${string}`;
      let approvalTokenAddress: `0x${string}` | undefined;
      let sourceApprovalRequired = sourceChainId === 1;
      let destinationApprovalRequired = false;
      let customPolicy: ReturnType<typeof advancedBridgePolicy> | undefined;

      if (advanced) {
        // Advanced inputs stay explicit and checksummed all the way through
        // review. They are never normalized into an arbitrary executable
        // route; metadata, peers, quoteSend, and the final send target are
        // checked before ActionReview can open a wallet prompt.
        const reviewedSourceOft = assertChecksummedAddress(sourceOft, 'source OFT');
        const reviewedDestinationOft = assertChecksummedAddress(destinationOft, 'destination OFT');
        const reviewedApprovalToken = approvalToken.trim()
          ? assertChecksummedAddress(approvalToken, 'Ethereum underlying approval token')
          : undefined;
        const metadata = await validateAdvancedBridgeContracts({
          sourceClient: getPublicClient(sourceChainId),
          destinationClient: getPublicClient(destinationChainId),
          sourceOftAddress: reviewedSourceOft,
          destinationOftAddress: reviewedDestinationOft,
          ethereumApprovalTokenAddress: reviewedApprovalToken,
          sourceChainId,
          destinationChainId,
        });
        sourceToken = reviewedSourceOft;
        sourceOftAddress = reviewedSourceOft;
        destinationOftAddress = reviewedDestinationOft;
        sourceTokenAddress = metadata.sourceTokenAddress;
        destinationTokenAddress = metadata.destinationTokenAddress;
        sourceApprovalRequired = metadata.sourceApprovalRequired;
        destinationApprovalRequired = metadata.destinationApprovalRequired;
        approvalTokenAddress = metadata.sourceApprovalRequired ? reviewedApprovalToken : undefined;
        customPolicy = advancedBridgePolicy({
          walletAddress: signer,
          chainId: sourceChainId,
          sourceOftAddress: reviewedSourceOft,
          ethereumApprovalTokenAddress: approvalTokenAddress,
          approvalRequired: metadata.sourceApprovalRequired,
        });
      } else {
        sourceOftAddress = resolveBridgeTokenAddress(token, sourceChainId);
        sourceTokenAddress = sourceChainId === 1 ? resolveBridgeApprovalTokenAddress(token, sourceChainId) : sourceOftAddress;
        destinationOftAddress = resolveBridgeTokenAddress(token, destinationChainId);
        destinationTokenAddress = destinationChainId === 1
          ? resolveBridgeApprovalTokenAddress(token, destinationChainId)
          : destinationOftAddress;
        approvalTokenAddress = sourceChainId === 1 ? resolveBridgeApprovalTokenAddress(token, sourceChainId) : undefined;
      }

      const sourceRpcUrls = configuredRpcUrls(sourceChainId);
      // Capture the destination baseline before any source route can reach a
      // wallet prompt. The baseline and quote probes are read-only and
      // independent, so observe them together without changing their safety
      // boundary. Advanced mode also observes the reverse quote concurrently.
      const destinationRpcUrls = configuredRpcUrls(destinationChainId);
      const [destinationBaselineBlock, quote] = await Promise.all([
        getPublicClient(destinationChainId).getBlockNumber(),
        sdk.getBridgeQuote({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, sourceRpcUrl: sourceRpcUrls[0], sourceRpcTransport: asFxSdkRpcTransport(getRpcTransport(sourceRpcUrls, sourceChainId)) }),
        advanced
          ? sdk.getBridgeQuote({ sourceChainId: destinationChainId, destChainId: sourceChainId, token: destinationOftAddress, amount: amountWei, recipient, sourceRpcUrl: destinationRpcUrls[0], sourceRpcTransport: asFxSdkRpcTransport(getRpcTransport(destinationRpcUrls, destinationChainId)) })
          : Promise.resolve(undefined),
      ]);
      // Build once without an approval so the exact SDK bridge destination is
      // known, then read the allowance for that exact spender. The final route
      // adds one exact approval only when it is still needed.
      const unapproved = await planBridgeRoute({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, refundAddress: signer, walletAddress: signer, sourceRpcUrl: requireRpcUrl(sourceChainId), includeApproval: false, destinationOftAddress, destinationBaselineBlock });
      const reviewedSourceOft = assertBridgeActionTarget(unapproved, sourceOftAddress);
      const approvalAllowance = sourceChainId === 1 && sourceApprovalRequired
        ? await getBridgeApprovalAllowance({ client: getPublicClient(sourceChainId), tokenAddress: approvalTokenAddress!, owner: signer, spender: reviewedSourceOft.to })
        : undefined;
      const route = await planBridgeRoute({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, refundAddress: signer, walletAddress: signer, sourceRpcUrl: requireRpcUrl(sourceChainId), includeApproval: advanced ? sourceApprovalRequired : true, approvalAllowance, approvalTokenAddress, destinationOftAddress, destinationBaselineBlock });
      assertBridgeActionTarget(route, reviewedSourceOft.to);
      reviewedBridgeRef.current = {
        sourceChainId,
        destinationChainId,
        sourceTokenAddress,
        destinationTokenAddress,
        approvalTokenAddress,
        spender: reviewedSourceOft.to,
        recipient,
      };
      return {
        ...route,
        policy: customPolicy ? { ...customPolicy, maxValueWei: (route.quote as { nativeFee: bigint }).nativeFee } : route.policy,
        quote: {
          ...(route.quote as { nativeFee: bigint; lzTokenFee: bigint }),
          requestedQuote: quote,
          bridgeToken: advanced ? 'Advanced OFT' : token,
          bridgeAmount: amountWei,
          deliveryLowerBound: lowerBound,
          sourceOftAddress: reviewedSourceOft.to,
          destinationOftAddress,
          sourceTokenAddress,
          sourceApprovalRequired,
          destinationApprovalRequired,
          approvalTokenAddress,
          destinationTokenAddress,
          destinationBaselineBlock,
          recipient,
        },
      };
    };
  }, [advanced, amountWei, approvalToken, destinationChainId, destinationOft, recipientValue, sourceChainId, sourceOft, token, wallet.address]);

  const rereadBridgeState = useCallback(async () => {
    const reviewed = reviewedBridgeRef.current;
    if (!reviewed || !wallet.address) return;
    const sourceClient = getPublicClient(reviewed.sourceChainId);
    const destinationClient = getPublicClient(reviewed.destinationChainId);
    const sourceBalanceAddress = reviewed.approvalTokenAddress ?? reviewed.sourceTokenAddress;
    const reads: Promise<unknown>[] = [
      sourceClient.readContract({ address: sourceBalanceAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [wallet.address as `0x${string}`] }),
      destinationClient.readContract({ address: reviewed.destinationTokenAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [reviewed.recipient] }),
    ];
    if (reviewed.approvalTokenAddress) {
      reads.push(getBridgeApprovalAllowance({ client: sourceClient, tokenAddress: reviewed.approvalTokenAddress, owner: wallet.address as `0x${string}`, spender: reviewed.spender }));
    }
    await Promise.all(reads);
  }, [wallet.address]);

  return (
    <AppShell>
      <ActionWorkspace density="compact" className={`${styles.workspace} ${styles.moveWorkspace} ${moveStyles.moveWorkspace}`}>
        <PageHeading title="Move" />
        <div className={moveStyles.centerStage}>
        <Card
          data-flow-stage={reviewStage}
          className={`${styles.focusCard} ${styles.moveCard} ${moveStyles.moveCard} p-5`}
        >
          <ActionReview
            key={reviewRevision}
            surface="content"
            editor={<>
          <div className={moveStyles.cardHead}><span>Bridge</span><TransactionSettings /></div>
          <div className={`${styles.moveFormFields} ${moveStyles.moveFormFields}`}>
            <div className={moveStyles.sourcePanel}>
            <NetworkField label="From" name={sourceName} chainId={sourceChainId} />
              <AmountField label="Amount" symbol={advanced ? 'OFT' : token} value={amount} onChange={setAmount}
                maxDecimals={18} balanceState={moveBalanceState} showUnitPrice={false}
                tokenSelector={!advanced ? <TokenSelect compact label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={changeToken} balances={moveBalances} balanceStatus={wallet.address ? moveBalanceStatusForPicker : 'disconnected'} /> : undefined} />
            </div>
            <button
              type="button"
              aria-label={`Reverse route to ${sourceName}`}
              onClick={changeDirection}
              data-direction={sourceChainId === 1 ? 'forward' : 'reverse'}
              className={`glass-press ${styles.networkArrow} ${moveStyles.routeSwap}`}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className={moveStyles.destinationPanel}>
            <NetworkField label="To" name={destinationName} chainId={destinationChainId} />
              <div className={moveStyles.receiveAsset}>
                {!advanced && <TokenIcon symbol={token} size={28} />}
                <strong>{advanced ? 'Custom token' : token}</strong>
              </div>
            </div>

            <div className={moveStyles.recipientSection}>
              <div className={moveStyles.recipientHeading}>
                <span className="text-[13px] text-mut">Recipient</span>
                <button
                  type="button"
                  onClick={changeRecipientMode}
                  className="min-h-11 rounded-lg px-2 text-[12px] font-medium text-mint transition-colors hover:bg-[var(--mint-dim)]"
                >
                  {customRecipient ? 'Use connected wallet' : 'Use another wallet'}
                </button>
              </div>
              {customRecipient ? (
                <AddressField
                  label="Destination wallet"
                  value={recipientInput}
                  onChange={setRecipientInput}
                  placeholder="0x… destination wallet"
                />
              ) : (
                <div className={moveStyles.recipientWallet}>
                  <span className={moveStyles.recipientMark}><UserRound className="h-4 w-4" aria-hidden="true" /></span>
                  {/* A status, not a control: the form's own action connects a wallet. */}
                  <span className={`${moveStyles.recipientLabel} mr-auto text-[13px] font-medium text-[var(--text)]`}>Your wallet</span>
                  {wallet.address ? (
                    <span className={`${moveStyles.recipientAddress} font-mono text-[12px] text-mut`}>
                      {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}
                    </span>
                  ) : <span className={`${moveStyles.recipientAddress} text-[12px] text-mut`}>Not connected</span>}
                </div>
              )}
            </div>

            <details
              open={advanced}
              onToggle={(event) => changeMode(event.currentTarget.open ? 'advanced' : 'canonical')}
              className={`${styles.advancedPanel} ${moveStyles.expertDisclosure}`}
            >
              <summary className={`${moveStyles.expertSummary} group flex cursor-pointer list-none items-center justify-between gap-3 px-3 text-[12px] font-semibold text-mut [&::-webkit-details-marker]:hidden`}>
                {/* Named as the expert path it is (the questions below call it expert mode): fxUSD and fxSAVE never need it. */}
                <span className="flex min-w-0 items-center gap-2"><Code2 aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--mut-2)]" /><span className="min-w-0">Expert mode<span className="font-medium text-[var(--mut-2)]"> · custom contracts</span></span></span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--mut-2)] disclosure-chevron" />
              </summary>
              <div className="border-t border-[var(--line)] p-3">
                <AdvancedAddressFields
                  sourceName={sourceName}
                  destinationName={destinationName}
                  sourceChainId={sourceChainId}
                  sourceOft={sourceOft}
                  destinationOft={destinationOft}
                  approvalToken={approvalToken}
                  onSourceOftChange={setSourceOft}
                  onDestinationOftChange={setDestinationOft}
                  onApprovalTokenChange={setApprovalToken}
                />
                <AdvancedRiskSummary />
              </div>
            </details>

          </div>
            </>}
            planBuilder={planBuilder}
            blocker={reviewBlocker}
            label={`Send ${advanced ? 'custom token' : token} to ${destinationName}`}
            operationLabel={`Send ${advanced ? 'custom token' : token} to ${destinationName}`}
            draftActionKey={draftActionKey}
            draftState={draftState}
            resumeReview={resumeReview}
            onStageChange={setReviewStage}
            onComplete={async () => {
              try {
                await rereadBridgeState();
              } finally {
                if (!advanced) await balanceQuery.refresh();
              }
            }}
          />
        </Card>
        </div>
        {reviewStage === 'input' && <MoveSections />}
      </ActionWorkspace>
    </AppShell>
  );
}

function AdvancedAddressFields({
  sourceName,
  destinationName,
  sourceChainId,
  sourceOft,
  destinationOft,
  approvalToken,
  onSourceOftChange,
  onDestinationOftChange,
  onApprovalTokenChange,
}: {
  sourceName: string;
  destinationName: string;
  sourceChainId: FxChainId;
  sourceOft: string;
  destinationOft: string;
  approvalToken: string;
  onSourceOftChange: (value: string) => void;
  onDestinationOftChange: (value: string) => void;
  onApprovalTokenChange: (value: string) => void;
}) {
  return (
    <div className={styles.advancedAddressGrid}>
      <AddressField label={`${sourceName} OFT`} value={sourceOft} onChange={onSourceOftChange} placeholder="0x… contract address" />
      <AddressField label={`${destinationName} OFT`} value={destinationOft} onChange={onDestinationOftChange} placeholder="0x… contract address" />
      {sourceChainId === 1 && (
        <AddressField
          label="Ethereum approval token"
          hint="Only for adapter routes"
          value={approvalToken}
          onChange={onApprovalTokenChange}
          placeholder="0x… token address"
        />
      )}
    </div>
  );
}

function AdvancedRiskSummary() {
  return (
    <div className={`${moveStyles.expertRisk} mt-3 rounded-xl border border-[rgba(255,194,102,.28)] bg-[var(--warn-dim)] p-3 text-[11.5px] leading-relaxed text-warn`}>
      <div className="flex gap-2.5">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Custom contracts are checked live before signing. Both networks must have deployed 18-decimal metadata, matching cross-chain peers, quote support, and the exact send target.</p>
      </div>
      <details className="mt-2 border-t border-[rgba(255,194,102,.18)] pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-[11px] font-semibold">What gets checked<ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 disclosure-chevron" /></summary>
        <ul className="space-y-1 pb-1 pl-4 text-mut">
          <li>Checksummed, deployed contracts with 18-decimal token metadata</li>
          <li>Matching, non-zero cross-chain peers in both directions</li>
          <li>Exact send target and approval token when required</li>
          <li>Source confirmation and destination delivery remain separate</li>
        </ul>
      </details>
    </div>
  );
}

function AddressField({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-[12px] font-medium text-mut">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-[var(--mut-2)]">{hint}</span>}
      </span>
      {/* Phones must not capitalise or correct a hex address while it is typed or pasted. */}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" className="min-h-[56px] w-full rounded-2xl border border-[var(--line)] bg-[var(--input)] px-3 font-mono text-[16px] outline-none focus:border-mint" />
    </label>
  );
}

function NetworkField({ label, name, chainId }: { label: 'From' | 'To'; name: string; chainId: FxChainId }) {
  return (
    <div className={`${styles.networkNode} ${moveStyles.routeNode}`}>
      <span className="block text-[12px] font-medium text-mut">{label}</span>
      <span className={`${moveStyles.routeIdentity} mt-1.5 flex items-center text-[15px] font-semibold`}><ChainIcon chainId={chainId} size={26} className={moveStyles.chainLogo} /><span className={moveStyles.routeName}>{name}</span></span>
    </div>
  );
}
