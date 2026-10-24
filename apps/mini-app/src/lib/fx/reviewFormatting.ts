import { formatUnits } from 'viem';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from './policy';
import { FX_TOKENS, type FxTokenDefinition } from './tokens';
import { tokenSymbol } from './tokenPresentation';
import type { OfficialFxMethod, PlannedRoute, ReviewedActionIntent } from './types';
import { calculateProtocolFee } from './protocolFee';
import { parseStEthPerWstEth, stEthForWstEth } from './wstEthRate';
import { projectedLiquidationPrice } from './liquidationQuote';
import { acceptedFxSaveQuote } from './fxSaveReviewQuote';
import { borrowFundingIsFresh, formatBorrowFundingApr } from './borrowFunding';
import { normalizePositionEconomics } from './positionEconomics';

/**
 * `equivalent` is the same amount in another unit, shown muted beside the
 * value (for example a wstETH minimum's stETH equivalent); the value itself
 * stays exact in the unit it is signed in.
 */
export type ReviewFact = { label: string; value: string; title?: string; equivalent?: string;
  /** Display-only token fees from this route. Missing means the fee base is
   * unknown; an empty list means every applicable quoted rate is zero. */
  feeAmounts?: readonly { amount: string; symbol: string; estimated?: boolean }[];
};
type Unit = { symbol: string; decimals: number };
type Pool = { market: 'ETH' | 'BTC'; side: 'long' | 'short' };

/** The unit an ETH long's collateral is accounted in, everywhere FxAeon shows it. */
const STETH: Unit = { symbol: 'stETH', decimals: 18 };
const WSTETH: Unit = { symbol: 'wstETH', decimals: 18 };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const tokenUnit = (token: FxTokenDefinition): Unit => ({ symbol: tokenSymbol(token.key), decimals: token.decimals });

function unitForAddress(address: string): Unit | undefined {
  const token = Object.values(FX_TOKENS).find((candidate) => sameAddress(address, candidate.address));
  return token && tokenUnit(token);
}

function knownPool(intent: ReviewedActionIntent): Pool | undefined {
  if (!('poolAddress' in intent)) return undefined;
  for (const market of ['ETH', 'BTC'] as const) {
    for (const side of ['long', 'short'] as const) {
      if (!sameAddress(intent.poolAddress, positionPoolAddress(market, side))) continue;
      if ('positionType' in intent && intent.positionType !== side) return undefined;
      if (!('positionType' in intent) && side !== 'long') return undefined;
      if ('collateralTokenAddress' in intent && !sameAddress(intent.collateralTokenAddress, positionCollateralTokenAddress(market, side))) return undefined;
      if ('debtTokenAddress' in intent && !sameAddress(intent.debtTokenAddress, positionDebtTokenAddress(market, side))) return undefined;
      return { market, side };
    }
  }
  return undefined;
}

/** Decimal-string formatting avoids losing precision through Number. */
function compactDecimal(value: string, places: number): string {
  const [whole, fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const shown = fraction.slice(0, places).replace(/0+$/, '');
  const truncated = /[1-9]/.test(fraction.slice(places));
  if (truncated && integer === '0' && !shown) return `<0.${'0'.repeat(places - 1)}1`;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${truncated ? '≈ ' : ''}${grouped}${shown ? `.${shown}` : ''}`;
}

/** Every digit, grouped: a value the wallet will sign is never rounded. */
function exactDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const shown = fraction.replace(/0+$/, '');
  return shown ? `${integer}.${shown}` : integer;
}

/**
 * Quote estimates read compactly with "≈"; signed values (approvals and the
 * minimums a transaction enforces) read exactly.
 */
function amountFact(label: string, raw: string | undefined, unit: Unit | undefined, precision: 'estimate' | 'exact' = 'estimate'): ReviewFact | undefined {
  if (raw === undefined || !unit || !/^\d+$/.test(raw)) return undefined;
  const exact = formatUnits(BigInt(raw), unit.decimals);
  return {
    label,
    value: `${precision === 'exact' ? exactDecimal(exact) : compactDecimal(exact, Math.min(unit.decimals, 8))} ${unit.symbol}`,
    title: `${exact} ${unit.symbol}`,
  };
}

/** An approval is signed as an exact amount, so it reads exactly. */
export function tokenAmountReviewFact(label: string, value: bigint, address: string): ReviewFact {
  return amountFact(label, value.toString(), unitForAddress(address), 'exact')
    ?? { label, value: `${value} raw units`, title: `${value} raw units` };
}

/** A converted figure is an estimate however many digits it shows. */
function estimated(shown: string): string {
  return /^[≈<]/.test(shown) ? shown : `≈ ${shown}`;
}

/** Pinned fx-sdk 1.0.5 quote/accounting amounts are WAD (18 decimals), including WBTC. */
function debtUnit(pool: Pool): Unit {
  if (pool.side === 'short') return { symbol: pool.market === 'ETH' ? 'wstETH' : 'WBTC', decimals: 18 };
  return { symbol: 'fxUSD', decimals: 18 };
}

/** openOrAddPositionFlashLoanV2 / closeOrRemovePositionFlashLoanV2: the two branches of a long's leverage change. */
const LONG_OPEN_SELECTOR = '0xef9e1aa7';
const LONG_CLOSE_SELECTOR = '0xe8e9fc2a';

function actionSelector(route: PlannedRoute): string | undefined {
  const actions = route.transactions.filter((transaction) => transaction.kind !== 'approval');
  return actions.length === 1 ? actions[0].data.slice(0, 10).toLowerCase() : undefined;
}

type CollateralQuote = {
  fact: ReviewFact;
  /** The quote's own amount and token, which price its display-only USD value. */
  native: { exact: string; symbol: string };
};

/**
 * The route's collateral quote (`colls`) as one honestly named figure.
 *
 * The wstETH long pool accounts collateral in stETH: its PoolManager scales
 * wstETH by its rate provider (stETH per wstETH). The SDK's reduce, borrow,
 * repay and leverage-down quotes say so. Its open/add quote does not: it adds
 * the new collateral in wstETH to the stETH a position already holds. That
 * wstETH converts at the live rate read with the quote; without a rate a new
 * position keeps its native wstETH figure, and a mixed quote is not shown.
 */
function collateralQuote(route: PlannedRoute, intent: ReviewedActionIntent, pool: Pool): CollateralQuote | undefined {
  const raw = route.details?.colls;
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const colls = BigInt(raw);
  const plain = (unit: Unit): CollateralQuote => ({
    fact: amountFact('Estimated collateral', raw, unit)!,
    native: { exact: formatUnits(colls, unit.decimals), symbol: unit.symbol },
  });
  if (pool.side === 'short') return plain({ symbol: 'fxUSD', decimals: 18 });
  if (pool.market === 'BTC') return plain({ symbol: 'WBTC', decimals: 18 });

  const openBranch = intent.kind === 'position-increase'
    || (intent.kind === 'position-adjust' && actionSelector(route) === LONG_OPEN_SELECTOR);
  if (!openBranch) {
    // An adjustment whose branch cannot be told apart is not interpreted.
    if (intent.kind === 'position-adjust' && actionSelector(route) !== LONG_CLOSE_SELECTOR) return undefined;
    return plain(STETH);
  }
  const rate = parseStEthPerWstEth(route.details?.stEthPerWstEth);
  const newPosition = intent.kind === 'position-increase' && intent.positionId === 0;
  if (newPosition && rate === undefined) return plain(WSTETH);
  const heldRaw = newPosition ? '0' : route.details?.currentColls;
  if (rate === undefined || heldRaw === undefined || !/^\d+$/.test(heldRaw)) return undefined;
  const held = BigInt(heldRaw);
  if (held > colls) return undefined;
  const added = colls - held;
  const exact = formatUnits(held + stEthForWstEth(added, rate), 18);
  const conversion = `${formatUnits(added, 18)} wstETH at ${formatUnits(rate, 18)} stETH per wstETH`;
  return {
    fact: {
      label: 'Estimated collateral',
      value: `${estimated(compactDecimal(exact, 8))} stETH`,
      title: `${exact} stETH (${held > 0n ? `${formatUnits(held, 18)} stETH held plus ` : ''}${conversion})`,
    },
    native: newPosition ? { exact: formatUnits(colls, 18), symbol: 'wstETH' } : { exact, symbol: 'stETH' },
  };
}

/**
 * Converted wstETH enters an ETH long position as stETH. Its signed minimum
 * stays exact in wstETH; the stETH equivalent (rounded down, like the pool)
 * lets it be read against the estimated collateral.
 */
function withStEthEquivalent(fact: ReviewFact, raw: string, route: PlannedRoute, pool: Pool | undefined): ReviewFact {
  if (pool?.market !== 'ETH' || pool.side !== 'long' || !/^\d+$/.test(raw) || BigInt(raw) === 0n) return fact;
  const rate = parseStEthPerWstEth(route.details?.stEthPerWstEth);
  if (rate === undefined) return fact;
  const stEth = formatUnits(stEthForWstEth(BigInt(raw), rate), 18);
  return { ...fact, equivalent: `${estimated(compactDecimal(stEth, 8))} stETH` };
}

function limitUnit(label: string, intent: ReviewedActionIntent, pool: Pool | undefined): { label: string; unit: Unit | undefined } | undefined {
  switch (label) {
    case 'position input conversion minimum output':
      if (pool && (intent.kind === 'position-increase' || intent.kind === 'position-adjust')) {
        return { label: 'Minimum converted input', unit: unitForAddress(intent.collateralTokenAddress) };
      }
      break;
    case 'position output conversion minimum output':
      if (pool && (intent.kind === 'position-reduce' || intent.kind === 'position-adjust')) {
        return { label: 'Minimum received', unit: unitForAddress(intent.kind === 'position-reduce' ? intent.outputTokenAddress : intent.collateralTokenAddress) };
      }
      break;
    case 'deposit conversion minimum output':
      if (pool && intent.kind === 'deposit-and-mint') return { label: 'Minimum converted deposit', unit: unitForAddress(positionCollateralTokenAddress(pool.market, 'long')) };
      break;
    case 'repay conversion minimum output':
      if (pool && intent.kind === 'repay-and-withdraw') return { label: 'Minimum debt repaid', unit: tokenUnit(FX_TOKENS.fxUSD) };
      break;
    case 'withdraw output conversion minimum output':
      if (pool && intent.kind === 'repay-and-withdraw') return { label: 'Minimum received', unit: unitForAddress(intent.withdrawTokenAddress) };
      break;
    case 'fxSAVE deposit base-pool minimum shares':
      if (intent.kind === 'fxsave-deposit' && !intent.directBasePool) return { label: 'Minimum fxSP', unit: tokenUnit(FX_TOKENS.fxUSDBasePool) };
      break;
    case 'fxSAVE deposit conversion minimum output':
      if (intent.kind === 'fxsave-deposit' && !intent.directBasePool) {
        // The supported USDC/fxUSD inputs use identity conversion. Do not
        // infer converter output units for an unrecognized input route.
        const input = [FX_TOKENS.USDC, FX_TOKENS.fxUSD].find((token) => sameAddress(token.address, intent.tokenInAddress));
        if (input) return { label: 'Minimum converted deposit', unit: tokenUnit(input) };
      }
      break;
    case 'fxUSD instant output minimum output':
    case 'USDC instant output minimum output':
      if (intent.kind === 'fxsave-withdraw' && intent.instant && !intent.directBasePool) {
        return { label: `Minimum received (${label.startsWith('fxUSD') ? 'fxUSD' : 'USDC'} leg)`, unit: unitForAddress(intent.tokenOutAddress) };
      }
      break;
  }
  return undefined;
}

const INTENT_OPERATION = {
  'position-increase': 'increasePosition',
  'position-reduce': 'reducePosition',
  'position-adjust': 'adjustPositionLeverage',
  'deposit-and-mint': 'depositAndMint',
  'repay-and-withdraw': 'repayAndWithdraw',
  'fxsave-deposit': 'depositFxSave',
  'fxsave-withdraw': 'withdrawFxSave',
  'fxsave-claim': 'getRedeemTx',
} as const satisfies Record<ReviewedActionIntent['kind'], OfficialFxMethod>;

/** Only interpret quote fields whose units are known for the reviewed action. */
export function routeFinancialReviewFacts(route: PlannedRoute): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const intent = route.policy?.reviewedAction;
  if (!intent || route.chainId !== 1 || route.operation !== INTENT_OPERATION[intent.kind]) return facts;
  const details = route.details;
  const pool = knownPool(intent);
  const add = (fact: ReviewFact | undefined) => { if (fact) facts.push(fact); };

  if (pool) {
    add(protocolFeeReviewFact(route, intent));
    if (intent.kind === 'deposit-and-mint' && intent.mintAmount > 0n) {
      add(borrowFundingReviewFact(route));
      const fee = protocolFeeReviewFact(route, intent);
      const quote = route.details?.protocolFeeQuote;
      if (fee && quote) {
        const amount = intent.mintAmount - calculateProtocolFee(intent.mintAmount, BigInt(quote.ratios[2]));
        const fact = amountFact('Estimated fxUSD received', amount.toString(), tokenUnit(FX_TOKENS.fxUSD))!;
        add({ ...fact, title: `${fact.title}; ${formatUnits(intent.mintAmount, 18)} fxUSD gross debt added, less the accepted quote's borrowing fee. Excludes gas.` });
      } else add({ label: 'Estimated fxUSD received', value: 'Unavailable', title: 'The accepted route has no validated borrowing fee schedule.' });
    }
    const price = details?.executionPrice;
    if ('positionType' in intent && price && /^\d+(?:\.\d+)?$/.test(price) && /[1-9]/.test(price)) {
      // curPrice is already a decimal fxUSD/underlying ratio, not wei and
      // not an external USD price. ETH quotes divide out the wstETH rate.
      const pair = `fxUSD / ${pool.market === 'ETH' ? 'stETH' : 'WBTC'}`;
      add({ label: 'Execution price', value: `${compactDecimal(price, 4)} ${pair}`, title: `${price} ${pair}` });
    }
    // Borrow/repay expose an oracle price under the same SDK field name,
    // not a swap execution price. Keep that value in advanced details.
    const collateral = collateralQuote(route, intent, pool)?.fact;
    if (intent.kind === 'deposit-and-mint' && intent.depositAmount > 0n) {
      const fee = protocolFeeReviewFact(route, intent);
      const ratio = route.details?.protocolFeeQuote?.ratios[0];
      add(fee && ratio !== undefined && BigInt(ratio) === 0n && collateral
        ? { ...collateral, title: `${collateral.title}; accepted f(x) supply fee is 0%, so this quote needs no supply fee deduction.` }
        : { label: 'Estimated collateral', value: 'Unavailable', title: 'The SDK collateral quote does not deduct supply fees. A validated zero supply fee is required to show the post-fee estimate.' });
    } else add(collateral);
    add(amountFact('Estimated debt', details?.debts, debtUnit(pool)));
  }

  if (intent.kind === 'fxsave-deposit' || intent.kind === 'fxsave-withdraw') {
    const quote = acceptedFxSaveQuote(route);
    const outputLabel = intent.kind === 'fxsave-deposit' ? 'Estimated fxSAVE received' : 'Estimated received';
    if (quote) {
      add(quote.estimatedOutput === undefined ? { label: outputLabel, value: 'Unavailable' }
        : amountFact(outputLabel, quote.estimatedOutput,
          intent.kind === 'fxsave-deposit' ? tokenUnit(FX_TOKENS.fxSAVE) : unitForAddress(intent.tokenOutAddress)));
      if (quote.kind === 'instant-withdraw') {
        add({ label: 'f(x) fee', value: `${formatUnits(BigInt(quote.instantFeeRatio!), 16)}%`,
          feeAmounts: [
            { amount: formatUnits(BigInt(quote.grossFxUSD!) - BigInt(quote.netFxUSD!), 18), symbol: 'fxUSD' },
            { amount: formatUnits(BigInt(quote.grossUSDC!) - BigInt(quote.netUSDC!), 6), symbol: 'USDC' },
          ],
          title: `${formatUnits(BigInt(quote.grossFxUSD!) - BigInt(quote.netFxUSD!), 18)} fxUSD + ${formatUnits(BigInt(quote.grossUSDC!) - BigInt(quote.netUSDC!), 6)} USDC; ${formatUnits(BigInt(quote.instantFeeRatio!), 16)}% accepted base-pool instant redemption fee, deducted from both redemption legs before conversion. Excludes gas and conversion costs.` });
        add(amountFact('Instant fee (fxUSD leg)', (BigInt(quote.grossFxUSD!) - BigInt(quote.netFxUSD!)).toString(), tokenUnit(FX_TOKENS.fxUSD)));
        add(amountFact('Instant fee (USDC leg)', (BigInt(quote.grossUSDC!) - BigInt(quote.netUSDC!)).toString(), tokenUnit(FX_TOKENS.USDC)));
      }
    } else if (intent.kind === 'fxsave-deposit' || intent.directBasePool || intent.instant) {
      add({ label: outputLabel, value: 'Unavailable', title: 'No fresh output estimate is bound to the accepted action.' });
      if (intent.kind === 'fxsave-withdraw' && intent.instant) add({ label: 'f(x) fee', value: 'Unavailable' });
    }
  }

  let unsupportedLimits = 0;
  for (const limit of details?.economicLimits ?? []) {
    // Validated fxSAVE USDC/fxUSD identity routes carry a zero converter
    // minOut because there is no conversion output to bound. The positive
    // base-pool share minimum remains the actual deposit floor. Suppress only
    // this precisely labeled, bound no-op fact; keep other zero floors visible.
    const identityDepositNoOp = intent.kind === 'fxsave-deposit'
      && limit.label === 'fxSAVE deposit conversion minimum output'
      && limit.value === '0'
      && details?.conversionPaths?.some((path) => path.label === 'fxSAVE deposit conversion');
    if (identityDepositNoOp) continue;
    const known = limitUnit(limit.label, intent, pool);
    const fact = known && amountFact(known.label, limit.value, known.unit, 'exact');
    if (!known || !fact) {
      unsupportedLimits += 1;
      continue;
    }
    // The floor on wstETH entering the position, comparable with its collateral.
    const collateralFloor = known.unit?.symbol === 'wstETH'
      && (known.label === 'Minimum converted input' || known.label === 'Minimum converted deposit');
    add(collateralFloor ? withStEthEquivalent(fact, limit.value, route, pool) : fact);
  }
  if (pool && intent.kind === 'position-reduce') {
    const minimum = amountFact('Minimum received', details?.minOut, unitForAddress(intent.outputTokenAddress), 'exact');
    const boundMinimum = facts.find((fact) => fact.label === 'Minimum received');
    if (minimum && (!boundMinimum || boundMinimum.title !== minimum.title)) {
      add({ ...minimum, label: boundMinimum ? 'Quoted minimum received' : minimum.label });
    }
  }
  if (unsupportedLimits) add({ label: 'Additional limits', value: 'See advanced details' });
  return facts;
}

/** Current funding is pool-bound information, never a fixed loan rate. */
export function borrowFundingReviewFact(route: PlannedRoute, now = Date.now()): ReviewFact | undefined {
  const intent = route.policy?.reviewedAction;
  if (route.chainId !== 1 || route.operation !== 'depositAndMint' || intent?.kind !== 'deposit-and-mint' || intent.mintAmount <= 0n) return undefined;
  const pool = knownPool(intent);
  const quote = route.details?.borrowFundingQuote;
  if (!pool || pool.side !== 'long' || !quote || typeof quote.poolAddress !== 'string' || typeof quote.ratio !== 'string' || !/^\d{1,78}$/.test(quote.ratio)) return undefined;
  const rate = { market: pool.market, pool: quote.poolAddress, ratio: BigInt(quote.ratio), readAt: quote.readAt };
  if (!borrowFundingIsFresh(rate, pool.market, now)) return undefined;
  return {
    label: 'Borrow rate', value: formatBorrowFundingApr(rate.ratio),
    equivalent: rate.ratio > 0n ? 'Active · can change' : 'Not active · can change',
    title: `Checked ${new Date(rate.readAt).toISOString()}. Exact annualized charge: ${formatUnits(rate.ratio, 16)}% of the whole collateral. Funding is a borrowing charge, not yield. It can change while the position is open; opening and repayment fees are separate.`,
  };
}

export type PositionOutcomeFacts = {
  /**
   * The review's "Estimated collateral" fact, plus the quote's own exact
   * amount and token, which price its display-only USD value (an ETH long's
   * wstETH quote at the wstETH price, whichever unit the fact shows).
   */
  collateral: ReviewFact & { exact: string; symbol: string };
  debt: ReviewFact;
  /** SDK quote's expected swap price, in fxUSD per stETH or WBTC. */
  executionPrice?: ReviewFact;
  liquidationPrice?: ReviewFact;
  fee?: ReviewFact;
};

/**
 * What a new position's route will hold, for the Trade ticket's preview: the
 * review's own collateral, debt and fee facts for this exact route (the same
 * labels, units and rounding the review shows), plus the collateral quote's
 * exact decimal. Null for any other route, or when either amount has no known unit.
 */
export function positionOutcomeFacts(route: PlannedRoute): PositionOutcomeFacts | null {
  const intent = route.policy?.reviewedAction;
  if (intent?.kind !== 'position-increase' || intent.positionId !== 0) return null;
  const pool = knownPool(intent);
  const facts = routeFinancialReviewFacts(route);
  const collateral = facts.find((fact) => fact.label === 'Estimated collateral');
  const debt = facts.find((fact) => fact.label === 'Estimated debt');
  const quote = pool ? collateralQuote(route, intent, pool) : undefined;
  if (!collateral || !debt || !quote) return null;
  const liquidationPrice = projectedLiquidationPrice(route);
  return {
    collateral: { ...collateral, ...quote.native },
    debt,
    executionPrice: facts.find((fact) => fact.label === 'Execution price'),
    liquidationPrice: liquidationPrice ? { label: 'Liquidation price', ...liquidationPrice } : undefined,
    fee: facts.find((fact) => fact.label === 'f(x) fee'),
  };
}

/** Fee rates come from the same SDK pool read as the quote, never a static fee table. */
function protocolFeeReviewFact(route: PlannedRoute, intent: ReviewedActionIntent): ReviewFact | undefined {
  const quote = route.details?.protocolFeeQuote;
  if (!quote || !('poolAddress' in intent) || !sameAddress(quote.poolAddress, intent.poolAddress)) return undefined;
  const actions = route.transactions.filter((transaction) => transaction.kind !== 'approval');
  if (actions.length !== 1 || !sameAddress(actions[0].to, quote.routerAddress)) return undefined;
  if (quote.ratios.length !== 4 || quote.ratios.some((ratio) => !/^\d{1,10}$/.test(ratio) || BigInt(ratio) > 1_000_000_000n)) return undefined;
  const selector = actions[0].data.slice(0, 10).toLowerCase();
  let legs: { index: number; basis: string }[];
  if ((intent.kind === 'position-increase' || intent.kind === 'position-adjust')
    && ['0xef9e1aa7', '0x99414c10'].includes(selector)) {
    legs = [{ index: 0, basis: 'supplied collateral' }, { index: 2, basis: 'borrowed debt' }];
  } else if ((intent.kind === 'position-reduce' || intent.kind === 'position-adjust')
    && ['0xe8e9fc2a', '0xad0acfdc'].includes(selector)) {
    legs = [{ index: 1, basis: 'withdrawn collateral' }, { index: 3, basis: 'repaid debt' }];
  } else if (intent.kind === 'deposit-and-mint' && selector === '0x216d5108') {
    legs = [
      ...(intent.depositAmount > 0n ? [{ index: 0, basis: 'supplied collateral' }] : []),
      ...(intent.mintAmount > 0n ? [{ index: 2, basis: 'borrowed debt' }] : []),
    ];
  } else if (intent.kind === 'repay-and-withdraw' && ['0x0d8aea82', '0xbf4e5936'].includes(selector)) {
    legs = [
      ...(intent.withdrawAmount > 0n ? [{ index: 1, basis: 'withdrawn collateral' }] : []),
      ...(intent.minimumRepayAmount > 0n ? [{ index: 3, basis: 'repaid debt' }] : []),
    ];
  } else return undefined;
  if (legs.length === 0) return undefined;
  const charged = legs.filter((leg) => BigInt(quote.ratios[leg.index]) > 0n);
  const describe = (leg: { index: number; basis: string }) => `${formatUnits(BigInt(quote.ratios[leg.index]), 7)}% of ${leg.basis}`;
  // borrowFromLong forwards this exact fxUSD debt amount to PoolManager.
  // Only show an amount when it covers every charged leg. Converted collateral
  // and flash-loan routes cannot safely use the user's input as the fee base.
  if (intent.kind === 'deposit-and-mint' && charged.length === 1 && charged[0].index === 2) {
    const feeAmount = calculateProtocolFee(intent.mintAmount, BigInt(quote.ratios[2]));
    const fact = amountFact('f(x) fee', feeAmount.toString(), tokenUnit(FX_TOKENS.fxUSD))!;
    return { ...fact, feeAmounts: [{ amount: formatUnits(feeAmount, 18), symbol: 'fxUSD' }], value: `${fact.value} (${formatUnits(BigInt(quote.ratios[2]), 7)}%)`, title: `${fact.title}; ${describe(charged[0])}. Deducted from the borrowed amount. Excludes network gas and conversion costs.` };
  }
  const amounts = positionFeeAmounts(route, intent, quote.ratios, charged);
  return {
    label: 'f(x) fee',
    feeAmounts: amounts,
    value: charged.length === 0 ? '0%' : charged.length === 1
      ? `${formatUnits(BigInt(quote.ratios[charged[0].index]), 7)}%`
      : charged.map(describe).join(' + '),
    title: `${amounts?.length ? `${amounts.map(amount => `${amount.estimated ? '≈ ' : ''}${amount.amount} ${amount.symbol}`).join(' + ')}; estimated from the same SDK collateral and debt quote. ` : ''}${(charged.length ? charged : legs).map(describe).join(' + ')} when that leg has a nonzero amount. Quoted f(x) rates; excludes network gas, conversion costs and retained slippage.`,
  };
}

/** The SDK's open/add/up collateral quote is net of the supply fee. Undo that
 * deduction only for a same-read accounting snapshot; charging the input or
 * charging this net figure again would understate leveraged supply fees.
 * This remains an estimate, not an assertion of the eventual on-chain charge. */
function positionFeeAmounts(route: PlannedRoute, intent: ReviewedActionIntent, ratios: readonly string[], charged: { index: number }[]): ReviewFact['feeAmounts'] {
  if (!charged.length) return [];
  if (!['position-increase', 'position-adjust'].includes(intent.kind)) return undefined;
  const pool = knownPool(intent);
  const snapshot = normalizePositionEconomics(route.details?.positionEconomics);
  const raw = route.details?.colls;
  if (!pool || !snapshot || typeof raw !== 'string' || !/^\d{1,78}$/.test(raw)) return undefined;
  const up = snapshot.operation !== 'adjust-down';
  if (charged.some(leg => ![up ? 0 : 1, up ? 2 : 3].includes(leg.index))
    || (intent.kind === 'position-increase' ? snapshot.operation !== 'increase' : snapshot.operation === 'increase')
    || snapshot.supplyFeeRatio !== ratios[0] || snapshot.withdrawFeeRatio !== ratios[1]) return undefined;
  const current = BigInt(snapshot.currentColls);
  const final = BigInt(raw);
  const scale = 1_000_000_000n;
  const amounts: NonNullable<ReviewFact['feeAmounts']>[number][] = [];
  for (const leg of charged) {
    const ratio = BigInt(ratios[leg.index]);
    if (leg.index < 2) {
      if (ratio >= scale || (up ? final < current : current < final)) return undefined;
      const delta = up ? final - current : current - final;
      const fee = up ? (delta * ratio + (scale - ratio) - 1n) / (scale - ratio) : calculateProtocolFee(delta, ratio);
      amounts.push({ amount: formatUnits(fee, 18), symbol: pool.side === 'short' ? 'fxUSD' : pool.market === 'BTC' ? 'WBTC' : up ? 'wstETH' : 'stETH', estimated: true });
    } else {
      // SDK debts add the gross borrowed amount, or subtract the repaid debt,
      // normalized to 18dp even for WBTC. The fee is a separate charge on that
      // debt change, never on the whole resulting position or the user's input.
      const debts = route.details?.debts;
      if (typeof debts !== 'string' || !/^\d{1,78}$/.test(debts)) return undefined;
      const before = BigInt(snapshot.currentDebts);
      const after = BigInt(debts);
      if (up ? after < before : before < after) return undefined;
      amounts.push({ amount: formatUnits(calculateProtocolFee(up ? after - before : before - after, ratio), 18), symbol: pool.side === 'long' ? 'fxUSD' : pool.market === 'ETH' ? 'wstETH' : 'WBTC', estimated: true });
    }
  }
  return amounts;
}

/** Exact source values remain inspectable even when units are unsupported. */
export function rawQuoteReviewFacts(route: PlannedRoute): ReviewFact[] {
  const fields = [
    ['executionPrice', 'Execution price (unrounded)'],
    ['minOut', 'Minimum output quote (raw units)'],
    ['colls', 'Collateral quote (raw units)'],
    ['debts', 'Debt quote (raw units)'],
    ['currentColls', 'Collateral held (raw units)'],
    ['stEthPerWstEth', 'stETH per wstETH (1e18 units)'],
  ] as const;
  return fields.flatMap(([key, label]) => {
    const value = route.details?.[key];
    return value === undefined ? [] : [{ label, value }];
  });
}
