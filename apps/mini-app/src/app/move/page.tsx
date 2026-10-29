'use client';

import { useNavigationInputs } from '@/lib/useNavigationInputs';

import { MetricLabel, InfoHelp } from '@/components/InfoHelp';
import { reviewHelpDefinition } from '@/components/review/reviewHelp';
import { AmountCounterpart, FeeUsd, InlineAmount, useAmountInUnit } from '@/components/review/AmountUsd';
import { ReviewFactValue } from '@/components/review/ReviewFactValue';
import { readableReviewAmount } from '@/components/review/reviewHierarchy';
import { groupDigits } from '@/lib/amount';
import { isReviewInputStage } from '@/components/review/actionReviewTypes';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, ArrowLeftRight, Code2, UserRound } from 'lucide-react';
import { formatUnits, isAddress, type Address } from 'viem';
import { amountBlocker } from '@/lib/formBlockers';
import { TransactionSettings } from '@/components/TransactionSettings';
import { MoveSections } from '@/components/ProductSections';
import { AppShell, Card } from '@/components/ui';
import { PageHeading } from '@/components/ProductUI';
import { MissingValue } from '@/components/MissingValue';
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
import { BRIDGE_PREVIEW_TTL, fetchBridgePreview, fetchCanonicalBridgeEstimate, isFreshBridgePreview, readBridgeReceiptEstimate, type BridgePreview } from '@/lib/fx/bridgePreview';
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

/** The estimate in the reader's unit; its size follows whichever figure is shown. */
function ReceiveFigure({ amount, display, token }: { amount: string; display: string; token: string }) {
  const value = useAmountInUnit(amount, token);
  const shown = value.showUsd && value.usdText ? value.usdText : display;
  return <strong className={moveStyles.receiveAmount} data-receive-amount data-amount-unit={value.showUsd ? 'usd' : undefined} style={{ '--receive-length': shown.length } as CSSProperties}>{shown}</strong>;
}

function ReceiveAmountPlaceholder({ amount, loading }: { amount: string; loading: boolean }) {
  const empty = amount.trim() === '' || /^(?:0+(?:\.0*)?|\.0+)$/.test(amount.trim());
  return <strong className={moveStyles.receiveAmount} data-empty="true">
    {empty ? '0.00' : <MissingValue width="lg" status={loading ? 'loading' : 'unavailable'} label={loading ? 'Loading receive amount' : 'Receive amount unavailable'} />}
  </strong>;
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
  const [previewState, setPreviewState] = useState<{ key: string; status: 'loading' | 'ready' | 'unavailable' | 'expired'; data?: BridgePreview }>();
  const [previewRevision, setPreviewRevision] = useState(0);
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
  const recipientError = customRecipient && recipientInput.trim()
    ? (!isAddress(recipientInput.trim()) || /^0x0{40}$/i.test(recipientInput.trim()) ? 'Enter a valid, non-zero destination address.' : undefined)
    : undefined;
  const previewRecipientKey = customRecipient ? recipientInput.trim().toLowerCase() : wallet.address?.toLowerCase() ?? 'disconnected-default';
  const previewKey = `${wallet.address?.toLowerCase() ?? 'disconnected'}:${sourceChainId}:${destinationChainId}:${token}:${amountWei}:${previewRecipientKey}:${advanced}:${previewRevision}`;
  const preview = previewState?.key === previewKey && previewState.status === 'ready' && isFreshBridgePreview(previewState.data) ? previewState.data : undefined;
  const previewStatus = previewState?.key === previewKey ? previewState.status : undefined;
  const recipientCanEstimate = customRecipient
    ? Boolean(recipientInput.trim() && !recipientError)
    : !wallet.address || (isAddress(wallet.address) && !/^0x0{40}$/i.test(wallet.address));
  const quotePending = Boolean(amountWei && !advanced && recipientCanEstimate && (previewStatus === undefined || previewStatus === 'loading'));
  const receiveFigure = preview?.estimatedReceived !== undefined
    ? readableReviewAmount(formatUnits(preview.estimatedReceived, 18)) : undefined;
  const receiveDisplay = receiveFigure
    ? `${receiveFigure.shortened ? '≈ ' : ''}${groupDigits(receiveFigure.value)}` : '';
  const nativeShortfall = preview?.nativeBalance !== undefined && preview.nativeBalance < preview.nativeFee + (preview.sourceGas ?? 0n);
  useEffect(() => {
    if (advanced || !amountWei || reviewStage !== 'input') return;
    const estimateRecipient = customRecipient ? recipientInput.trim() : wallet.address;
    if (customRecipient && (!estimateRecipient || !isAddress(estimateRecipient) || /^0x0{40}$/i.test(estimateRecipient))) return;
    if (wallet.address && (!isAddress(recipientValue) || /^0x0{40}$/i.test(recipientValue))) return;
    let active = true;
    let expires: ReturnType<typeof setTimeout> | undefined;
    setPreviewState({ key: previewKey, status: 'loading' });
    const publish = (data: BridgePreview) => {
      if (!active) return;
      if (!isFreshBridgePreview(data)) { setPreviewState({ key: previewKey, status: 'expired' }); return; }
      setPreviewState(current => ({ key: previewKey, status: 'ready', data:
        current?.key === previewKey && current.data?.readAt === data.readAt ? { ...current.data, ...data } : data }));
      if (expires) clearTimeout(expires);
      expires = setTimeout(() => { if (active) setPreviewState({ key: previewKey, status: 'expired' }); }, Math.max(0, data.readAt + BRIDGE_PREVIEW_TTL - Date.now()));
    };
    const debounce = setTimeout(() => {
      const request = wallet.address
        ? fetchBridgePreview({ sourceChainId, destinationChainId, token, amount: amountWei, wallet: wallet.address as Address, recipient: recipientValue as Address }, publish)
        : fetchCanonicalBridgeEstimate({ sourceChainId, destinationChainId, token, amount: amountWei, ...(estimateRecipient ? { recipient: estimateRecipient as Address } : {}) });
      void request
        .then(publish).catch(() => { if (active) setPreviewState({ key: previewKey, status: 'unavailable' }); });
    }, 80);
    return () => { active = false; clearTimeout(debounce); if (expires) clearTimeout(expires); };
  }, [advanced, amountWei, customRecipient, destinationChainId, previewKey, recipientInput, recipientValue, reviewStage, sourceChainId, token, wallet.address]);
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

  useNavigationInputs({ page: 'move', identity: `${wallet.address?.toLowerCase() ?? 'disconnected'}:${wallet.chainId ?? ''}`, ready: wallet.ready, stage: reviewStage, value: draftState, restore: (state) => {
    setDirection(state.direction as Direction); setMode(state.mode as BridgeMode); setToken(state.token as BridgeAsset);
    setAmount(state.amount as string); setSourceOft(state.sourceOft as string); setDestinationOft(state.destinationOft as string);
    setApprovalToken(state.approvalToken as string); setRecipientInput(state.recipientInput as string); setCustomRecipient(state.customRecipient as boolean);
  } });

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
    if (nextToken === 'fxUSD' || nextToken === 'fxSAVE') {
      setToken(nextToken);
      setAmount(resetTransactionAmounts().amount);
      setSourceOft(''); setDestinationOft(''); setApprovalToken('');
      setRecipientInput(''); setCustomRecipient(false);
      reviewedBridgeRef.current = null;
      setReviewStage('input');
      setReviewRevision(revision => revision + 1);
    }
    contextAppliedRef.current = true;
    return () => { contextAppliedRef.current = false; };
  }, []);

  const resetBridgeContext = useCallback((nextToken: BridgeAsset = token, preserveRecipient = false) => {
    const defaults = resetTransactionAmounts();
    setToken(nextToken);
    setAmount(defaults.amount);
    setSourceOft('');
    setDestinationOft('');
    setApprovalToken('');
    if (!preserveRecipient) {
      setRecipientInput('');
      setCustomRecipient(false);
    }
    setReviewStage('input');
    reviewedBridgeRef.current = null;
    setReviewRevision((revision) => revision + 1);
  }, [token]);

  const changeDirection = useCallback(() => {
    setDirection((current) => current === 'ethereum_to_base' ? 'base_to_ethereum' : 'ethereum_to_base');
    resetBridgeContext();
  }, [resetBridgeContext]);

  const changeToken = useCallback((nextToken: BridgeAsset) => {
    if (nextToken === token) return;
    resetBridgeContext(nextToken, true);
  }, [token, resetBridgeContext]);

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
  const moveBalanceState: TokenBalanceView | undefined = !wallet.address ? { status: 'disconnected' }
    : advanced ? advancedBalance : moveBalances?.[token]
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
      ?? (recipientError ? 'Enter a valid address' : null)
      ?? (nativeShortfall ? `Add ETH on ${sourceName} for fees` : null);

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
      const receiptReadAt = Date.now();
      const estimatedReceived = advanced ? undefined : await readBridgeReceiptEstimate(route);
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
          estimatedReceived,
          receiptReadAt,
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
      <ActionWorkspace density="compact" data-review={!isReviewInputStage(reviewStage)} className={`${styles.workspace} ${styles.moveWorkspace} ${moveStyles.moveWorkspace}`}>
        <PageHeading title="Move" />
        <div className={moveStyles.centerStage}>
        <Card
          data-result-container
          data-flow-stage={reviewStage}
          className={`${styles.focusCard} ${styles.moveCard} ${moveStyles.moveCard} p-5`}
        >
          {isReviewInputStage(reviewStage) && <>
          <div className={moveStyles.cardHead}><span>Bridge{advanced && <small className={moveStyles.modeBadge}>Custom route</small>}</span>
            <TransactionSettings scope="Move" chainId={sourceChainId}>
              <section className={moveStyles.expertSettings} aria-label="Custom bridge contracts">
                <label className={moveStyles.expertToggle}><Code2 size={16} aria-hidden="true" /><span>Expert mode · custom contracts</span>
                  <input type="checkbox" checked={advanced} onChange={event => changeMode(event.target.checked ? 'advanced' : 'canonical')} />
                </label>
                {advanced && <>
                  <AdvancedAddressFields sourceName={sourceName} destinationName={destinationName} sourceChainId={sourceChainId}
                    sourceOft={sourceOft} destinationOft={destinationOft} approvalToken={approvalToken}
                    onSourceOftChange={setSourceOft} onDestinationOftChange={setDestinationOft} onApprovalTokenChange={setApprovalToken} />
                  <AdvancedRiskSummary />
                </>}
              </section>
            </TransactionSettings>
          </div>
          </>}
          <ActionReview
            key={reviewRevision}
            surface="content"
            editor={<>
          <div className={`${styles.moveFormFields} ${moveStyles.moveFormFields}`}>
            <section className={moveStyles.sourcePanel} aria-label="Send assets">
              <AmountField compact label="Amount" symbol={advanced ? 'OFT' : token} value={amount} onChange={setAmount}
                labelContent={<NetworkField label="Send" name={sourceName} chainId={sourceChainId} />}
                maxDecimals={18} balanceState={moveBalanceState} showUnitPrice={false} showShortcuts
                tokenSelector={!advanced ? <TokenSelect compact label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={changeToken} balances={moveBalances} balanceStatus={wallet.address ? moveBalanceStatusForPicker : 'disconnected'} /> : undefined} />
            </section>
            <button
              type="button"
              aria-label={`Reverse route to ${sourceName}`}
              onClick={changeDirection}
              data-direction={sourceChainId === 1 ? 'forward' : 'reverse'}
              className={`glass-press ${styles.networkArrow} ${moveStyles.routeSwap}`}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <section className={moveStyles.destinationPanel} aria-label="Receive assets">
            <NetworkField label="Receive" name={destinationName} chainId={destinationChainId} />
              <div className={moveStyles.receiveLine}>
                {preview?.estimatedReceived !== undefined ? <div className={moveStyles.receiveValue}>
                  <ReceiveFigure amount={formatUnits(preview.estimatedReceived, 18)} display={receiveDisplay} token={token} />
                </div> : <ReceiveAmountPlaceholder amount={amount} loading={quotePending} />}
                <span className={moveStyles.receiveAsset}>{!advanced && <TokenIcon symbol={token} size={24} />}<strong>{advanced ? 'Custom token' : token}</strong></span>
              </div>
              {quotePending ? <p className={moveStyles.receiveCaption} aria-hidden="true"><span className={moveStyles.receiveCaptionPlaceholder} /></p> : <p className={moveStyles.receiveCaption} role="status">
                {!amountWei ? 'Enter an amount to preview' : preview?.estimatedReceived !== undefined ? <AmountCounterpart amount={formatUnits(preview.estimatedReceived, 18)} symbol={token} token={`${receiveDisplay} ${token}`} />
                  : advanced ? 'Custom route checked at review'
                  : recipientError ? 'Check the destination address' : customRecipient && !recipientInput.trim() ? 'Enter a recipient to preview'
                  : previewStatus === 'expired' ? 'Quote expired. Refresh below' : null}
              </p>}
            </section>
            {amountWei && !advanced && (!customRecipient || (isAddress(recipientInput.trim()) && !/^0x0{40}$/i.test(recipientInput.trim()))) && <section className={moveStyles.quoteSummary} aria-label="Bridge quote">
              <div className={moveStyles.quoteHeading}><span>Bridge quote</span>
                <button type="button" aria-label="Refresh quote" disabled={quotePending} onClick={() => setPreviewRevision(value => value + 1)}>Refresh</button>
              </div>
              <dl>
                <QuoteRow label="Minimum received" value={preview ? `${displayBridgeAmount(preview.minimumReceived)} ${token}` : ''} title={preview ? `${formatUnits(preview.minimumReceived, 18)} ${token}` : undefined} pending={quotePending}
                  priced={preview ? { amount: formatUnits(preview.minimumReceived, 18), symbol: token } : undefined} />
                <QuoteRow label="Bridge fee" value={preview ? `${displayBridgeAmount(preview.nativeFee)} ETH` : ''} title={preview ? `${formatUnits(preview.nativeFee, 18)} ETH` : undefined} pending={quotePending} />
              </dl>
            </section>}
            {Boolean(amountWei) && nativeShortfall && <p className={moveStyles.gasNote} data-shortfall role="alert">
              {preview?.sourceGas !== undefined
                ? `Add ETH on ${sourceName}. Your balance does not cover the bridge fee and required network fees.`
                : `Add ETH on ${sourceName}. Your balance does not cover the bridge fee; transaction gas is also required.`}
            </p>}

            <div className={moveStyles.recipientSection}>
              <div className={moveStyles.recipientHeading}>
                {(customRecipient || wallet.address) && <div className={moveStyles.recipientIdentity}><UserRound size={15} aria-hidden="true" /><span>{customRecipient ? 'Recipient' : 'Your wallet'}</span>
                  {!customRecipient && wallet.address && <span className={moveStyles.recipientAddress} title={wallet.address}>{`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}</span>}
                </div>}
                <button
                  type="button"
                  onClick={changeRecipientMode}
                  className={moveStyles.recipientChange}
                  aria-expanded={customRecipient}
                  aria-controls="move-recipient-address"
                >
                  {customRecipient ? 'Use your wallet' : wallet.address ? 'Change' : 'Set recipient'}
                </button>
              </div>
              <div id="move-recipient-address" hidden={!customRecipient}>
                {customRecipient && <AddressField
                  label="Destination wallet"
                  value={recipientInput}
                  onChange={setRecipientInput}
                  placeholder="0x… destination wallet"
                  error={recipientError}
                />}
              </div>
            </div>



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
        {isReviewInputStage(reviewStage) && <MoveSections sourceChainId={sourceChainId} custom={advanced} />}
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
        <p>Custom contracts can put your funds at risk. Live checks do not establish that a token is safe. <InfoHelp label="Custom contract checks">Both networks must have deployed 18-decimal metadata, matching non-zero cross-chain peers, quote support and the exact send target. Source confirmation is not destination delivery.</InfoHelp></p>
      </div>
    </div>
  );
}

function AddressField({ label, hint, value, onChange, placeholder, error }: { label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder: string; error?: string }) {
  const errorId = useId();
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-[12px] font-medium text-mut">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-[var(--mut-2)]">{hint}</span>}
      </span>
      {/* Phones must not capitalise or correct a hex address while it is typed or pasted. */}
      <input aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" className="min-h-[56px] w-full rounded-2xl border border-[var(--line)] bg-[var(--input)] px-3 font-mono text-[16px] outline-none focus:border-mint" />
      {error && <span id={errorId} role="alert" className={moveStyles.fieldError}>{error}</span>}
    </label>
  );
}

function NetworkField({ label, name, chainId }: { label: 'Send' | 'Receive'; name: string; chainId: FxChainId }) {
  return (
    <span className={moveStyles.routeNode}>
      <span>{label}</span>
      <span className={moveStyles.routeIdentity}><ChainIcon chainId={chainId} size={18} className={moveStyles.chainLogo} /><span className={moveStyles.routeName}>{name}</span></span>
    </span>
  );
}

function displayBridgeAmount(value: bigint): string {
  if (value > 0n && value < 10n ** 10n) return '<0.00000001';
  const [whole, fraction = ''] = formatUnits(value, 18).split('.');
  const shown = fraction.slice(0, 8).replace(/0+$/, '');
  const omitted = /[1-9]/.test(fraction.slice(8));
  return `${omitted ? '≈ ' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${shown ? `.${shown}` : ''}`;
}
/** Each quote figure carries its USD estimate; a pending row reserves that space so nothing moves when the quote lands. */
function QuoteRow({ label, value, title, pending = false, priced }: { label: string; value: string; title?: string; pending?: boolean; priced?: { amount: string; symbol: string } }) {
  const fact = { label, value, title };
  return <div><dt><MetricLabel minimalHelp label={label} definition={reviewHelpDefinition(label)} /></dt><dd>{pending
    ? <><span className={moveStyles.quoteValuePlaceholder}><MissingValue width="md" announce={false} label={`Loading ${label.toLowerCase()}`} /></span>{(label === 'Bridge fee' || priced) && <span className={moveStyles.feeUsdPlaceholder} aria-hidden="true" />}</>
    : priced ? <InlineAmount beside amount={priced.amount} symbol={priced.symbol} token={<ReviewFactValue fact={fact} />} />
    : <><ReviewFactValue fact={fact} />{label === 'Bridge fee' && Boolean(value) && value !== 'Unavailable' && <FeeUsd fact={{ value, title }} />}</>}</dd></div>;
}
