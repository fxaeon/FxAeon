import { expect, test, type Page } from '@playwright/test';
import { buildAppShellLab, LAB_ORIGIN, serveAppShellLab } from '../harness/app-shell-build';

type Lab = Awaited<ReturnType<typeof buildAppShellLab>>;
type WalletPatch = { ready?: boolean; authenticated?: boolean; address?: string; chainId?: number; ensName?: string };

const ADDRESS = '0x1d34A0000000000000000000000000000000AF81';
const WIDTHS = [320, 344, 360, 375, 390, 412, 430, 480];
const STATES: Array<[string, WalletPatch]> = [
  ['loading', { ready: false, authenticated: false, address: undefined, chainId: undefined }],
  ['disconnected', { ready: true, authenticated: false, address: undefined, chainId: undefined }],
  ['connected', { ready: true, authenticated: true, address: ADDRESS, chainId: 1 }],
];

let lab: Lab;
test.beforeAll(async () => { lab = await buildAppShellLab(); });

async function open(page: Page, { width = 390, height = 844, initScript = '' } = {}) {
  await page.setViewportSize({ width, height });
  await serveAppShellLab(page, lab, initScript);
  await page.goto(`${LAB_ORIGIN}/`);
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

async function setLab(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((value) => (globalThis as typeof globalThis & { __shellLab: { set: (patch: unknown) => void } }).__shellLab.set(value), patch);
}

async function headerGeometry(page: Page) {
  return page.locator('header.app-topbar').evaluate((topbar) => {
    const group = topbar.querySelector('[data-header-wallet-control]')!.getBoundingClientRect();
    const name = topbar.querySelector<HTMLElement>('[data-wallet-identity-name]');
    const controls = [...topbar.querySelectorAll<HTMLElement>('.app-topbar-actions button')].map((control) => control.getBoundingClientRect());
    return {
      height: topbar.getBoundingClientRect().height,
      overflow: topbar.scrollWidth - topbar.clientWidth,
      groupLeft: group.left,
      groupRight: group.right,
      nameClipped: name ? name.scrollWidth > name.clientWidth : false,
      smallestControl: Math.min(...controls.map((rect) => Math.min(rect.width, rect.height))),
      viewport: window.innerWidth,
    };
  });
}

test('the header stays one row with one footprint while the wallet settles, at every phone width', async ({ page }) => {
  await open(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    const lefts: number[] = [];
    for (const [state, wallet] of STATES) {
      await setLab(page, { wallet });
      const geometry = await headerGeometry(page);
      expect(geometry.height, `${state} header is one 48px row at ${width}px`).toBeLessThanOrEqual(48);
      expect(geometry.overflow, `${state} header overflows at ${width}px`).toBeLessThanOrEqual(0);
      expect(geometry.groupRight, `${state} controls stay on screen at ${width}px`).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.smallestControl, `${state} controls keep 44px targets at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(geometry.nameClipped, `the compact address is shown whole at ${width}px`).toBe(false);
      lefts.push(geometry.groupLeft);
    }
    // On phones the network control never moves when the wallet settles.
    if (width <= 430) expect(Math.max(...lefts) - Math.min(...lefts), `wallet controls jump at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('an ENS-length name never breaks the header into two rows', async ({ page }) => {
  await open(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await setLab(page, { wallet: { ready: true, authenticated: true, address: ADDRESS, chainId: 1, ensName: 'dextrader-2024.eth' } });
    const geometry = await headerGeometry(page);
    expect(geometry.height, `header is one row at ${width}px`).toBeLessThanOrEqual(48);
    expect(geometry.overflow, `header overflows at ${width}px`).toBeLessThanOrEqual(0);
    expect(geometry.smallestControl).toBeGreaterThanOrEqual(44);
  }
});

test('loading shows placeholders, not a globe or an empty pill, and they settle after a timeout', async ({ page }) => {
  await open(page);
  // Restart the provider wait with a short timeout (the real one is 12s).
  await setLab(page, { readyTimeoutMs: 400, wallet: STATES[2][1] });
  await setLab(page, { wallet: STATES[0][1] });
  const group = page.getByRole('group', { name: 'Wallet and network controls' });
  await expect(group.locator('.network-selector-placeholder')).toBeVisible();
  await expect(group.locator('img')).toHaveCount(0);
  const placeholder = group.getByRole('status');
  await expect(placeholder).toHaveText('Loading wallet');
  expect(await placeholder.locator('[aria-hidden="true"]').first().evaluate((element) => getComputedStyle(element).animationName)).not.toBe('none');

  await expect(placeholder).toHaveText('Wallet unavailable');
  await expect(placeholder).toHaveAttribute('data-settled', 'true');
  expect(await placeholder.locator('[aria-hidden="true"]').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await setLab(page, { wallet: STATES[1][1] });
  await expect(group.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(group.locator('.network-selector-chains img')).toHaveCount(2);
  await expect(group.locator('.network-selector')).toHaveAttribute('aria-label', 'Choose a network or connect a wallet');

  await setLab(page, { wallet: STATES[2][1] });
  await expect(group.getByRole('button', { name: 'Open wallet profile' })).toContainText('0x1d34…AF81');
  await expect(group.locator('.network-selector img')).toHaveCount(1);
  await expect(group.locator('.network-selector')).toHaveAttribute('aria-label', 'Change network, current Ethereum');
});

test('the theme control shows the theme in use and names the one it switches to', async ({ page }) => {
  await open(page);
  await setLab(page, { wallet: STATES[2][1] });
  const expectations = [
    { theme: 'official', name: 'Official theme. Switch to dark theme' },
    { theme: 'dark', name: 'Dark theme. Switch to light theme' },
    { theme: 'light', name: 'Light theme. Switch to official theme' },
  ];
  for (const [index, { theme, name }] of expectations.entries()) {
    const toggle = page.getByRole('button', { name, exact: true });
    await expect(toggle).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const visible = await toggle.locator('[data-theme-icon]').evaluateAll((icons) => icons
      .filter((icon) => getComputedStyle(icon).display !== 'none')
      .map((icon) => icon.getAttribute('data-theme-icon')));
    expect(visible).toEqual([theme]);
    if (index < expectations.length - 1) await toggle.click();
  }
});

test('the theme icon follows the pre-hydration theme, so a saved theme never flashes the default icon', async ({ page }) => {
  await open(page, { initScript: "localStorage.setItem('fxaeon_theme_id_v2','dark')" });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const visibleIcons = () => page.locator('.theme-toggle [data-theme-icon]').evaluateAll((elements) => elements
    .filter((icon) => getComputedStyle(icon).display !== 'none')
    .map((icon) => icon.getAttribute('data-theme-icon')));
  expect(await visibleIcons()).toEqual(['dark']);
  // Server HTML renders React's default state; the root attribute alone must pick the icon.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  expect(await visibleIcons()).toEqual(['light']);
});

/** How violet the heading's ink is: the largest blue-over-green excess among
 * bright pixels. Plain text in the dark themes stays under ~12; the band of
 * light (mint-bright, coral) pushes it far higher. */
async function headingTint(page: Page, heading: ReturnType<Page['locator']>) {
  const shot = (await heading.screenshot()).toString('base64');
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let tint = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
      if (red + green + blue > 360) tint = Math.max(tint, blue - green);
    }
    return tint;
  }, shot);
}

async function sweep(heading: ReturnType<Page['locator']>, at: number | 'finish') {
  await heading.evaluate((element, time) => {
    const animation = element.getAnimations().find((item) => (item as CSSAnimation).animationName === 'heading-light')!;
    animation.pause();
    if (time === 'finish') animation.finish();
    else animation.currentTime = time;
  }, at);
}

test('the Trade heading arrives lit, and its first and last frames are plain text', async ({ page }) => {
  // Hold the sweep at its start from the first paint, so a slow run cannot let
  // it finish (and mark the session lit) before its frames are inspected.
  await open(page, { initScript: "document.head.append(Object.assign(document.createElement('style'),{textContent:'h1{animation-play-state:paused!important}'}))" });
  await setLab(page, { path: '/trade' });
  const heading = page.locator('.trade-page-heading h1');
  await expect(heading).toHaveText('Trade');
  await expect(heading).toBeVisible();
  await sweep(heading, 0);
  expect(await headingTint(page, heading), 'first frame is plain text').toBeLessThanOrEqual(14);
  // The eased band reaches the middle of the word about 250ms into the sweep.
  await sweep(heading, 120 + 250);
  expect(await headingTint(page, heading), 'the band of light crosses the word').toBeGreaterThanOrEqual(30);
  await sweep(heading, 120 + 1499);
  expect(await headingTint(page, heading), 'last frame is plain text').toBeLessThanOrEqual(14);
  await sweep(heading, 'finish');
  await expect(page.locator('html')).toHaveAttribute('data-heading-lit', '');
  await expect.poll(() => heading.evaluate((element) => getComputedStyle(element).webkitTextFillColor === getComputedStyle(element).color)).toBe(true);
});

test('after the Trade sweep, other page titles stay unanimated and Trade stays plain', async ({ page }) => {
  await open(page);
  await setLab(page, { path: '/trade' });
  await sweep(page.locator('.trade-page-heading h1'), 'finish');
  await expect(page.locator('html')).toHaveAttribute('data-heading-lit', '');
  for (const path of ['/more', '/history', '/trade']) {
    await setLab(page, { path });
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeAttached();
    if (path === '/trade') {
      await expect(heading).toBeVisible();
      await expect(heading).not.toHaveClass(/\bsr-only\b/);
      expect(await headingTint(page, heading)).toBeLessThanOrEqual(14);
    } else {
      await expect(heading).toHaveClass(/\bsr-only\b/);
    }
    expect(await heading.evaluate((element) => element.getAnimations().length), `${path} heading is still`).toBe(0);
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-heading-lit', '');
  await setLab(page, { path: '/trade' });
  expect(await page.locator('.trade-page-heading h1').evaluate((element) => element.getAnimations().length)).toBe(0);
});

test('a route heading is never inside the route fade; heading-less content still fades in', async ({ page }) => {
  await open(page);
  const fadingAncestors = (selector: string) => page.locator(selector).evaluate((element) => {
    const names: string[] = [];
    for (let node: Element | null = element; node && !node.classList.contains('app-content'); node = node.parentElement) {
      for (const animation of node.getAnimations()) names.push((animation as CSSAnimation).animationName);
    }
    return names.filter((name) => name === 'route-in');
  });
  expect(await fadingAncestors('[data-route="/portfolio"] h1.sr-only')).toEqual([]);
  await setLab(page, { path: '/trade' });
  expect(await fadingAncestors('.trade-page-heading h1')).toEqual([]);
  await setLab(page, { path: '/history' });
  expect(await fadingAncestors('#main-content > h1.sr-only')).toEqual([]);
  // History's feed, below its heading, still arrives with the route fade.
  expect(await page.locator('.app-content > :not(.sr-only)').first().evaluate((element) => element.getAnimations().map((animation) => (animation as CSSAnimation).animationName))).toContain('route-in');
});

test('reduced motion shows plain headings with no sweep and a still canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await setLab(page, { path: '/trade' });
  const heading = page.locator('.trade-page-heading h1');
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(await heading.evaluate((element) => getComputedStyle(element).webkitTextFillColor === getComputedStyle(element).color)).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => /^canvas-drift-/.test((animation as CSSAnimation).animationName)).length)).toBe(0);
});

/** Play states of the two drifting canvas lights (body::before/::after). */
async function canvasStates(page: Page) {
  return page.evaluate(() => document.getAnimations()
    .filter((animation) => /^canvas-drift-/.test((animation as CSSAnimation).animationName))
    .map((animation) => animation.playState));
}

test('the canvas drifts, and holds still under a sheet or review and while the page is hidden', async ({ page }) => {
  await open(page);
  await expect.poll(() => canvasStates(page)).toEqual(['running', 'running']);
  for (const overlay of ['dialog', 'review'] as const) {
    await setLab(page, { overlay });
    await expect.poll(() => canvasStates(page), `${overlay} pauses the canvas`).toEqual(['paused', 'paused']);
    await setLab(page, { overlay: 'none' });
    await expect.poll(() => canvasStates(page), `${overlay} closed resumes it`).toEqual(['running', 'running']);
  }
  const setVisibility = (state: 'hidden' | 'visible') => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await expect.poll(() => canvasStates(page)).toEqual(['paused', 'paused']);
  await setVisibility('visible');
  await expect.poll(() => canvasStates(page)).toEqual(['running', 'running']);
});

test('with data saver on, the canvas stays still from the first paint', async ({ page }) => {
  await open(page, { initScript: "Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:true,addEventListener(){}}})" });
  await expect(page.locator('html')).toHaveAttribute('data-save-data', '');
  expect(await canvasStates(page)).toEqual([]);
});

test('More keeps its rows in four pairs and marks only external rows', async ({ page }) => {
  await open(page);
  await setLab(page, { path: '/more', wallet: STATES[2][1] });
  const groups = await page.locator('main section').evaluateAll((sections) => sections.map((section) => ({
    rows: [...section.querySelectorAll('a, button')].map((row) => ({
      title: row.querySelector('strong')?.textContent ?? '',
      described: Boolean(row.querySelector('small')),
      external: row.getAttribute('target') === '_blank',
      leaveIcon: Boolean(row.querySelector('.lucide-external-link')),
    })),
  })));
  expect(groups).toHaveLength(4);
  for (const group of groups) {
    expect(group.rows, 'each group holds two rows').toHaveLength(2);
    for (const row of group.rows) {
      expect(row.title.trim().length, 'every row has a visible name').toBeGreaterThan(0);
      expect(row.leaveIcon, `${row.title}: the leave-the-app icon marks external rows only`).toBe(row.external);
    }
    expect(new Set(group.rows.map((row) => row.described)).size, 'a pair describes both rows or neither').toBe(1);
  }
  const docs = page.getByRole('link', { name: 'Protocol docs How the protocol works (opens in a new tab)', exact: true });
  await expect(docs).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Borrow fxUSD Manage collateral and debt', exact: true })).toHaveAttribute('href', '/borrow');
});

test('the account card holds its loaded shape while the wallet starts, in More and Settings', async ({ page }) => {
  await open(page);
  for (const path of ['/more', '/settings']) {
    await setLab(page, { path, wallet: STATES[0][1] });
    const loading = page.getByRole('status', { name: 'Loading account' });
    await expect(loading).toBeVisible();
    const avatarRadius = await loading.locator('.skeleton').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderRadius, width: element.getBoundingClientRect().width };
    });
    expect(avatarRadius).toEqual({ radius: '50%', width: 40 });
    const loadingHeight = (await loading.boundingBox())!.height;
    await setLab(page, { wallet: STATES[2][1] });
    const card = page.getByRole('button', { name: 'View connected account' });
    await expect(card).toBeVisible();
    expect(Math.abs((await card.boundingBox())!.height - loadingHeight), `${path} account card keeps its height`).toBeLessThanOrEqual(1);
  }
});

test('docs search results stay in the app with an arrow; only links that leave carry the leave mark', async ({ page }) => {
  await open(page);
  await setLab(page, { path: '/docs' });
  const nav = page.getByRole('navigation', { name: 'Pages', exact: true });
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search docs' });
  await search.fill('wallet');
  await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
  const results = nav.getByRole('link');
  await expect(results.first()).toBeVisible();
  expect(await results.evaluateAll((links) => links.filter((link) => link.querySelector('.lucide-arrow-up-right')).length)).toBe(0);
  expect(await results.evaluateAll((links) => links.every((link) => !link.getAttribute('target')))).toBe(true);
  await page.getByRole('button', { name: 'More documentation options', exact: true }).click();
  const options = page.getByRole('navigation', { name: 'Documentation options', exact: true });
  await expect(options).toBeVisible();
  const leaving = options.locator('a[target="_blank"]');
  expect(await leaving.count()).toBeGreaterThan(0);
  for (const link of await leaving.all()) {
    await expect(link.locator('.lucide-arrow-up-right')).toHaveCount(1);
    await expect(link).toContainText('(opens in a new tab)');
  }
  await expect(options.getByRole('link', { name: 'Open app', exact: true })).toHaveAttribute('href', '/');
  await expect(options.getByRole('link', { name: 'Open app', exact: true })).not.toHaveAttribute('target', '_blank');
});

test('sign-in, not-found and error screens scroll from their top when they do not fit, and lead back to Portfolio', async ({ page }) => {
  await open(page, { width: 568, height: 320 });
  const stages = [['/missing', 'link', 'Back to Portfolio'], ['/error', 'button', 'Try again'], ['/login', 'button', 'Connect wallet']] as const;
  for (const [path, role, action] of stages) {
    await setLab(page, { path, wallet: STATES[1][1] });
    const stage = page.locator('main.utility-stage');
    await expect(stage).toBeVisible();
    const geometry = await stage.evaluate((element) => ({
      firstTop: element.firstElementChild!.getBoundingClientRect().top,
      stageTop: element.getBoundingClientRect().top,
      overflowY: getComputedStyle(element).overflowY,
      zIndex: getComputedStyle(element).zIndex,
    }));
    expect(geometry.firstTop, `${path} is not cut off above`).toBeGreaterThanOrEqual(geometry.stageTop);
    expect(geometry.overflowY).toBe('auto');
    expect(geometry.zIndex, `${path} paints above the canvas lights`).toBe('1');
    const target = page.getByRole(role, { name: action });
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
    if (path !== '/missing') await expect(page.getByRole('link', { name: 'Back to Portfolio' })).toHaveAttribute('href', '/');
  }
});

/** WCAG contrast of each element's text against what is painted behind it,
 * compositing translucent backgrounds and the element's own opacity. */
async function contrasts(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => {
    const parse = (value: string): number[] => {
      const srgb = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
      if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
      const parts = value.match(/[\d.]+/g)!.map(Number);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const over = (top: number[], bottom: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
    const backdrop = (element: Element | null): number[] => {
      const layers: number[][] = [];
      for (let node = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] >= 1) break;
      }
      return layers.reverse().reduce((base, layer) => over(layer, base), parse(getComputedStyle(document.body).backgroundColor));
    };
    const luminance = (color: number[]) => {
      const [r, g, b] = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return elements.map((element) => {
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const behind = backdrop(element.parentElement?.closest('*') ?? null);
      const own = backdrop(element);
      const text = over(parse(getComputedStyle(element).color), own);
      const [paintedText, paintedBg] = [over([...text.slice(0, 3), opacity], behind), over([...own.slice(0, 3), opacity], behind)];
      const [light, dark] = [luminance(paintedText), luminance(paintedBg)].sort((a, b) => b - a);
      return { text: element.textContent?.trim().slice(0, 40), ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100, opacity };
    });
  });
}

/** Wait out the route fade and theme transitions (finite animations only). */
async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}

test('disabled and busy actions stay readable (AA) and look unavailable, in every theme', async ({ page }) => {
  await open(page);
  await setLab(page, { path: '/controls', wallet: STATES[1][1] });
  await expect(page.getByRole('button', { name: 'Not enough ETH for network fees' })).toBeDisabled();
  for (const theme of ['official', 'dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settle(page);
    const results = await contrasts(page, 'main .button, main button:disabled strong, main label[data-disabled] strong, main label[data-disabled] small');
    expect(results.length).toBeGreaterThanOrEqual(8);
    for (const result of results) expect(result.ratio, `${result.text} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    const unavailable = await page.getByRole('button', { name: 'Not enough ETH for network fees' }).evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--mint)';
      element.parentElement!.append(probe);
      const mint = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { opacity: style.opacity, background: style.backgroundColor, mint, cursor: style.cursor };
    });
    expect(unavailable.opacity).toBe('1');
    expect(unavailable.background, 'a disabled primary action does not look like an accent one').not.toBe(unavailable.mint);
    expect(unavailable.cursor).toBe('not-allowed');
  }
  // The network menu's options wait for a wallet without fading their names.
  await setLab(page, { path: '/portfolio' });
  await page.locator('.network-selector').click();
  await expect(page.locator('.network-selector-menu')).toBeVisible();
  await settle(page);
  const options = await contrasts(page, '.network-selector-menu button[data-network-option]:disabled');
  expect(options).toHaveLength(2);
  for (const option of options) expect(option.ratio, `${option.text} option`).toBeGreaterThanOrEqual(4.5);
});

test('keyboard focus shows one accent ring on the header, dock, rows and choices, and fields use the accent caret', async ({ page }) => {
  await open(page);
  await setLab(page, { path: '/more', wallet: STATES[2][1] });
  await expect(page.getByRole('heading', { level: 1, name: 'More' })).toBeVisible();
  const targets = ['.network-selector', '.theme-toggle', 'nav.mobile-tabbar a[aria-current="page"]', 'main a[href="/history"]'];
  for (const theme of ['official', 'dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settle(page);
    for (const selector of targets) {
      // Focus by keyboard, so :focus-visible applies as it does for a keyboard user.
      await page.locator(selector).first().evaluate((element) => (element as HTMLElement).blur());
      await page.locator(selector).first().focus();
      const ring = await page.locator(selector).first().evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--focus-ring)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(element);
        return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth, expected, visible: element.matches(':focus-visible') };
      });
      expect(ring.visible, `${selector} takes keyboard focus`).toBe(true);
      expect({ color: ring.color, style: ring.style, width: ring.width }, `${selector} ring in ${theme}`).toEqual({ color: ring.expected, style: 'solid', width: '2px' });
    }
  }
  // A choice card rings for keyboard focus on its radio, not for a tap.
  await setLab(page, { path: '/controls' });
  const instant = page.getByRole('radio', { name: 'Instant' });
  await instant.focus();
  const choiceRing = await instant.evaluate((input) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus-ring)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(input.closest('label')!);
    return { color: style.outlineColor, style: style.outlineStyle, expected };
  });
  expect(choiceRing).toEqual({ color: choiceRing.expected, style: 'solid', expected: choiceRing.expected });
  await page.getByText('Queued', { exact: true }).click({ force: true });
  await page.mouse.click(5, 5);
  await page.getByText('Instant', { exact: true }).click();
  expect(await instant.evaluate((input) => getComputedStyle(input.closest('label')!).outlineStyle), 'a tap shows no focus ring').toBe('none');

  await setLab(page, { path: '/docs' });
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search docs' });
  await expect(search).toBeEnabled();
  const caret = await search.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--mint)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { caret: getComputedStyle(element).caretColor, expected };
  });
  expect(caret.caret).toBe(caret.expected);
});

test('History first loads in its own feed layout, and names a wallet provider that never starts', async ({ page }) => {
  await open(page);
  await setLab(page, { readyTimeoutMs: 800, path: '/history', wallet: STATES[0][1] });
  const feed = page.getByRole('region', { name: 'Transaction history' });
  await expect(feed).toBeVisible();
  await expect(feed).toHaveAttribute('aria-busy', 'true');
  // The waiting filters keep their place but take no focus or taps.
  expect(await feed.locator('select, input, button').evaluateAll((controls) => controls.length > 0 && controls.every((control) => control.closest('[inert]')))).toBe(true);
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Wallet provider did not load');
  await expect(feed).toHaveCount(0);
  await setLab(page, { wallet: STATES[1][1] });
  await expect(page.locator('main').getByRole('button', { name: 'Connect wallet' })).toBeVisible();
});

test('the wallet notice offers Retry as a full 44px target without growing past its text', async ({ page }) => {
  await open(page);
  await setLab(page, { path: '/controls', wallet: STATES[1][1] });
  const notice = page.getByRole('alert').filter({ hasText: 'Wallet provider is unavailable.' });
  const retry = notice.getByRole('button', { name: 'Retry wallet provider' });
  await expect(retry).toBeVisible();
  const [button, toast] = [(await retry.boundingBox())!, (await notice.boundingBox())!];
  expect(Math.min(button.width, button.height)).toBeGreaterThanOrEqual(44);
  expect(button.y).toBeGreaterThanOrEqual(toast.y);
  expect(button.y + button.height).toBeLessThanOrEqual(toast.y + toast.height);
  expect(toast.height, 'one line of notice stays compact').toBeLessThanOrEqual(52);
});

/** The shell parts both the first-paint outline and the live shell draw. */
async function shellLayout(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return [box.left, box.top, box.width, box.height].map((value) => Math.round(value));
    };
    const control = '.app-topbar-actions > span:first-child';
    return {
      brand: rect('.app-topbar > a'),
      control: rect(control),
      network: rect(`${control} .network-selector`),
      identity: rect(`${control} > :last-child`),
      // The identity placeholder's shapes: an avatar and an address bar.
      shapes: [...document.querySelectorAll(`${control} > :last-child .skeleton`)].map((shape) => {
        const box = shape.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height].map((value) => Math.round(value));
      }),
      toggle: rect('.app-topbar-actions > button'),
      dock: [...document.querySelectorAll('.tabbar .nav-item-mobile')].map((item) => `${item.textContent}${item.classList.contains('nav-item-active') ? '*' : ''}`),
      heading: rect('.app-content h1'),
    };
  });
}

test('the first-paint outline hands over to the live shell in place, at every phone width', async ({ page }) => {
  await open(page);
  for (const path of ['/portfolio', '/history']) {
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await setLab(page, { path, outline: true, wallet: STATES[0][1] });
      await expect(page.getByRole('status', { name: 'Loading FxAeon' })).toBeVisible();
      const outline = await shellLayout(page);
      await setLab(page, { outline: false });
      await expect(page.locator('header.app-topbar')).toBeVisible();
      const live = await shellLayout(page);
      expect(live, `${path} at ${width}px`).toEqual(outline);
      expect(live.shapes, 'the identity placeholder draws an avatar and an address').toHaveLength(2);
    }
  }
  // History's feed was already drawn by the outline, so it takes its place without fading in again.
  await setLab(page, { path: '/history', outline: true });
  await setLab(page, { outline: false });
  const feed = page.locator('.app-content > :not(.page-header)').first();
  expect(await feed.evaluate((element) => element.getAnimations().map((animation) => (animation as CSSAnimation).animationName))).not.toContain('route-in');
});

test('the dock names Portfolio, matching its page, and every label fits a 320px dock in each theme', async ({ page }) => {
  await open(page, { width: 320, height: 700 });
  await setLab(page, { wallet: STATES[2][1] });
  const nav = page.locator('nav.mobile-tabbar');
  await expect(nav.getByRole('link', { name: 'Portfolio', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  for (const theme of ['official', 'dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const fits = await nav.locator('.nav-item-mobile').evaluateAll((items) => items.map((item) => {
      const label = item.querySelector<HTMLElement>('.nav-label')!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      return { label: label.textContent, spare: box.width - text.width, height: box.height, width: box.width, lines: range.getClientRects().length };
    }));
    for (const item of fits) {
      expect(item.spare, `${item.label} needs breathing room in the ${theme} dock`).toBeGreaterThanOrEqual(8);
      expect(item.lines, `${item.label} stays on one line`).toBe(1);
      expect(Math.min(item.width, item.height)).toBeGreaterThanOrEqual(44);
    }
  }
});
