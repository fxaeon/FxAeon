import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';

export type ReviewedTransaction = {
  heading: string;
  status: string;
  contract: string;
  calldata: string;
  valueWei: string;
};

/** Read the accepted route from the fork-only instrumented review header before signing. */
export async function readReviewedTransactions(
  actionDetails: Locator,
): Promise<ReviewedTransaction[]> {
  await expect(actionDetails).toBeVisible({ timeout: 180_000 });
  const evidence = actionDetails.locator('[data-fork-reviewed-transactions]');
  await expect(evidence, 'local-fork proof must build with review evidence instrumentation').toHaveCount(1);
  const payload = await evidence.getAttribute('data-fork-reviewed-transactions');
  assert.ok(payload, 'accepted route evidence is required before signing');
  const reviewed: ReviewedTransaction[] = JSON.parse(payload);
  assert.ok(Array.isArray(reviewed), 'accepted route evidence must be a transaction list');

  assert.ok(reviewed.length > 0 && reviewed.length <= 10, 'accepted review must contain one to ten transactions');
  assert.ok(reviewed.some((transaction) => /^Confirm\s+\d+$/.test(transaction.heading)), 'accepted review must include the protocol action');
  reviewed.forEach((transaction, index) => {
    const headingNumber = transaction.heading.match(/^(?:Confirm|Approve\b).*\s(\d+)$/)?.[1];
    assert.equal(headingNumber, String(index + 1), `transaction ${index + 1} must have an ordered heading`);
    assert.match(transaction.contract, /^0x[0-9a-fA-F]{40}$/, `transaction ${index + 1} must preserve its contract`);
    assert.match(transaction.calldata, /^0x[0-9a-fA-F]*$/, `transaction ${index + 1} must preserve its calldata`);
    assert.match(transaction.valueWei, /^\d+$/, `transaction ${index + 1} must preserve its exact native value in wei`);
  });
  return reviewed;
}
