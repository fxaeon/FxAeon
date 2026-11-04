import { expect, type Page } from '@playwright/test';

/** The fork injects one unannounced window.ethereum provider. Select the
 * neutral detected row rather than an internal, per-document provider ID. */
export async function chooseForkBrowserWallet(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Connect your wallet', exact: true })
    .getByRole('button', { name: 'Other wallets', exact: true }).click();
  const wallet = page.getByRole('dialog', { name: 'Other wallets', exact: true })
    .getByRole('button', { name: 'Browser wallet', exact: true });
  await expect(wallet).toContainText('Detected');
  await wallet.click();
}
