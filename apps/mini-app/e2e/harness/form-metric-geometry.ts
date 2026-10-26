import { expect, type Locator, type Page } from '@playwright/test';

/** Check real dt/dd rows after their source data has settled. */
export async function expectFormMetricRows(rows: Locator, options: { allowStacked?: boolean } = {}) {
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  const heights: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const geometry = await row.evaluate(element => {
      const label = element.querySelector('dt')!.getBoundingClientRect();
      const value = element.querySelector('dd')!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>('button,summary')].map(control => {
        const box = control.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { width: box.width, height: box.height, minHeight: Number.parseFloat(getComputedStyle(control).minHeight),
          hit: hit === control || Boolean(hit && control.contains(hit)) };
      });
      return { text: element.textContent, labelRight: label.right, valueLeft: value.left, labelBottom: label.bottom, valueTop: value.top, left: rect.left, right: rect.right,
        height: rect.height, overflow: element.scrollWidth - element.clientWidth, controls };
    });
    expect(geometry.labelRight <= geometry.valueLeft + 1 || Boolean(options.allowStacked && geometry.labelBottom <= geometry.valueTop + 1), `Metric labels and values remain separate horizontally or after accessible reflow: ${JSON.stringify(geometry)}`).toBe(true);
    expect(geometry.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.right).toBeLessThanOrEqual(await row.page().evaluate(() => innerWidth) + 1);
    expect(geometry.overflow, 'Wrapped metrics must remain within their row').toBeLessThanOrEqual(1);
    for (const control of geometry.controls) {
      expect(control.width).toBeGreaterThanOrEqual(24);
      expect(control.height).toBeGreaterThanOrEqual(24);
      expect(control.minHeight, 'Global 44px rules must not expand compact inline controls').toBeLessThanOrEqual(24);
      expect(control.hit, 'Compact metric controls retain an unobscured center').toBe(true);
    }
    heights.push(geometry.height);
  }
  return heights;
}

/** Model text enlargement without changing accepted amounts or label content. */
export async function enlargeFormText(page: Page) {
  await page.evaluate(() => {
    const text = [...document.querySelectorAll<HTMLElement>('body *')].filter(element => !element.closest('svg')
      && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      .map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of text) element.style.setProperty('font-size', `${size * 2}px`, 'important');
  });
}
