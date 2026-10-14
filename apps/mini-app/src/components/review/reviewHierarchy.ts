import type { ReviewFact } from '@/lib/fx/reviewFormatting';

const SECONDARY = new Set(['Slippage', 'Minimum converted input', 'Minimum converted deposit', 'Total cost', 'Gas tier', 'Mode']);
const TRADE_SECONDARY = new Set(['Position', 'Estimated collateral', 'Estimated debt', 'Route', 'Quoted leverage']);
const NEW_BORROW_PRIMARY = new Set(['Estimated collateral', 'Estimated debt']);

/** Partition accepted facts only. No amounts or signing terms are changed here. */
export function reviewHierarchy(summary: readonly ReviewFact[], details: readonly ReviewFact[], trade: boolean, newBorrow = false) {
  const primary: ReviewFact[] = [];
  const more: ReviewFact[] = [];
  const seen = new Set<string>();
  const target = summary.find(fact => fact.label === 'Target leverage');
  for (const fact of [...summary, ...details]) {
    const identity = `${fact.label}\u0000${fact.value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (fact.label === 'Gas tier' || (fact.label === 'Total cost' && fact.value === 'Included in gas fee')) continue;
    if (trade && fact.label === 'Quoted leverage' && fact.value === target?.value) continue;
    if (trade && fact.label === 'Target leverage') continue; // beside the position name
    const secondary = SECONDARY.has(fact.label) || (trade && TRADE_SECONDARY.has(fact.label));
    const visible = summary.includes(fact)
      || (trade && fact.label === 'Execution price')
      || (newBorrow && NEW_BORROW_PRIMARY.has(fact.label));
    (visible && !secondary ? primary : more).push(fact);
  }
  return { primary, more, leverage: target };
}

/** String-only display truncation: retain meaningful digits even below 1e-18. */
export function readableReviewAmount(value: string): { value: string; shortened: boolean } {
  const match = /^(\d[\d,]*)(?:\.(\d+))?$/.exec(value);
  if (!match?.[2]) return { value, shortened: false };
  const [whole, fraction] = [match[1], match[2]];
  const leading = /^0+$/.test(whole.replace(/,/g, '')) ? (fraction.match(/^0*/)?.[0].length ?? 0) : 0;
  const kept = fraction.slice(0, leading + 6).replace(/0+$/, '');
  const display = `${whole}${kept ? `.${kept}` : ''}`;
  return { value: display, shortened: /[1-9]/.test(fraction.slice(leading + 6)) };
}
