import type { ReviewFact } from '@/lib/fx/reviewFormatting';

/** Both supported networks (Ethereum and Base) use ETH. This fact sums native
 * value and the network-fee maximum, not ERC-20 input or all assets spent. */
export function reviewFactLabel(label: string): string {
  return label === 'Total cost' ? 'ETH needed' : label;
}

/** Borrow shows net proceeds before the separately named gross debt and risk. */
export function orderCompactReviewFacts(facts: ReviewFact[], borrowing: boolean): ReviewFact[] {
  if (!borrowing) return facts;
  const order = ['Estimated received', 'Estimated fxUSD received', 'Debt added', 'Estimated debt', 'Loan-to-value'];
  const rank = (label: string) => order.includes(label) ? order.indexOf(label) : order.length;
  return [...facts].sort((left, right) => rank(left.label) - rank(right.label));
}

const SECONDARY = new Set(['Slippage', 'Minimum converted input', 'Minimum converted deposit', 'Gas tier', 'Mode']);
const TRADE_SECONDARY = new Set(['Position', 'Estimated collateral', 'Estimated debt', 'Route', 'Quoted leverage']);
const NEW_BORROW_SECONDARY = new Set(['Position', 'Route', 'Quoted leverage', 'Estimated collateral']);
const NEW_BORROW_PRIMARY = new Set(['Estimated debt']);

function exactTokenAmount(fact: ReviewFact | undefined): string | undefined {
  const value = fact?.title ?? fact?.value;
  const match = value && /^(\d[\d,]*)(?:\.(\d+))?\s+(\S+)$/.exec(value);
  if (!match) return undefined;
  const whole = match[1].replace(/,/g, '').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} ${match[3]}`;
}

/** Partition accepted facts only. No amounts or signing terms are changed here. */
export function reviewHierarchy(summary: readonly ReviewFact[], details: readonly ReviewFact[], trade: boolean, newBorrow = false, bridge = false) {
  const primary: ReviewFact[] = [];
  const more: ReviewFact[] = [];
  const seen = new Set<string>();
  const debtAdded = exactTokenAmount(summary.find(fact => fact.label === 'Debt added'));
  const target = summary.find(fact => fact.label === 'Target leverage');
  const source = summary.find(fact => fact.label === 'Source network');
  const destination = summary.find(fact => fact.label === 'Destination network');
  const bridgeNetworks = bridge && source && destination
    ? { label: 'Networks', value: `${source.value} → ${destination.value}`, title: `From ${source.value} to ${destination.value}` }
    : undefined;
  const bridgeAsset = bridge && summary.find(fact => fact.label === 'Asset');
  const assetShownInAmount = bridgeAsset && summary.some(fact => ['Amount', 'Input amount'].includes(fact.label) && (fact.title ?? fact.value).endsWith(` ${bridgeAsset.value}`));
  for (const fact of [...summary, ...details]) {
    const identity = `${fact.label}\u0000${fact.value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (fact.label === 'Gas tier' || (fact.label === 'Total cost' && fact.value === 'Included in gas fee')) continue;
    if (trade && fact.label === 'Quoted leverage' && fact.value === target?.value) continue;
    if (trade && fact.label === 'Target leverage') continue; // beside the position name
    if (bridgeNetworks && fact === source) primary.push(bridgeNetworks);
    const secondary = (Boolean(bridgeNetworks) && ['Source network', 'Destination network'].includes(fact.label))
      || (Boolean(assetShownInAmount) && fact.label === 'Asset') || SECONDARY.has(fact.label) || (trade && TRADE_SECONDARY.has(fact.label))
      || (newBorrow && (NEW_BORROW_SECONDARY.has(fact.label)
        || (fact.label === 'Estimated debt' && debtAdded !== undefined && exactTokenAmount(fact) === debtAdded)));
    const visible = summary.includes(fact)
      || (trade && fact.label === 'Execution price')
      || (newBorrow && NEW_BORROW_PRIMARY.has(fact.label));
    (visible && !secondary ? primary : more).push(fact);
  }
  return { primary, more, leverage: target };
}

/** Display-only rounding: keep four significant digits below 1 and at least two decimals above it.
 * Whole amounts never lose precision; callers retain the original string for exact details.
 */
export function readableReviewAmount(value: string): { value: string; shortened: boolean } {
  const match = /^(\d[\d,]*)(?:\.(\d+))?$/.exec(value);
  if (!match?.[2]) return { value, shortened: false };
  const [whole, fraction] = [match[1], match[2]];
  const rawWhole = whole.replace(/,/g, '');
  const significantWhole = rawWhole.replace(/^0+/, '');
  const places = significantWhole
    ? Math.max(2, 4 - significantWhole.length)
    : (fraction.match(/^0*/)?.[0].length ?? 0) + 4;
  const discarded = fraction.slice(places);
  const shortened = /[1-9]/.test(discarded);
  let roundedWhole = whole;
  let kept = fraction.slice(0, places);
  if (discarded && discarded[0] >= '5') {
    // Increment decimal digits directly, including carries across the decimal point.
    // Never parse the amount as a floating-point number (even for very large balances).
    const digits = (rawWhole + kept).split('');
    let index = digits.length - 1;
    while (index >= 0 && digits[index] === '9') digits[index--] = '0';
    if (index < 0) digits.unshift('1');
    else digits[index] = '123456789'['012345678'.indexOf(digits[index])];
    const rounded = digits.join('');
    const nextWhole = rounded.slice(0, -places);
    roundedWhole = whole.includes(',') ? nextWhole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : nextWhole;
    kept = rounded.slice(-places);
  }
  kept = kept.replace(/0+$/, '');
  return { value: `${roundedWhole}${kept ? `.${kept}` : ''}`, shortened };
}
