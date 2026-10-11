import { formatUnits } from 'viem';
import { FX_TOKENS, formatRouteGasCost, type PlannedRoute } from '@/lib/fx';
import { compactAddress } from '@/lib/addressPresentation';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { routeFinancialReviewFacts, type ReviewFact } from '@/lib/fx/reviewFormatting';
import type { UseGasCostResult } from '@/lib/fx/useGasCost';
import { formatNativeShortfall, nativeShortfallWei, routeNetworkFeeDisplay, type RouteGasCostEstimate } from '@/lib/fx/gasCost';
import { formatGasTierQuote, type GasTierQuote } from '@/lib/fx/gasFeePolicy';

export interface ExecutionCost { estimatedGas?: string; gasFee?: string; protocolFee?: string; totalCost?: string }
type BridgeReviewQuote = { nativeFee: bigint; destinationChainId?: number; bridgeToken?: string; bridgeAmount?: bigint; minAmountLD?: bigint; recipient?: string };
function isBridgeQuote(value: unknown): value is BridgeReviewQuote {
  return Boolean(value && typeof value === 'object' && 'nativeFee' in value && typeof (value as { nativeFee?: unknown }).nativeFee === 'bigint');
}

function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
}

function tokenForAddress(address: string | undefined) {
  if (!address) return undefined;
  return Object.values(FX_TOKENS).find((token) => token.address.toLowerCase() === address.toLowerCase());
}

/** A known token's display symbol (fxSP for the base-pool share), never its SDK key. */
function tokenSymbolForAddress(address: string | undefined): string | undefined {
  const token = tokenForAddress(address);
  return token && tokenSymbol(token.key);
}

function conciseDecimal(value: string, places = 6): string {
  const [whole, fraction = ''] = value.split('.');
  const shown = fraction.slice(0, places).replace(/0+$/, '');
  const omitted = /[1-9]/.test(fraction.slice(places));
  if (omitted && whole === '0' && !shown) return `<0.${'0'.repeat(Math.max(places - 1, 0))}1`;
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${omitted ? '≈ ' : ''}${groupedWhole}${shown ? `.${shown}` : ''}`;
}

/** A cost estimate rounds up, so the figure shown is never less than the quote. */
function conciseCostDecimal(value: string, places = 6): string {
  const plain = value.replace(/,/g, '');
  const [whole, fraction = ''] = plain.split('.');
  const omitted = /[1-9]/.test(fraction.slice(places));
  if (!omitted) return conciseDecimal(plain, places);
  const scaled = BigInt(`${whole}${fraction.slice(0, places).padEnd(places, '0')}`) + 1n;
  const digits = scaled.toString().padStart(places + 1, '0');
  return `≈ ${exactAmountText(`${digits.slice(0, -places)}.${digits.slice(-places)}`)}`;
}

/**
 * An exact decimal with thousands separators. Inputs and signed values read
 * this way: never rounded and never marked "≈".
 */
export function exactAmountText(decimal: string): string {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(decimal.trim());
  if (!match || (!match[1] && !match[2])) return decimal;
  const whole = (match[1] || '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Entered "0.50 ETH" (or an already grouped "1,234.50 ETH") reads exactly as
 * its verified route will: "0.5 ETH", "1,234.5 ETH".
 */
export function exactAmountValue(value: string): string {
  const match = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)(\s+\S.*)$/.exec(value.trim());
  return match ? `${exactAmountText(match[1].replace(/,/g, ''))}${match[2]}` : value;
}

function addTokenAmountFact(facts: ReviewFact[], label: string, value: bigint, tokenAddress?: string, fallback = 'raw units'): void {
  const token = tokenForAddress(tokenAddress);
  if (!token) {
    addFact(facts, label, `${value.toString()} ${fallback}`);
    return;
  }
  const exact = trimDecimal(formatUnits(value, token.decimals));
  const symbol = tokenSymbol(token.key);
  facts.push({ label, value: `${exactAmountText(exact)} ${symbol}`, title: `${exact} ${symbol}` });
}

function addWadAmountFact(facts: ReviewFact[], label: string, value: bigint, unit: string): void {
  const exact = trimDecimal(formatUnits(value, 18));
  facts.push({ label, value: `${exactAmountText(exact)} ${unit}`, title: `${exact} ${unit}` });
}

function addFact(facts: ReviewFact[], label: string, value: string | undefined): void {
  if (!value || facts.some((fact) => fact.label === label)) return;
  facts.push({ label, value });
}

function bridgeChainName(chainId: number | undefined): string | undefined {
  if (chainId === 1) return 'Ethereum';
  if (chainId === 8453) return 'Base';
  return undefined;
}

function addNativeCostFact(facts: ReviewFact[], label: string, exactValue: string | undefined): void {
  if (!exactValue || facts.some((fact) => fact.label === label)) return;
  const match = exactValue.match(/^(\d[\d,]*(?:\.\d+)?)\s+(ETH|Gwei)(.*)$/);
  if (!match) {
    addFact(facts, label, exactValue);
    return;
  }
  const [, amount, unit, qualifier] = match;
  const isMax = /\bmax\b/i.test(qualifier);
  const shortQualifier = isMax ? ' max' : label === 'Total cost' ? ' total' : '';
  facts.push({
    label,
    value: `${conciseCostDecimal(amount, 6)} ${unit}${shortQualifier}`,
    // A maximum is what the wallet must hold, not what it will be charged.
    title: isMax && label === 'Gas fee' ? `${exactValue}. The most the network fee can be; usually less is charged.` : exactValue,
  });
}

/**
 * Borrow reasons in loan-to-value against its limit, so its reviews do too.
 * The quote's own leverage gives it: debt / collateral = 1 − 1 / leverage,
 * rounded up so the review never shows a safer position than the quote.
 */
function loanToValueFact(leverage: number): ReviewFact | undefined {
  if (!Number.isFinite(leverage) || leverage < 1) return undefined;
  const percent = Math.ceil((1 - 1 / leverage) * 1000 - 1e-6) / 10;
  return {
    label: 'Loan-to-value',
    value: percent <= 0 ? '0%' : `≈ ${percent.toFixed(1)}%`,
    title: `From the quoted leverage of ${leverage}×`,
  };
}

export function primaryReviewFacts(route: PlannedRoute): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const intent = route.policy?.reviewedAction;
  if (intent) {
    switch (intent.kind) {
      case 'position-increase':
        addTokenAmountFact(facts, 'Amount', intent.inputAmount, intent.inputTokenAddress);
        if (intent.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${intent.requestedLeverage}×`);
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        break;
      case 'position-reduce':
        addFact(facts, 'Position', `#${intent.positionId}`);
        addFact(facts, 'Action', intent.isClosePosition ? 'Close position' : 'Reduce position');
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'position-adjust':
        addFact(facts, 'Position', `#${intent.positionId}`);
        if (intent.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${intent.requestedLeverage}×`);
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'deposit-and-mint':
        addTokenAmountFact(facts, 'Deposit', intent.depositAmount, intent.depositTokenAddress);
        addTokenAmountFact(facts, 'Borrow', intent.mintAmount, FX_TOKENS.fxUSD.address);
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        break;
      case 'repay-and-withdraw':
        addTokenAmountFact(facts, 'Repay', intent.minimumRepayAmount, intent.repayTokenAddress);
        addTokenAmountFact(facts, 'Withdraw', intent.withdrawAmount, intent.withdrawTokenAddress);
        addFact(facts, 'Position', `#${intent.positionId}`);
        break;
      case 'fxsave-deposit':
        addTokenAmountFact(facts, 'Deposit', intent.amount, intent.tokenInAddress);
        addFact(facts, 'Recipient', compactAddress(intent.receiver));
        if (!intent.directBasePool) addFact(facts, 'Final fxSAVE minimum', 'Not enforced by this route');
        break;
      case 'fxsave-withdraw':
        addTokenAmountFact(facts, 'fxSAVE', intent.amount, FX_TOKENS.fxSAVE.address);
        // requestRedeem queues the same claim for either selected stablecoin.
        // Only an instant conversion or direct fxSP redeem selects one asset.
        addFact(facts, 'Receive', !intent.directBasePool && !intent.instant
        ? 'fxUSD and/or USDC (later claim)'
          : tokenSymbolForAddress(intent.tokenOutAddress) ?? compactAddress(intent.tokenOutAddress));
        addFact(facts, 'Mode', intent.directBasePool ? 'Direct' : intent.instant ? 'Instant' : 'Queued');
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'fxsave-claim':
        addFact(facts, 'Recipient', compactAddress(intent.receiver));
        break;
    }
  }

  if (route.details?.routeType) addFact(facts, 'Route', route.details.routeType);
  if (route.details?.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${route.details.requestedLeverage}×`);
  if (route.details?.slippagePercent !== undefined) addFact(facts, 'Slippage', `${route.details.slippagePercent}%`);
  const leverage = route.details?.leverage;
  if (leverage !== undefined) {
    const leverageFact = { value: `${conciseDecimal(String(leverage), 2)}×`, title: `${leverage}×` };
    const loanToValue = intent?.kind === 'deposit-and-mint' || intent?.kind === 'repay-and-withdraw'
      ? loanToValueFact(leverage)
      : undefined;
    if (loanToValue) facts.push(loanToValue, { label: 'Quoted leverage', ...leverageFact });
    else facts.push({ label: 'Leverage', ...leverageFact });
  }
  facts.push(...routeFinancialReviewFacts(route));

  if (isBridgeQuote(route.quote)) {
    addFact(facts, 'Source network', bridgeChainName(route.chainId));
    addFact(facts, 'Destination network', bridgeChainName(route.quote.destinationChainId));
    addFact(facts, 'Asset', route.quote.bridgeToken ?? 'Bridge asset');
    if (route.quote.bridgeAmount !== undefined) {
      addWadAmountFact(facts, 'Amount', route.quote.bridgeAmount, route.quote.bridgeToken ?? 'tokens');
    }
    if (route.quote.minAmountLD !== undefined) {
      addWadAmountFact(facts, 'Minimum received', route.quote.minAmountLD, route.quote.bridgeToken ?? 'tokens');
    }
    if (route.quote.recipient) addFact(facts, 'Recipient', route.quote.recipient);
    addWadAmountFact(facts, 'Bridge fee', route.quote.nativeFee, 'ETH');
  }

  return facts;
}

/** Keep each user consequence in its dedicated summary exactly once. */
export function factsOutsideConsequenceSummary(summaryFacts: readonly ReviewFact[], consequenceFacts: readonly ReviewFact[]): ReviewFact[] {
  const owned = new Set(consequenceFacts.map((fact) => `${fact.label}\u0000${fact.value}`));
  return summaryFacts.filter((fact) => !owned.has(`${fact.label}\u0000${fact.value}`));
}

export function routeFacts(route: PlannedRoute, gasCost: Pick<UseGasCostResult, 'estimate' | 'estimateIsCurrent'>, executionCost?: ExecutionCost, feeTierQuote?: GasTierQuote): ReviewFact[] {
  const facts = primaryReviewFacts(route);
  if (feeTierQuote) addFact(facts, 'Gas tier', formatGasTierQuote(feeTierQuote));
  const currentEstimate = gasCost.estimateIsCurrent ? gasCost.estimate : undefined;
  const currentGasCost = gasCost.estimateIsCurrent && gasCost.estimate
    ? formatRouteGasCost(gasCost.estimate)
    : undefined;
  if (currentGasCost?.gasFee) addNativeCostFact(facts, 'Gas fee', currentGasCost.gasFee);
  // With no native value the total is the network fee itself; one row says it.
  const shownFees = currentEstimate ? routeNetworkFeeDisplay(currentEstimate) : undefined;
  const totalIsOnlyTheGasFee = currentEstimate?.nativeValueWei === 0n
    && shownFees?.totalWei !== undefined
    && shownFees.totalWei === shownFees.feeWei;
  if (currentGasCost?.totalCost && !totalIsOnlyTheGasFee) addNativeCostFact(facts, 'Total cost', currentGasCost.totalCost);
  if (executionCost?.gasFee) addNativeCostFact(facts, 'Gas fee', executionCost.gasFee);
  if (executionCost?.protocolFee) addFact(facts, 'Protocol fee', executionCost.protocolFee);
  if (executionCost?.totalCost) addNativeCostFact(facts, 'Total cost', executionCost.totalCost);
  return facts;
}

/** Keep the gas row present while its optional estimate settles. */
export function missingGasFeeFact(gasCost: Pick<UseGasCostResult, 'estimate' | 'estimateIsCurrent' | 'status' | 'error'>): ReviewFact | undefined {
  if (gasCost.estimateIsCurrent && gasCost.estimate?.status === 'current') return undefined;
  if (gasCost.status === 'refreshing') {
    return { label: 'Gas fee', value: '—' };
  }
  return {
    label: 'Gas fee',
    value: gasCost.estimate?.status === 'partial'
      ? 'Partial estimate'
      : 'Unavailable',
  };
}

type FundsEstimate = Pick<RouteGasCostEstimate, 'insufficientNativeBalance' | 'requiredNativeCostWei' | 'nativeBalanceWei' | 'nativeValueWei'>;

/**
 * Names the ETH a wallet must add before it can sign, on the same basis that
 * blocks signing, and the network that needs it. Without a complete fee
 * estimate the size is unknown, so the notice never invents a figure.
 */
export function nativeFundsNotice(estimate: FundsEstimate | undefined, network: string): string {
  const shortfall = estimate ? nativeShortfallWei(estimate) : undefined;
  if (!estimate || shortfall === undefined) return `This wallet needs more ETH on ${network} for network fees.`;
  // The form keeps the amount within the balance, so the gap is usually fees
  // alone; a balance below the amount itself needs both.
  const coversAmount = estimate.nativeBalanceWei !== undefined && estimate.nativeBalanceWei < estimate.nativeValueWei;
  return `Add at least ${formatNativeShortfall(shortfall)} ETH on ${network} to cover ${coversAmount ? 'the amount and network fees' : 'network fees'}.`;
}

/** Reserve a total-cost row only when the reviewed transactions send native value. */
export function missingTotalCostFact(
  route: PlannedRoute,
  gasCost: Pick<UseGasCostResult, 'estimateIsCurrent' | 'status'>,
): ReviewFact | undefined {
  if (!route.transactions.some((transaction) => transaction.value > 0n)) return undefined;
  if (gasCost.status === 'refreshing' && !gasCost.estimateIsCurrent) {
    return { label: 'Total cost', value: '—' };
  }
  return { label: 'Total cost', value: 'Unavailable' };
}
