import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const root = resolve(__dirname, '../..');
const tsxPackage = createRequire(resolve(root, 'package.json')).resolve('tsx/package.json');
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'e2e/harness/overlay-lifecycle-entry.tsx');
const mocks: Record<string, string> = {
  '@/lib/wallet': `export function usePrivyWallet() { return { ready: true, authenticated: true, address: '0x1111111111111111111111111111111111111111', connectionVersion: 1, chainId: 1, switchChain: async () => {} }; }`,
  '@/components/ConnectWalletButton': `export default function ConnectWalletButton({ children, onConnected, ...props }) { return <button {...props} onClick={onConnected}>{children}</button>; }`,
  '@/components/TokenIcon': `export function ChainIcon({ chainId, size }) { return <span aria-hidden="true" data-chain-icon={chainId} style={{ width: size }} />; }`,
  'next/navigation': `export function usePathname() { return '/portfolio'; } export function useRouter() { return { push(href) { const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '#destination'; window.history.pushState({ destination: href }, '', hash); } }; }`,
  'lucide-react': `const Icon = (props) => <svg aria-hidden="true" {...props} />; export const AlertTriangle = Icon; export const Check = Icon; export const ChevronDown = Icon; export const Globe2 = Icon; export const LoaderCircle = Icon; export const RefreshCw = Icon;`,
};
let bundle = '';

test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'overlay-lifecycle-mocks', setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void }) {
      build.onResolve({ filter: /^@\// }, (args) => mocks[args.path]
        ? ({ path: args.path, namespace: 'overlay-mock' })
        : ({ path: `${resolve(root, 'src', args.path.slice(2))}.ts` }));
      build.onResolve({ filter: /^next\/navigation$/ }, (args) => ({ path: args.path, namespace: 'overlay-mock' }));
      build.onResolve({ filter: /^lucide-react$/ }, (args) => ({ path: args.path, namespace: 'overlay-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'overlay-mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

async function mountHarness(page: import('@playwright/test').Page, initiallyOpen = false) {
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => window.history.pushState({ priorRoute: true }, '', '#prior-route'));
  await page.evaluate(() => window.history.pushState({ harnessBase: true }, '', '#overlay-harness'));
  await page.evaluate(() => { document.body.style.overflow = 'auto'; });
  await page.evaluate((value) => { (window as Window & { __overlayInitiallyOpen?: boolean }).__overlayInitiallyOpen = value; }, initiallyOpen);
  await page.evaluate(() => { (window as Window & { __overlayHistoryBaseline?: number }).__overlayHistoryBaseline = window.history.length; });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Overlay lifecycle harness' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mountHarness(page);
});

test('contains keyboard focus and restores focus through nested dialogs', async ({ page }) => {
  const parentTrigger = page.getByRole('button', { name: 'Open wallet profile' });
  await parentTrigger.click();
  const parent = page.getByRole('dialog', { name: 'Wallet profile' });
  await expect(parent).toBeVisible();
  const initialHistoryLength = await page.evaluate(() => window.history.length);
  const historyBaseline = await page.evaluate(() => (window as Window & { __overlayHistoryBaseline?: number }).__overlayHistoryBaseline!);
  expect(initialHistoryLength).toBe(historyBaseline + 1);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  const childTrigger = parent.getByRole('button', { name: 'Open asset picker' });
  await expect(parent.getByRole('button', { name: 'Close wallet profile' })).toBeFocused();
  await childTrigger.click();

  const child = page.getByRole('dialog', { name: 'Asset picker' });
  const closeChild = child.getByRole('button', { name: 'Close asset picker' });
  const telegramBack = child.getByRole('button', { name: 'Telegram Back' });
  const navigateLink = child.getByRole('link', { name: 'Open history' });
  await expect(closeChild).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(navigateLink).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(telegramBack).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(navigateLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeChild).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(childTrigger).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: 'Close wallet profile' }).click();
  await expect(parent).toBeHidden();
  await expect(parentTrigger).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'auto');
});

test('a control focused inside a dialog before its first frame keeps focus', async ({ page }) => {
  // Open the dialog and focus a control inside it in one task, before the
  // frame that places initial focus: someone who already tapped a field
  // inside must not have focus, or their typing, pulled to Close.
  const outcome = await page.evaluate(async () => {
    const buttonNamed = (scope: ParentNode, name: string) => [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === name);
    buttonNamed(document, 'Open wallet profile')!.click();
    await Promise.resolve();
    const dialog = document.querySelector('[data-testid="parent-dialog"]');
    const inside = dialog && buttonNamed(dialog, 'Open asset picker');
    inside?.focus();
    const focusedEarly = document.activeElement === inside;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { focusedEarly, active: document.activeElement?.textContent?.trim() ?? null };
  });
  expect(outcome.focusedEarly, 'The harness must focus inside the dialog before its first frame').toBe(true);
  expect(outcome.active).toBe('Open asset picker');
});

test('route focus during opening does not replace the dialog return target', async ({ page }) => {
  await page.evaluate(() => { (window as Window & { __overlayRouteFocusRace?: boolean }).__overlayRouteFocusRace = true; });
  const trigger = page.getByRole('button', { name: 'Open wallet profile', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('browser Back dismisses one overlay at a time without leaving the page', async ({ page }) => {
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  const parent = page.getByRole('dialog', { name: 'Wallet profile' });
  await parent.getByRole('button', { name: 'Open asset picker' }).click();
  const child = page.getByRole('dialog', { name: 'Asset picker' });

  await page.goBack();
  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(parent.getByRole('button', { name: 'Open asset picker' })).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await page.goBack();
  await expect(parent).toBeHidden();
  await expect(page).toHaveURL(/#overlay-harness$/);
});

test('internal navigation from nested overlays removes all overlay stops and preserves the page behind them', async ({ page }) => {
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  await page.getByRole('dialog', { name: 'Wallet profile' }).getByRole('button', { name: 'Open asset picker' }).click();
  const child = page.getByRole('dialog', { name: 'Asset picker' });
  await child.getByRole('link', { name: 'Open history' }).click();

  await expect(child).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeHidden();
  await expect(page).toHaveURL(/#destination$/);

  await page.goBack();
  await expect(page).toHaveURL(/#overlay-harness$/);
  await page.goBack();
  await expect(page).toHaveURL(/#prior-route$/);
});

test('Telegram Back dismisses the top overlay and consumes the event', async ({ page }) => {
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  const parent = page.getByRole('dialog', { name: 'Wallet profile' });
  await parent.getByRole('button', { name: 'Open asset picker' }).click();
  const child = page.getByRole('dialog', { name: 'Asset picker' });
  await child.getByRole('button', { name: 'Telegram Back' }).click();

  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(parent.getByRole('button', { name: 'Open asset picker' })).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
});

test('closing after a location change does not navigate backward again', async ({ page }) => {
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  await page.evaluate(() => window.history.pushState({ nextLocation: true }, '', '#next-location'));
  await page.getByRole('button', { name: 'Close wallet profile' }).click();

  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeHidden();
  await expect(page).toHaveURL(/#next-location$/);
});

test('manual close removes its Back stop so the next Back returns to the prior page', async ({ page }) => {
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  await page.getByRole('button', { name: 'Close wallet profile' }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeHidden();
  await page.waitForFunction(() => !('__fxaeonOverlayId' in (window.history.state ?? {})));

  await page.goBack();
  await expect(page).toHaveURL(/#prior-route$/);
});

test('wallet profile restores focus to the control that actually opened it', async ({ page }) => {
  const accountControl = page.getByRole('button', { name: 'View connected account' });
  await accountControl.click();
  const profile = page.getByRole('dialog', { name: 'Wallet profile' });
  await expect(profile.getByRole('button', { name: 'Close wallet profile' })).toBeFocused();
  await profile.getByRole('button', { name: 'Close wallet profile' }).click();
  await expect(accountControl).toBeFocused();
});

test('null history state clears on close and does not strand a quick reopen', async ({ page }) => {
  await page.evaluate(() => window.history.replaceState(null, '', window.location.href));
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  await page.getByRole('button', { name: 'Close wallet profile' }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeHidden();
  await page.waitForFunction(() => window.history.state === null);

  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  await page.getByRole('button', { name: 'Close and reopen quickly' }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeHidden();
  await expect(page).toHaveURL(/#overlay-harness$/);
});

test('manually closing a child leaves exactly one Back step for its parent', async ({ page }) => {
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  const parentId = await page.evaluate(() => (window.history.state as Record<string, unknown>).__fxaeonOverlayId);
  const parent = page.getByRole('dialog', { name: 'Wallet profile' });
  await parent.getByRole('button', { name: 'Open asset picker' }).click();
  const childId = await page.evaluate(() => (window.history.state as Record<string, unknown>).__fxaeonOverlayId);
  const child = page.getByRole('dialog', { name: 'Asset picker' });
  await child.getByRole('button', { name: 'Close asset picker' }).click();
  await expect(child).toBeHidden();
  await page.waitForFunction((id) => (window.history.state as Record<string, unknown>).__fxaeonOverlayId === id, parentId);

  await page.goBack();
  await expect(parent).toBeHidden();
  await expect(page).toHaveURL(/#overlay-harness$/);
  await page.goBack();
  await expect(page).toHaveURL(/#prior-route$/);
  expect(childId).not.toBe(parentId);
});

test('StrictMode mounting while open leaves one Back entry and quick reopen stays current', async ({ page }) => {
  await page.goto('about:blank');
  await mountHarness(page, true);
  const parent = page.getByRole('dialog', { name: 'Wallet profile' });
  await expect(parent).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.goBack();
  await expect(parent).toBeHidden();
  await expect(page).toHaveURL(/#overlay-harness$/);
  await expect(page.locator('body')).toHaveCSS('overflow', 'auto');

  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  const beforeQuickReopen = await page.evaluate(() => window.history.length);
  await page.getByRole('button', { name: 'Close and reopen quickly' }).click();
  await expect(parent).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.history.length)).toBe(beforeQuickReopen);
  await page.goBack();
  await expect(parent).toBeHidden();
  await expect(page).toHaveURL(/#overlay-harness$/);
});

test('closing the network selector before opening a modal leaves only the modal Back target', async ({ page }) => {
  const networkTrigger = page.getByRole('button', { name: 'Change network, current Ethereum' });
  await networkTrigger.click();
  const menu = page.getByRole('menu', { name: 'Choose wallet network' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Wallet profile' });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#overlay-harness$/);
  await expect(page.locator('body')).toHaveCSS('overflow', 'auto');
});
