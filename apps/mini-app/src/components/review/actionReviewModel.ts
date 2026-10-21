import type { PlannedRoute } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';

export type ReviewStage = 'input' | 'planning' | 'review' | 'executing' | 'result';
export type ReviewTransition = 'prepare' | 'prepared' | 'prepare-failed' | 'begin-signing' | 'completed' | 'return-to-input' | 'interrupted' | 'signing-failed';

/** Reject asynchronous results after a newer operation or unmount takes ownership. */
export function reviewGenerationIsCurrent(mounted: boolean, activeGeneration: number, candidateGeneration: number): boolean {
  return mounted && activeGeneration === candidateGeneration;
}

/** Completion reads belong to the signed wallet session, not the result view's lifetime. */
export function reviewCompletionSessionIsCurrent(
  sessionInvalidated: boolean,
  expected: { walletAddress: string; connectionVersion: number; isEmbedded: boolean },
  live: { authenticated: boolean; address?: string | null; connectionVersion: number; isEmbedded: boolean },
): boolean {
  return !sessionInvalidated && live.authenticated
    && live.address?.toLowerCase() === expected.walletAddress.toLowerCase()
    && live.connectionVersion === expected.connectionVersion
    && live.isEmbedded === expected.isEmbedded;
}

const transitions: Record<ReviewTransition, readonly ReviewStage[]> = {
  prepare: ['input'],
  prepared: ['planning'],
  'prepare-failed': ['planning'],
  'begin-signing': ['review'],
  completed: ['executing'],
  'return-to-input': ['planning', 'review', 'result', 'executing'],
  interrupted: ['executing'],
  'signing-failed': ['executing'],
};

const destinations: Record<ReviewTransition, ReviewStage> = {
  prepare: 'planning', prepared: 'review', 'prepare-failed': 'input', 'begin-signing': 'executing',
  completed: 'result', 'return-to-input': 'input', interrupted: 'result', 'signing-failed': 'review',
};

/** Pure stage controller. Wallet prompts lock the reviewed route and stage until they settle. */
export function transitionReviewStage(stage: ReviewStage, event: ReviewTransition, walletPending = false): ReviewStage {
  if (walletPending && event === 'return-to-input') return stage;
  return transitions[event].includes(stage) ? destinations[event] : stage;
}

export interface ReviewSession {
  walletAddress: string;
  chainId?: number;
  connectionVersion: number;
}

export function reviewSessionMismatch(review: ReviewSession, live: ReviewSession & { authenticated: boolean }): 'wallet' | 'network' | 'connection' | null {
  if (!live.authenticated || live.walletAddress.toLowerCase() !== review.walletAddress.toLowerCase()) return 'wallet';
  if (review.chainId !== undefined && live.chainId !== review.chainId) return 'network';
  if (live.connectionVersion !== review.connectionVersion) return 'connection';
  return null;
}

export function canAcceptReviewedRoute(stage: ReviewStage, walletPending: boolean): boolean {
  return !walletPending && stage !== 'executing' && stage !== 'result';
}

/** Keep branded token and network casing when adding the explicit review verb. */
export function reviewActionLabel(label: string, operationLabel?: string): string {
  if (/^review\b/i.test(label)) return label;
  const action = operationLabel ?? label;
  return `Review ${action.replace(/^(open|send)\s+/i, '')}`;
}

export function updatedRouteTermsRequired(acceptedTerms: string | null, freshRoute: PlannedRoute): boolean {
  return acceptedTerms !== null && acceptedTerms !== acceptedRouteTerms(freshRoute);
}

/** Identity of the accepted executable terms; fresh estimates cannot replace these silently. */
export function acceptedRouteTerms(route: PlannedRoute): string {
  return JSON.stringify({
    operation: route.operation,
    chainId: route.chainId,
    walletAddress: route.walletAddress.toLowerCase(),
    transactions: route.transactions.map(({ to, data, value, nonce, kind }) => ({ to: to.toLowerCase(), data, value: value.toString(), nonce, kind })),
    routeType: route.details?.routeType,
    requestedAmount: route.details?.requestedAmount,
    requestedLeverage: route.details?.requestedLeverage,
    slippagePercent: route.details?.slippagePercent,
  });
}

/** Consequence copy only uses facts already validated by the route adapter. */
export function consequenceSummary(facts: readonly ReviewFact[]): ReviewFact[] {
  const consequenceLabels = new Set([
    'Amount', 'Input amount', 'Deposit', 'Borrow', 'Debt added', 'Repay', 'Withdraw', 'fxSAVE', 'Receive',
    'Estimated fxSAVE received', 'Estimated received', 'Estimated fxUSD received', 'f(x) fee', 'f(x) fee rate', 'Availability',
    'Minimum received', 'Quoted minimum received', 'Position', 'Target leverage', 'Leverage',
    'Source network', 'Destination network', 'Asset', 'Recipient', 'Bridge fee', 'Mode', 'Collateral', 'Debt',
    'Current collateral', 'Expected collateral', 'Current debt', 'Expected debt', 'Expected receive',
    'Estimated collateral', 'Estimated debt', 'Loan-to-value',
  ]);
  const targetLeverage = facts.find((fact) => fact.label === 'Target leverage');
  return facts.filter((fact) => consequenceLabels.has(fact.label)
    && !(fact.label === 'Leverage' && targetLeverage?.value === fact.value));
}

export interface PairedPositionFact {
  label: string;
  before: string;
  after: string;
  beforeTitle?: string;
  afterTitle?: string;
}

export function pairVerifiedPositionFacts(before: readonly ReviewFact[], after: readonly ReviewFact[]): {
  paired: PairedPositionFact[];
  remainingBefore: ReviewFact[];
} {
  const paired: PairedPositionFact[] = [];
  const remainingBefore: ReviewFact[] = [];
  for (const fact of before) {
    const normalized = fact.label.toLowerCase();
    const expected = after.find((candidate) => candidate.label.toLowerCase() === `estimated ${normalized}`)
      ?? after.find((candidate) => candidate.label.toLowerCase() === `expected ${normalized}`)
      ?? after.find((candidate) => candidate.label === fact.label);
    if (expected) paired.push({ label: fact.label, before: fact.value, after: expected.value,
      ...(fact.title ? { beforeTitle: fact.title } : {}), ...(expected.title ? { afterTitle: expected.title } : {}) });
    else remainingBefore.push(fact);
  }
  return { paired, remainingBefore };
}

export interface ChangedReviewFact {
  label: string;
  before?: string;
  after?: string;
}

/** Shows changed user consequences only; route metadata is not presented as a transaction outcome. */
export function changedConsequenceFacts(before: readonly ReviewFact[], after: readonly ReviewFact[]): ChangedReviewFact[] {
  const oldFacts = new Map(consequenceSummary(before).map((fact) => [fact.label, fact.value]));
  const newFacts = new Map(consequenceSummary(after).map((fact) => [fact.label, fact.value]));
  const labels = new Set([...oldFacts.keys(), ...newFacts.keys()]);
  return [...labels].flatMap((label) => oldFacts.get(label) === newFacts.get(label)
    ? []
    : [{ label, before: oldFacts.get(label), after: newFacts.get(label) }]);
}
