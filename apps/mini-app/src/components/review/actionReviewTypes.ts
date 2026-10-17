import type { ReactNode } from 'react';
import type { PlannedRoute, TransactionExecutionResult } from '@/lib/fx';
import type { SignatureDraftState } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';

export type ActionPlanBuilder = () => Promise<PlannedRoute | readonly PlannedRoute[]>;
export type ActionReviewStage = 'input' | 'planning' | 'review' | 'executing' | 'result';

/** Preparation belongs to the editor; only a complete review replaces it.
 * Keep the underlying stage for prefetch latches and cancellation guards. */
export function isReviewInputStage(stage: ActionReviewStage): boolean {
  return stage === 'input' || stage === 'planning';
}

export interface ActionReviewProps {
  /** Build the route only after Review or an explicit quote refresh. */
  planBuilder: ActionPlanBuilder | null;
  /** Read a short-lived prepared route for the current form intent. */
  prefetchedPlan?: () => Promise<PlannedRoute | readonly PlannedRoute[] | null>;
  label?: string;
  disabled?: boolean;
  /** What the form still needs; shown on the disabled primary action instead of the review label. */
  blocker?: string | null;
  /** Runs after verified receipts and confirmation; reads may still be settling. */
  onComplete?: (result: TransactionExecutionResult, confirmedRoute: PlannedRoute) => void | Promise<void>;
  /**
   * Opens a position this review just opened, in place of a page load (Trade
   * carries the split chosen on its ticket into it). Gets the position's key,
   * "ETH:long:42", and its page.
   */
  onViewNewPosition?: (position: { key: string; href: string }) => void;
  operationLabel?: string;
  destructive?: boolean;
  onStageChange?: (stage: ActionReviewStage) => void;
  draftState?: SignatureDraftState;
  draftActionKey?: string;
  draftResumePath?: string;
  resumeReview?: number;
  editor?: ReactNode;
  surface?: 'card' | 'content';
  decisionBefore?: ReviewFact[];
  /** User-entered facts only; no quote, fee or execution readiness is implied. */
  preparationFacts?: ReviewFact[];
  executionCost?: {
    estimatedGas?: string;
    gasFee?: string;
    protocolFee?: string;
    totalCost?: string;
  };
}
