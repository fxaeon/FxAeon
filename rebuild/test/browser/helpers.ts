import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export interface FixtureSnapshot {
  scenario: string;
  sends: number;
  requests: Array<{ method: string; params?: unknown }>;
  acceptedData?: string;
  acceptedValue?: string;
}

interface FixtureControls {
  snapshot(): FixtureSnapshot;
  changeAccount(): void;
  changeChain(): void;
}

export const test = base.extend<{ isolation: void }>({
  isolation: [async ({ context, page, browser }, use, testInfo) => {
    testInfo.annotations.push({ type: 'actual-browser-version', description: browser.version() });
    const external: string[] = [];
    const errors: string[] = [];
    // Fixtures must never read public RPCs or contact real wallet services.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '4173') await route.continue();
      else { external.push(url.origin); await route.abort('blockedbyclient'); }
    });
    page.on('pageerror', error => { errors.push(error.message); });
    await use();
    expect(external, 'Fixture builds must make no external requests').toEqual([]);
    expect(errors, 'Unexpected application errors').toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function fixture(page: Page, scenario = 'success', query = ''): Promise<void> {
  const response = await page.goto(`/app/?scenario=${scenario}${query ? `&${query}` : ''}`);
  expect(response?.headers()['content-security-policy'], 'Built app must receive its real CSP').toContain("object-src 'none'");
  await expect(page.getByText('Simulation environment', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
}

export async function snapshot(page: Page): Promise<FixtureSnapshot> {
  return page.evaluate(() => (window as unknown as { __fxaeonTest: FixtureControls }).__fxaeonTest.snapshot());
}

export async function changeAccount(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __fxaeonTest: FixtureControls }).__fxaeonTest.changeAccount());
}

export async function connect(page: Page, accountPrefix = '0x1111'): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Injected browser wallet \(unverified\)/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('button', { name: new RegExp(accountPrefix) })).toBeVisible();
}

export async function prepare(page: Page, amount = '0.100000000000000001', leverage = '3'): Promise<void> {
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill(amount);
  await page.getByRole('textbox', { name: 'Requested leverage' }).fill(leverage);
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review ETH long', exact: true })).toBeVisible();
}

export async function confirm(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const panels = [...document.querySelectorAll<HTMLElement>('.dialog-body, .trade-ticket, .history-panel')]
      .filter(node => !node.closest('[inert]') && node.getClientRects().length > 0);
    return {
      root: root.scrollWidth - root.clientWidth,
      panels: panels.map(node => ({
        name: node.className, overflow: node.scrollWidth - node.clientWidth,
        descendants: [...node.querySelectorAll<HTMLElement>('*')].filter(child => {
          const rect = child.getBoundingClientRect();
          return child.getClientRects().length > 0 && rect.right > node.getBoundingClientRect().right + 1;
        }).map(child => ({ tag: child.tagName, class: child.className, text: child.textContent?.trim().slice(0, 100), width: child.getBoundingClientRect().width, right: child.getBoundingClientRect().right })),
      })).filter(item => item.overflow > 1),
      controls: [...document.querySelectorAll<HTMLElement>('button, summary, input:not([type="radio"])')]
        .filter(node => !node.closest('[inert]') && node.getClientRects().length > 0)
        .map(node => ({ name: node.getAttribute('aria-label') ?? node.textContent?.trim(), rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1)
        .map(({ name }) => name),
    };
  });
  expect(overflow.root, 'Document horizontal overflow in CSS pixels').toBeLessThanOrEqual(1);
  expect(overflow.panels, 'Panel content must remain readable without horizontal scrolling').toEqual([]);
  expect(overflow.controls, 'Controls must not be clipped beyond the viewport').toEqual([]);
}
