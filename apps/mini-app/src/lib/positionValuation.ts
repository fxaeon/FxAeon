/**
 * Display-only position valuation. The SDK returns position accounting values
 * as raw integers plus their own decimals; keep those values in bigint math
 * so a large position cannot lose precision before it reaches the UI.
 */
export type PositionUsdValuation = {
  collateralUsdCents: bigint | null;
  debtUsdCents: bigint | null;
  netEquityUsdCents: bigint | null;
};

type Decimal = { digits: bigint; scale: number };
type Rational = { numerator: bigint; denominator: bigint };

function decimalFromPrice(price: number | undefined): Decimal | null {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(price.toString().toLowerCase());
  if (!match) return null;

  const fraction = match[2] ?? '';
  const exponent = match[3] ? Number.parseInt(match[3], 10) : 0;
  const digitsText = `${match[1]}${fraction}`;
  let digits = BigInt(digitsText);
  const scale = fraction.length - exponent;
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    return { digits, scale: 0 };
  }
  return { digits, scale };
}

function usdCentsRationalForUnits(raw: bigint, decimals: number, price: number | undefined): Rational | null {
  if (raw < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  // A zero balance has a known USD value of zero even while its token price
  // is unavailable. This keeps a zero debt from hiding an otherwise valid
  // collateral valuation (and vice versa).
  if (raw === 0n) return { numerator: 0n, denominator: 1n };
  const decimalPrice = decimalFromPrice(price);
  if (!decimalPrice) return null;

  // Keep the exact display value in cents until the caller has combined all
  // legs. This avoids a one-cent drift from rounding collateral and debt
  // separately before subtracting them.
  const denominator = 10n ** BigInt(decimals + decimalPrice.scale);
  const numerator = raw * decimalPrice.digits * 100n;
  return { numerator, denominator };
}

function formatPercentRational(numerator: bigint, denominator: bigint): string {
  // Keep two decimal places of the percentage, rounding only at display time.
  const scaled = (numerator * 10000n + denominator / 2n) / denominator;
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}%`;
}

/** Estimate debt as a percentage of collateral using exact USD rationals. */
export function debtCollateralRatioPercent({
  collateralRaw,
  collateralDecimals,
  collateralPrice,
  debtRaw,
  debtDecimals,
  debtPrice,
}: {
  collateralRaw: bigint;
  collateralDecimals: number;
  collateralPrice: number | undefined;
  debtRaw: bigint;
  debtDecimals: number;
  debtPrice: number | undefined;
}): string | null {
  const collateral = usdCentsRationalForUnits(collateralRaw, collateralDecimals, collateralPrice);
  const debt = usdCentsRationalForUnits(debtRaw, debtDecimals, debtPrice);
  if (!collateral || !debt || collateral.numerator <= 0n || debt.numerator < 0n) return null;
  return `≈ ${formatPercentRational(
    debt.numerator * collateral.denominator,
    collateral.numerator * debt.denominator,
  )}`;
}

function roundRational(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -roundRational(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

/** Value an exact wallet quantity without converting token units to Number. */
export function usdCentsForDecimalAmount(amount: string, price: number | undefined): bigint | null {
  if (!amount || amount.length > 100 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amount)) return null;
  const [integer, fraction = ''] = amount.split('.');
  if (fraction.length > 35) return null;
  const value = usdCentsRationalForUnits(BigInt(`${integer || '0'}${fraction}`), fraction.length, price);
  return value === null ? null : roundRational(value.numerator, value.denominator);
}

export function calculatePositionUsdValuation({
  collateralRaw,
  collateralDecimals,
  collateralPrice,
  debtRaw,
  debtDecimals,
  debtPrice,
}: {
  collateralRaw: bigint;
  collateralDecimals: number;
  collateralPrice: number | undefined;
  debtRaw: bigint;
  debtDecimals: number;
  debtPrice: number | undefined;
}): PositionUsdValuation {
  const collateralValue = usdCentsRationalForUnits(collateralRaw, collateralDecimals, collateralPrice);
  const debtValue = usdCentsRationalForUnits(debtRaw, debtDecimals, debtPrice);
  const collateralUsdCents = collateralValue === null ? null : roundRational(collateralValue.numerator, collateralValue.denominator);
  const debtUsdCents = debtValue === null ? null : roundRational(debtValue.numerator, debtValue.denominator);
  return {
    collateralUsdCents,
    debtUsdCents,
    netEquityUsdCents: collateralValue === null || debtValue === null
      ? null
      : roundRational(
        collateralValue.numerator * debtValue.denominator
          - debtValue.numerator * collateralValue.denominator,
        collateralValue.denominator * debtValue.denominator,
      ),
  };
}

function groupDigits(value: string): string {
  let grouped = '';
  for (let index = 0; index < value.length; index += 1) {
    if (index > 0 && (value.length - index) % 3 === 0) grouped += ',';
    grouped += value[index];
  }
  return grouped;
}

export function formatUsdCents(value: bigint | null): string {
  if (value === null) return '—';
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const dollars = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${groupDigits(dollars.toString())}.${cents}`;
}


/** Render-only text from the same unrounded rationals; shared rounded cents stay unchanged. */
export function calculatePositionUsdPresentation(input: Parameters<typeof calculatePositionUsdValuation>[0]) {
  const collateral = usdCentsRationalForUnits(input.collateralRaw, input.collateralDecimals, input.collateralPrice);
  const debt = usdCentsRationalForUnits(input.debtRaw, input.debtDecimals, input.debtPrice);
  const net = collateral === null || debt === null ? null : {
    numerator: collateral.numerator * debt.denominator - debt.numerator * collateral.denominator,
    denominator: collateral.denominator * debt.denominator,
  };
  const display = (value: Rational | null): string | null => {
    if (value === null) return null;
    const absolute = value.numerator < 0n ? -value.numerator : value.numerator;
    if (absolute > 0n && absolute < value.denominator) return value.numerator < 0n ? 'Negative <$0.01' : '<$0.01';
    return formatUsdCents(roundRational(value.numerator, value.denominator));
  };
  return {
    ...calculatePositionUsdValuation(input),
    collateralUsdText: display(collateral),
    debtUsdText: display(debt),
    netEquityUsdText: display(net),
  };
}
