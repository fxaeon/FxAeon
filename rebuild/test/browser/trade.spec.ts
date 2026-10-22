import { test, expect, fixture, connect, prepare, confirm, snapshot, changeAccount } from './helpers';

test('exact deposit survives review, one wallet request, verified receipt, and account-scoped history', async ({ page }, testInfo) => {
  await fixture(page);
  await connect(page);
  expect((await snapshot(page)).sends).toBe(0);
  await prepare(page);
  const review = page.getByRole('dialog', { name: 'Review ETH long', exact: true });
  await expect(review.getByText('0.100000000000000001', { exact: true })).toBeVisible();
  await review.getByText('Transaction details', { exact: true }).click();
  await expect(review.getByText('100000000000000001 wei', { exact: true })).toBeVisible();
  await expect(review.getByText('0x1111111111111111111111111111111111111111', { exact: true })).toBeVisible();
  await testInfo.attach('review-accessibility-tree', { body: await review.ariaSnapshot(), contentType: 'text/plain' });
  await page.screenshot({ path: 'docs/evidence/checkpoint-exact-review-dark.png' });
  await confirm(page);
  await expect(page.getByRole('dialog', { name: 'Position opened', exact: true })).toBeVisible();
  await expect(page.getByText('ETH long #701', { exact: false })).toBeVisible();
  const evidence = await snapshot(page);
  expect(evidence.sends).toBe(1);
  const requests = evidence.requests.filter(item => item.method === 'eth_sendTransaction');
  expect(requests).toHaveLength(1);
  const sent = (requests[0]!.params as Array<Record<string, string>>)[0]!;
  expect(Object.keys(sent).sort()).toEqual(['chainId', 'data', 'from', 'nonce', 'to', 'value']);
  expect(BigInt(sent.value!)).toBe(100000000000000001n);
  expect(sent.data).toBe(evidence.acceptedData);
  expect(sent.from).toBe('0x1111111111111111111111111111111111111111');
  expect(sent.nonce).toBe('0x7');
  await page.screenshot({ path: 'docs/evidence/checkpoint-verified-receipt-dark.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'View history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your history.' })).toBeVisible();
  await expect(page.getByText('Opened ETH long', { exact: true })).toBeVisible();
  await page.getByText('Opened ETH long', { exact: true }).click();
  await expect(page.getByText('0.100000000000000001 ETH', { exact: true })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'docs/evidence/checkpoint-account-history-dark.png', fullPage: true });
  await changeAccount(page);
  await expect(page.getByText('Your history belongs to you.', { exact: true })).toBeVisible();
  await expect(page.getByText('Opened ETH long', { exact: true })).toHaveCount(0);
  await connect(page, '0x3333');
  await expect(page.getByText('A fresh start.', { exact: true })).toBeVisible();
  await expect(page.getByText('Opened ETH long', { exact: true })).toHaveCount(0);
  expect((await snapshot(page)).sends).toBe(1);
});

test('a saved terminal label is not presented as current confirmation after reload', async ({ page }) => {
  await fixture(page);
  await connect(page);
  await prepare(page, '0.1');
  await confirm(page);
  await expect(page.getByRole('dialog', { name: 'Position opened', exact: true })).toBeVisible();
  await page.reload();
  await connect(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'History', exact: true }).click();
  // Reconnection may already have observed the fixture's now-missing receipt.
  // Both states keep the saved label from claiming current confirmation.
  await expect(page.locator('.history-status')).toHaveText(/^(Needs verification|Pending|Unverified)$/);
  await expect(page.getByText('Opened ETH long', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Confirmed', { exact: true })).toHaveCount(0);
  expect((await snapshot(page)).sends).toBe(0);
});

test('duplicate confirm events dispatch exactly one wallet transaction', async ({ page }) => {
  await fixture(page, 'pending');
  await connect(page);
  await prepare(page);
  const button = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
  // Two synchronous click events exercise the handler before React commits
  // the next view; the controller must own the single-flight guarantee.
  await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await expect(page.getByRole('dialog', { name: 'Transaction submitted', exact: true })).toBeVisible();
  expect((await snapshot(page)).sends).toBe(1);
  await page.getByRole('button', { name: 'Check receipt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check receipt', exact: true })).toBeEnabled();
  expect((await snapshot(page)).sends).toBe(1);
});

for (const outcome of [
  { scenario: 'reject', title: 'Request declined', history: 'Declined' },
  { scenario: 'unknown-send', title: 'Confirmation unavailable', history: 'Unverified' },
  { scenario: 'pending', title: 'Transaction submitted', history: 'Pending' },
  { scenario: 'reverted', title: 'Transaction reverted', history: 'Reverted' },
  { scenario: 'missing-position', title: 'Confirmation unavailable', history: 'Unverified' },
  { scenario: 'receipt-error', title: 'Confirmation unavailable', history: 'Unverified' },
] as const) {
  test(`${outcome.scenario}: receipt and history language preserve the actual certainty without replay`, async ({ page }) => {
    await fixture(page, outcome.scenario);
    await connect(page);
    await prepare(page, '0.1');
    await confirm(page);
    const dialog = page.getByRole('dialog', { name: outcome.title, exact: true });
    await expect(dialog).toBeVisible();
    expect((await snapshot(page)).sends).toBe(1);
    await expect(page.getByRole('heading', { name: 'Position opened', exact: true })).toHaveCount(0);
    if (outcome.scenario === 'unknown-send' || outcome.scenario === 'receipt-error' || outcome.scenario === 'missing-position') {
      await expect(dialog.getByText('Do not send this transaction again.', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Confirm in wallet', exact: true })).toHaveCount(0);
    }
    if (outcome.scenario === 'unknown-send') await expect(dialog.getByText('Transaction hash', { exact: true })).toHaveCount(0);
    if (outcome.scenario === 'missing-position') {
      await expect(dialog.getByText('The transaction is confirmed, but its position could not yet be verified. Check again before opening another trade.', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Verified position', { exact: true })).toHaveCount(0);
    }
    if (outcome.scenario === 'reverted') await expect(dialog.getByText('0.00255 ETH', { exact: true })).toBeVisible();
    if (await dialog.getByRole('button', { name: 'Check receipt', exact: true }).count()) {
      await dialog.getByRole('button', { name: 'Check receipt', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Check receipt', exact: true })).toBeEnabled();
    }
    if (await dialog.getByRole('button', { name: 'View history', exact: true }).count()) {
      await dialog.getByRole('button', { name: 'View history', exact: true }).click();
    } else {
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'History', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Your history.' })).toBeVisible();
    await expect(page.locator('.history-status').filter({ hasText: outcome.history })).toBeVisible();
    expect((await snapshot(page)).sends).toBe(1);
  });
}

test('a declined request preserves the deposit and a new explicit review can ask the wallet again', async ({ page }) => {
  await fixture(page, 'reject');
  await connect(page);
  await prepare(page);
  await confirm(page);
  await expect(page.getByRole('dialog', { name: 'Request declined', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to deposit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.100000000000000001');
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review ETH long', exact: true })).toBeVisible();
  await confirm(page);
  await expect(page.getByRole('dialog', { name: 'Request declined', exact: true })).toBeVisible();
  expect((await snapshot(page)).sends).toBe(2);
});

test('expired review offers refresh and makes no signing request', async ({ page }) => {
  await fixture(page, 'success', 'ttl=900');
  await connect(page);
  await prepare(page, '0.1');
  await expect(page.getByRole('dialog', { name: 'Review expired', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toHaveCount(0);
  expect((await snapshot(page)).sends).toBe(0);
  await page.getByRole('button', { name: 'Refresh review', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review ETH long', exact: true })).toBeVisible();
  expect((await snapshot(page)).sends).toBe(0);
});

test('account change during preflight retires the review without a signing request', async ({ page }) => {
  await fixture(page, 'account-change');
  await connect(page);
  await prepare(page, '0.1');
  await confirm(page);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.1');
  expect((await snapshot(page)).sends).toBe(0);
});

test('nonce change during preflight blocks the transaction and preserves editable input', async ({ page }) => {
  await fixture(page, 'nonce-drift');
  await connect(page);
  await prepare(page, '0.1');
  await confirm(page);
  await expect(page.getByRole('dialog', { name: 'Review unavailable', exact: true })).toBeVisible();
  await expect(page.getByText('Your wallet nonce changed. Refresh and review before signing.', { exact: true })).toBeVisible();
  expect((await snapshot(page)).sends).toBe(0);
  await page.getByRole('button', { name: 'Return to deposit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.1');
});

test('wrong network waits for explicit switch and never signs automatically', async ({ page }) => {
  await fixture(page, 'wrong-chain');
  await connect(page);
  expect((await snapshot(page)).requests.filter(item => item.method === 'wallet_switchEthereumChain')).toHaveLength(0);
  await page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter an amount', exact: true })).toBeVisible();
  expect((await snapshot(page)).requests.filter(item => item.method === 'wallet_switchEthereumChain')).toHaveLength(1);
  expect((await snapshot(page)).sends).toBe(0);
});

for (const scenario of ['simulation-error', 'insufficient-funds'] as const) {
  test(`${scenario}: preparation failure keeps the editor and never opens the wallet`, async ({ page }) => {
    await fixture(page, scenario);
    await connect(page);
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.1');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.1');
    expect((await snapshot(page)).sends).toBe(0);
  });
}

test('cancelling a slow preparation rejects its late result', async ({ page }) => {
  await fixture(page, 'slow-quote');
  await connect(page);
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.1');
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
  // The fixture's quote takes six seconds. This wait specifically verifies
  // that the late producer cannot reopen a cancelled review.
  await page.waitForTimeout(6_200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot(page)).sends).toBe(0);
});
