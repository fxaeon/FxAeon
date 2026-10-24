import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');

test('funded Borrow shows a static dollar protocol fee and keeps unknown quotes distinct', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto('/?view=transaction&product=borrow&stage=review');
  const fee = page.locator('[data-review-fact="f(x) fee"]');
  await expect(fee.locator('[data-usd-state]')).toHaveText('≈ $6.00');
  await page.evaluate(() => document.fonts.ready);
  const body = page.locator('[data-review-scroll]');
  expect(await body.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await expect(fee.locator('details, summary')).toHaveCount(0);
  await expect(fee.locator('[data-info-help-trigger]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('protocol-fee-borrow-short.png'), animations: 'disabled' });
  await page.goto('/?view=transaction&product=borrow&stage=review&protocolFee=unavailable');
  await expect(fee).toContainText('Unavailable');
  await expect(fee).not.toContainText('$0.00');
  await expect(fee.locator('[data-info-help-trigger]')).toBeVisible();
});

test('review network fees show dollars without expandable amounts or redundant price notes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 770 });
  for (const product of ['borrow', 'earn']) {
    await page.goto(`/?view=transaction&product=${product}&stage=review`);
    const fee = page.locator('[data-review-fact="Gas fee"]');
    const amount = fee.locator('[data-usd-state]');
    await expect(fee).toContainText('Network fee');
    await expect(amount).toHaveText('≈ $0.30');
    await expect(amount).toHaveAttribute('data-usd-state', 'estimate');
    await expect(fee.locator('details, summary')).toHaveCount(0);
    await expect(fee.locator('[data-info-help-trigger]')).toBeVisible();
    await expect(page.getByText(/USD is a current-price estimate|USD uses current prices/)).toHaveCount(0);
  }
});

test('unfocused long shortcuts stay compact until the exact amount is edited', async ({ page }) => {
  const captures = resolve(root, 'artifacts/compact-amounts');
  mkdirSync(captures, { recursive: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?amountBalance=0.008793346701694145');
    const input = page.getByRole('textbox', { name: 'Amount in ETH', exact: true });
    const field = page.locator('[data-amount-field="unified"]');
    const entry = field.locator('[data-amount-preview]');
    await field.getByRole('button', { name: 'Use 100% of available balance', exact: true }).click();
    await expect(input).toHaveValue('0.008793346701694145');
    await expect(entry).not.toHaveAttribute('data-amount-expanded');
    await expect(field.locator('[class*="entryPreview"]')).toBeVisible();
    await field.screenshot({ path: resolve(captures, `amount-max-${width}.png`) });
    await field.getByRole('button', { name: '50%', exact: true }).click();
    await expect(input).toHaveValue('0.004396673350847072');
    await expect(entry).not.toHaveAttribute('data-amount-expanded');
    await input.focus();
    await expect(entry).toHaveAttribute('data-amount-expanded', '');
    await input.blur();
    await expect(entry).toHaveAttribute('data-amount-expanded', '');
  }
});

test('long amount previews preserve exact editing and focus/blur never rewrites the draft', async ({ page }) => {
  const captures = resolve(root, 'artifacts/compact-amounts');
  mkdirSync(captures, { recursive: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openLab(page);
    const input = page.getByRole('textbox', { name: 'Amount in ETH', exact: true });
    const field = page.locator('[data-amount-field="unified"]');
    const preview = field.locator('[aria-hidden="true"][class*="entryPreview"]');
    for (const [value, copy] of [['0.008793346701694145', '≈ 0.0087933'], ['1.204548856269749526', '≈ 1.2045']]) {
      // Begin with a settled large short figure, then inspect the long edit
      // immediately. Waiting after the long paste would hide transient clipping.
      await input.fill('1');
      await input.blur();
      await input.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
      await input.fill(value);
      await expect(input).toHaveValue(value);
      await expect(preview).toBeHidden();
      await input.blur();
      await expect(preview).toHaveText(copy);
      await expect(preview).toBeVisible();
      await expect(input).toHaveValue(value);
      await input.focus();
      await expect(preview).toBeHidden();
      await expect(input).toHaveValue(value);
      const editing = await input.evaluate(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        fontSize: Number.parseFloat(getComputedStyle(node).fontSize) }));
      expect(editing.fontSize, 'Exact editing retains the readable 14px floor').toBeGreaterThanOrEqual(14);
      expect(editing.scrollWidth, 'Every exact digit fits immediately after focus').toBeLessThanOrEqual(editing.clientWidth + 1);
      await input.press('ControlOrMeta+A');
      expect(await input.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0))).toBe(value);
      await input.press('End');
      await input.press('Backspace');
      await expect(input).toHaveValue(value.slice(0, -1));
      await input.blur();
      await expect(input).toHaveValue(value.slice(0, -1));
    }
    for (const value of ['0.000000000000000001', '0.000000000000012345']) {
      await input.fill(value);
      await input.blur();
      await expect(input).toHaveValue(value);
      await expect(preview).toHaveCount(0);
      expect(await input.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    await field.evaluate(node => {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = 'Continue amount test';
      action.style.cssText = 'display:block;min-height:52px;width:100%';
      action.addEventListener('click', () => action.setAttribute('data-clicked', 'true'));
      node.after(action);
    });
    await input.fill('0.008793346701694145');
    const continueAction = page.getByRole('button', { name: 'Continue amount test', exact: true });
    await continueAction.click();
    await expect(continueAction).toHaveAttribute('data-clicked', 'true');
    const targets = await field.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    expect(targets.every(height => height >= 44)).toBe(true);
    const geometry = await field.evaluate(node => ({ right: node.getBoundingClientRect().right, scroll: document.documentElement.scrollWidth }));
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.scroll).toBeLessThanOrEqual(width);
    await input.fill('0.008793346701694145');
    await input.blur();
    await field.screenshot({ path: resolve(captures, `amount-preview-${width}.png`) });
    await input.focus();
    await field.screenshot({ path: resolve(captures, `amount-exact-${width}.png`) });
  }
});

async function openLab(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(async () => { await document.fonts.load('500 20px Inter'); await document.fonts.ready; });
}

async function select(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}

test('focused transaction preview uses the real phone sheet without a second card heading', async ({ page }) => {
  for (const product of ['borrow', 'earn']) {
    for (const stage of ['review', 'submitted', 'confirmed']) {
      await page.setViewportSize({ width: 390, height: stage === 'review' ? 500 : 844 });
      await page.goto(`/?view=transaction&product=${product}&stage=${stage}`);
      const sheet = page.locator('[data-mobile-review-sheet]');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText('Fixture preview · no transaction sent', { exact: true })).toBeVisible();
      await expect(sheet.locator('.transaction-preview')).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'Transaction stages', exact: true })).toHaveCount(0);
      await expect(sheet.locator('[data-review-header]:visible')).toHaveCount(0);
      expect(await sheet.locator('h1,h2,h3').evaluateAll(headings => headings.filter(heading => {
        const box = heading.getBoundingClientRect();
        return box.width > 2 && box.height > 2;
      }).length)).toBe(1);
      const geometry = await sheet.evaluate(element => ({ width: element.getBoundingClientRect().width, viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
      expect(geometry.width).toBeLessThanOrEqual(390);
      expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
      if (stage === 'review') {
        const heading = await sheet.locator('header h2').boundingBox();
        const handle = await sheet.locator('header > span[aria-hidden="true"]').boundingBox();
        expect(heading!.y, 'The title clears the drag handle on short screens').toBeGreaterThanOrEqual(handle!.y + handle!.height);
        await expect(sheet.locator('[data-review-actions]')).toBeVisible();
        await expect(sheet.locator('[data-review-viewport] > [data-review-actions]')).toHaveCount(1);
      }
      if (stage === 'confirmed' && product === 'borrow') {
        await expect(sheet.getByRole('region', { name: 'Latest position read', exact: true })).toContainText('Simulated position #42 · updated');
        await expect(sheet.getByRole('link', { name: /explorer/i })).toHaveCount(0);
      }
      if (stage === 'confirmed') await page.screenshot({ animations: 'disabled', path: `./test-results/ui-state-lab-playwright/focused-${product}-confirmed-390.png` });
      await sheet.getByRole('button', { name: 'Close transaction review' }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Show transaction preview', exact: true })).toBeVisible();
    }
  }
});

test('catalogs deterministic data states through the real provider-independent amount field', async ({ page }) => {
  await openLab(page);
  const input = page.getByRole('textbox', { name: 'Amount in ETH' });
  await expect(input).toHaveValue('1234.56789');
  expect(await page.locator('.amount-control').evaluate((element) => getComputedStyle(element).borderRadius)).toBe('12px');
  await expect.poll(() => page.locator('.field-shell img[aria-label="ETH logo"]').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('14px Inter'))).toBe(true);
  await select(page, 'loading');
  await expect(page.getByText('Checking balance')).toBeVisible();
  await expect(page.getByLabel('Available balance', { exact: true })).toHaveAttribute('role', 'status');
  const shortcuts = page.getByRole('group', { name: 'Amount shortcuts' });
  for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeDisabled();
  await expect(shortcuts.getByRole('button')).toHaveCount(4);
  await select(page, 'zero');
  await expect(page.getByText('0 ETH')).toBeVisible();
  await expect(shortcuts).toContainText('25%50%75%Max');
  for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeDisabled();
  await select(page, 'partial');
  await expect(page.getByText('Some data is unavailable')).toBeVisible();
  await expect(page.getByLabel('USD value unavailable')).toHaveAttribute('role', 'status');
  await select(page, 'stale');
  await expect(page.getByText('Balance needs refresh')).toBeVisible();
  await expect(page.getByText('Stale values are not presented as current.')).toBeVisible();
  await select(page, 'unavailable');
  await expect(page.getByText('Balance unavailable')).toBeVisible();
  await select(page, 'positive');
  await expect(page.getByText('Balance available')).toBeVisible();
  for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeEnabled();
  await expect(page.getByText('Available:')).toContainText('1,234.56789 ETH');
  await expect(page.getByText('$4,267,629.59')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Action consequences' })).toContainText('Estimated debt');
  const receipt = page.getByRole('region', { name: 'Receipt detail fixtures' });
  await expect(receipt).toContainText('sent 1.2345 USDC');
  await expect(receipt).toContainText('Execution fee: 0.000021 ETH');
  await expect(receipt).toContainText('Partial fee data: this receipt does not include every gas, L1 data, and operator fee component.');
  await expect(receipt).toContainText('Token movement available in technical details');
  const technical = receipt.getByRole('region', { name: 'Technical movements', exact: true });
  await expect(technical).toBeVisible();
  await expect(technical).toContainText('0x3333333333333333333333333333333333333333');
  await expect(technical).toContainText('9 base units');
});

test('shows real Borrow and Earn transaction states without wallet or backend actions', async ({ page }) => {
  const remote: string[] = [];
  await page.route('**/*', route => {
    if (!new URL(route.request().url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) { remote.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await openLab(page);
  await expect(page.getByText(/Fixture preview · no transaction sent/)).toBeVisible();
  const stages = page.getByLabel('Transaction stage', { exact: true });
  const preview = page.locator('.transaction-preview');
  for (const product of ['borrow', 'earn']) {
    await page.getByLabel('Fixture product').selectOption(product);
    for (const stage of ['Editing', 'Preparing', 'Review', 'Signature required', 'Wallet request', 'Submitted', 'Partial completion', 'Confirmed', 'Failed', 'Uncertain']) {
      await stages.selectOption({ label: stage });
      await expect(preview).toHaveAttribute('data-fixture-stage', stage);
      await expect(preview).toHaveAttribute('data-fixture-product', product);
      if (stage === 'Review') {
        await preview.getByRole('button', { name: product === 'borrow' ? 'Borrow fxUSD' : 'Deposit USDC', exact: true }).click();
        await expect(preview).toHaveAttribute('data-fixture-stage', 'Signature required');
      }
      if (stage === 'Signature required') await expect(preview).toContainText('Signature required · not submitted');
      if (stage === 'Partial completion') {
        await expect(preview.getByRole('heading', { name: 'Approval confirmed', exact: true })).toBeVisible();
        await expect(preview).toContainText('Action not submitted');
      }
      if (stage === 'Confirmed') {
        const title = preview.getByRole('heading', { name: product === 'borrow' ? 'Simulated result: fxUSD borrowed' : 'Simulated result: Deposited into fxSAVE', exact: true });
        await expect(title).toBeVisible();
        expect(await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(20);
        await expect(preview.getByRole('region', { name: 'Simulated transaction receipt', exact: true })).toBeVisible();
      }
      if (stage === 'Submitted') await expect(preview.getByRole('status')).toContainText('Submitted');
      if (stage === 'Uncertain') await expect(preview.getByRole('heading', { name: 'Confirmation unknown', exact: true })).toBeVisible();
      if (stage === 'Failed') await expect(preview.getByRole('heading', { name: 'Wallet request declined', exact: true })).toBeVisible();
      await expect(preview.locator('a[href*="etherscan.io"], a[href*="basescan.org"]')).toHaveCount(0);
    }
    await preview.getByRole('button', { name: 'Check History', exact: true }).click();
    await expect(stages).toHaveValue('Review');
  }
  expect(remote).toEqual([]);
  await expect(page.getByLabel('Long amount example')).toContainText('1234567890.123456789012345');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test('adapts to narrow, short, tablet, and desktop viewports with reduced motion enabled', async ({ page }) => {
  await openLab(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 620 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.lab')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data states' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `unexpected horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(false);
  }
});

test('keeps amount label and shortcut targets clear at enlarged text on narrow widths', async ({ page }) => {
  await openLab(page);
  await select(page, 'positive');

  for (const width of [393, 320]) {
    await page.setViewportSize({ width, height: 852 });
    const field = page.locator('.field-shell');
    await field.evaluate((root) => {
      const textNodes = Array.from(root.querySelectorAll<HTMLElement>('label, button, span, strong, input'));
      const initialSizes = textNodes.map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
      for (const { element, size } of initialSizes) element.style.fontSize = `${size * 2}px`;
    });
    const geometry = await field.evaluate((root) => {
      const label = root.querySelector('label');
      const shortcutGroup = root.querySelector('[role="group"]');
      const shortcutTargets = [...(shortcutGroup?.querySelectorAll('button') ?? [])];
      if (!label || !shortcutGroup || shortcutTargets.length === 0) throw new Error('Expected the amount label and shortcut controls.');
      const range = document.createRange();
      range.selectNodeContents(label);
      const textRects = [...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
      const targets = shortcutTargets.map((button) => {
        const { left, right, top, bottom } = button.getBoundingClientRect();
        return { left, right, top, bottom };
      });
      const fieldRect = root.querySelector('.amount-control')!.getBoundingClientRect();
      return { textRects, targets, field: { left: fieldRect.left, right: fieldRect.right, top: fieldRect.top, bottom: fieldRect.bottom } };
    });
    expect(geometry.textRects.length, `amount label has visible text at ${width}px`).toBeGreaterThan(0);
    for (const target of geometry.targets) {
      expect(target.left, `shortcut starts within amount field at ${width}px`).toBeGreaterThanOrEqual(geometry.field.left);
      expect(target.right, `shortcut ends within amount field at ${width}px`).toBeLessThanOrEqual(geometry.field.right);
      for (const text of geometry.textRects) {
        const overlaps = target.left < text.right && target.right > text.left && target.top < text.bottom && target.bottom > text.top;
        expect(overlaps, `shortcut target does not cover label text at ${width}px`).toBe(false);
      }
    }
    await page.screenshot({ animations: 'disabled', path: `./test-results/ui-state-lab-playwright/amount-enlarged-${width}.png` });
    await field.evaluate((root) => root.querySelectorAll<HTMLElement>('label, button, span, strong, input').forEach((element) => { element.style.fontSize = ''; }));
  }
});

test('short transaction sheets keep the whole action visible while their details scroll', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 500 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    for (const product of ['borrow', 'earn']) {
      for (const stage of ['review', 'confirmed', 'failed', 'partial', 'uncertain']) {
        await page.goto(`/?view=transaction&product=${product}&stage=${stage}`);
        const sheet = page.locator('[data-mobile-review-sheet]');
        const scroller = sheet.locator('[data-review-scroll]');
        const action = sheet.locator('[data-review-actions] button').first();
        await expect(action).toBeVisible();
        const geometry = await action.evaluate(button => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { top: rect.top, bottom: rect.bottom, height: rect.height, reachable: hit === button || button.contains(hit) };
        });
        const context = `${product}/${stage} at ${viewport.width}×${viewport.height}`;
        expect(geometry.height, context).toBeGreaterThanOrEqual(44);
        expect(geometry.top, context).toBeGreaterThanOrEqual(0);
        expect(geometry.bottom, context).toBeLessThanOrEqual(viewport.height);
        expect(geometry.reachable, context).toBe(true);
        await expect(scroller).toBeVisible();
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
        const details = await scroller.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const last = element.lastElementChild?.getBoundingClientRect();
          return { bottom: rect.bottom, lastBottom: last?.bottom, remaining: element.scrollHeight - element.clientHeight - element.scrollTop };
        });
        expect(details.bottom, context).toBeLessThanOrEqual(geometry.top);
        expect(details.remaining, context).toBeLessThanOrEqual(1);
        expect(details.lastBottom, context).toBeLessThanOrEqual(geometry.top);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), context).toBe(false);
      }
    }
  }
});

test('captures focused components and compares approved Windows references when present', async ({ page }, testInfo) => {
  await openLab(page);
  const artifacts = resolve(root, 'apps/mini-app/e2e/state-lab/captures');
  const snapshotNames = [
    'amount-loading', 'amount-zero', 'amount-partial', 'amount-positive', 'amount-long-value',
    'amount-theme-dark', 'amount-narrow',
    'review-consequences',
    ...['borrow', 'earn'].flatMap(product => ['review', 'signature-required', 'wallet-request', 'submitted', 'partial', 'confirmed', 'failed', 'uncertain'].map(stage => 'transaction-' + product + '-' + stage)),
    'receipt-known-usdc', 'receipt-base-technical',
  ];
  const forceCompare = process.env.UI_STATE_COMPARE === '1';
  const approveBaselines = process.env.UI_STATE_APPROVE_BASELINES === '1';
  const updatingSnapshots = testInfo.config.updateSnapshots !== 'none';
  if ((forceCompare || approveBaselines) && process.platform !== 'win32') throw new Error('Visual comparison and baseline approval require the pinned Windows Playwright environment used for these references.');
  if (approveBaselines && !updatingSnapshots) throw new Error('UI_STATE_APPROVE_BASELINES requires --update-snapshots.');
  const hasCompleteReferences = snapshotNames.every((name) => existsSync(testInfo.snapshotPath(`ui-state-${name}.png`)));
  const compare = forceCompare || approveBaselines || (process.platform === 'win32' && hasCompleteReferences);
  if (process.platform === 'win32' && !approveBaselines && !hasCompleteReferences && process.env.UI_STATE_CAPTURE !== '1') {
    throw new Error('Windows visual gate requires the complete approved reference set. Inspect captures, then use the explicit baseline approval command in docs/ui-state-lab.md.');
  }
  if (compare && !updatingSnapshots) expect(hasCompleteReferences, 'Approved snapshot set is incomplete; review and update all focused references together.').toBe(true);
  const compareOrCapture = async (name: string, locator: import('@playwright/test').Locator) => {
    const image = await locator.screenshot({ animations: 'disabled' });
    if (process.env.UI_STATE_CAPTURE === '1') {
      mkdirSync(artifacts, { recursive: true });
      const path = resolve(artifacts, `${name}.png`);
      await writeFile(path, image);
    }
    if (compare) await expect.soft(locator).toHaveScreenshot(`ui-state-${name}.png`, { animations: 'disabled' });
    else await testInfo.attach(name, { body: image, contentType: 'image/png' });
  };
  const field = page.locator('.field-shell');
  await select(page, 'loading'); await compareOrCapture('amount-loading', field);
  await select(page, 'zero'); await compareOrCapture('amount-zero', field);
  await select(page, 'partial'); await compareOrCapture('amount-partial', field);
  await select(page, 'positive'); await compareOrCapture('amount-positive', field);
  const amount = page.getByRole('textbox', { name: 'Amount in ETH' });
  await amount.fill('1234567890.123456789012345');
  await amount.evaluate((element: HTMLInputElement) => element.blur());
  await compareOrCapture('amount-long-value', field);
  await amount.fill('1234.56789');
  await amount.evaluate((element: HTMLInputElement) => element.blur());
  await compareOrCapture('amount-theme-dark', field);
  await page.setViewportSize({ width: 320, height: 568 });
  await compareOrCapture('amount-narrow', field);
  await page.setViewportSize({ width: 390, height: 844 });
  await compareOrCapture('review-consequences', page.getByRole('region', { name: 'Action consequences' }));
  for (const product of ['borrow', 'earn']) {
    await page.getByLabel('Fixture product').selectOption(product);
    for (const stage of ['Review', 'Signature required', 'Wallet request', 'Submitted', 'Partial completion', 'Confirmed', 'Failed', 'Uncertain']) {
      await page.getByLabel('Transaction stage', { exact: true }).selectOption({ label: stage });
      const name = stage === 'Partial completion' ? 'partial' : stage.toLowerCase().replaceAll(' ', '-');
      await compareOrCapture('transaction-' + product + '-' + name, page.locator('.transaction-preview'));
    }
  }
  await page.getByLabel('Transaction stage', { exact: true }).selectOption({ label: 'Uncertain' });
  await compareOrCapture('receipt-known-usdc', page.locator('.receipt-example').nth(0));
  await expect(page.getByRole('region', { name: 'Technical movements', exact: true })).toBeVisible();
  await compareOrCapture('receipt-base-technical', page.locator('.receipt-example').nth(1));
  await testInfo.attach('state-lab-manifest', {
    body: Buffer.from(`${snapshotNames.map((name) => `ui-state-${name}.png`).join('\n')}\nSnapshots are compared only on Windows after the full reference set is approved and added.`),
    contentType: 'text/plain',
  });
});
