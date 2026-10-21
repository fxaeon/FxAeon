import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';

export type ReviewedTransaction = {
  heading: string;
  status: string;
  contract: string;
  calldata: string;
  valueWei: string;
};

/** Read and validate the canonical transaction evidence under Advanced before signing. */
export async function readReviewedTransactions(
  actionDetails: Locator,
  options: { collapseAfterRead?: boolean } = {},
): Promise<ReviewedTransaction[]> {
  await expect(actionDetails).toBeVisible({ timeout: 180_000 });
  const reviewDetails = actionDetails.locator('details[aria-label="Advanced transaction details"]');
  await expect(reviewDetails).toHaveCount(1);
  if (!await reviewDetails.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await reviewDetails.locator(':scope > summary').click();
  }

  const steps = actionDetails.getByRole('region', { name: 'Prepared transactions', exact: true });
  await expect(steps).toHaveCount(1);
  const cards = steps.getByRole('group', { name: /^Transaction \d+$/ });
  const cardCount = await cards.count();
  const reviewed: ReviewedTransaction[] = [];
  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    await expect(card).toHaveAttribute('aria-label', `Transaction ${index + 1}`);
    // The flattened rows preview long values. Read their full-data dialogs,
    // rather than treating a truncated preview or a tooltip as the calldata.
    const exactEvidence = async (label: string): Promise<string> => {
      const row = card.locator(`[data-review-evidence="${label}"]`);
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: `View full ${label.toLowerCase()}`, exact: true }).click();
      const dialog = row.getByRole('dialog', { name: `Full ${label.toLowerCase()}`, exact: true });
      await expect(dialog).toBeVisible();
      const value = await dialog.getByRole('textbox', { name: `Exact ${label.toLowerCase()}`, exact: true }).inputValue();
      await dialog.getByRole('button', { name: 'Close full data', exact: true }).click();
      await expect(dialog).toBeHidden();
      return value;
    };
    const headingRow = card.locator(':scope > div').first();
    const displayedHeading = (await headingRow.locator(':scope > span').first().textContent() ?? '').trim();
    const statusBadge = headingRow.locator(':scope > span').nth(1);
    const headingNumber = (await headingRow.locator(':scope > span > span[aria-hidden="true"]').textContent() ?? '').trim();
    const headingTitle = displayedHeading.slice(headingNumber.length).trim();
    const transaction: ReviewedTransaction = {
      // Keep the fork extractor's established `${title} ${index}` format.
      heading: `${headingTitle} ${headingNumber}`,
      // A prepared transaction has no receipt or status badge yet.
      status: await statusBadge.count() ? (await statusBadge.textContent() ?? '').trim() : '',
      contract: await exactEvidence('Contract'),
      calldata: await exactEvidence('Calldata'),
      valueWei: await exactEvidence('Transaction value (wei)'),
    };
    reviewed.push(transaction);
  }

  assert.ok(reviewed.length > 0 && reviewed.length <= 10, 'action details must list one to ten transactions');
  assert.ok(reviewed.some((transaction) => /^Confirm\s+\d+$/.test(transaction.heading)), 'action details must include the protocol action');
  reviewed.forEach((transaction, index) => {
    const headingNumber = transaction.heading.match(/^(?:Confirm|Approve\b).*\s(\d+)$/)?.[1];
    assert.equal(headingNumber, String(index + 1), `transaction ${index + 1} must have an ordered heading`);
    assert.match(transaction.contract, /^0x[0-9a-fA-F]{40}$/, `transaction ${index + 1} must show its contract`);
    assert.match(transaction.calldata, /^0x[0-9a-fA-F]*$/, `transaction ${index + 1} must show its calldata`);
    assert.match(transaction.valueWei, /^\d+$/, `transaction ${index + 1} must show its exact native value in wei`);
  });
  await expect(steps.locator('[data-review-evidence="Calldata"]')).toHaveCount(reviewed.length);

  if (options.collapseAfterRead !== false) {
    await reviewDetails.locator(':scope > summary').click();
  }
  return reviewed;
}
