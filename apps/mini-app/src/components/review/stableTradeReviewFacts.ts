import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { exactAmountValue } from './actionReviewPresentation';

const ROWS = ['Amount', 'Target leverage', 'Position', 'Slippage', 'Estimated collateral', 'Estimated debt', 'f(x) fee', 'Minimum converted input', 'Gas fee', 'Total cost'] as const;
const ENTERED = new Set(['Amount', 'Target leverage', 'Position', 'Slippage']);

/** Presentation only: reserve unknown values without manufacturing a route. */
export function stableTradeReviewFacts(
  entered: readonly ReviewFact[],
  verified: readonly ReviewFact[],
  state: { preparing: boolean; failed: boolean; checkingGas: boolean; totalIsGasOnly?: boolean; hasVerifiedRoute?: boolean },
): ReviewFact[] {
  // The typed amount reads exactly as its verified route will ("0.50" is
  // "0.5", "1234" is "1,234"), so nothing changes when verification lands.
  const inputs = new Map(entered.map((fact) => [fact.label, fact.label === 'Amount' ? { ...fact, value: exactAmountValue(fact.value) } : fact]));
  const quotes = new Map(verified.map((fact) => [fact.label, fact]));
  const rows = ROWS.map((label) => {
    // Once a route exists, every displayed term belongs to that route, even
    // while a wallet prompt is open and the live form changes.
    const input = state.preparing && !state.hasVerifiedRoute && ENTERED.has(label) ? inputs.get(label) : undefined;
    if (input) return input;
    const pending = !state.failed && ((state.preparing && !state.hasVerifiedRoute) || (state.checkingGas && (label === 'Gas fee' || label === 'Total cost')));
    if (pending) return { label, value: '—' };
    if (label === 'Total cost' && !quotes.has(label) && state.totalIsGasOnly) return { label, value: 'Included in gas fee' };
    if (label === 'Minimum converted input' && !quotes.has(label) && state.hasVerifiedRoute) return { label, value: 'Not quoted' };
    return quotes.get(label) ?? { label, value: 'Unavailable' };
  });
  return [...rows, ...verified.filter((fact) => !ROWS.some((label) => label === fact.label))];
}
