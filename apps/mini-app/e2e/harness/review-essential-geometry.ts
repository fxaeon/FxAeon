import { expect, type Locator } from '@playwright/test';

/** Measure before any disclosure or scrolling: inspectability is not initial fit. */
export async function essentialReviewGeometry(review: Locator) {
  const essential = review.locator('[data-review-essential]');
  await expect(essential).toHaveCount(1);
  await expect(essential).toBeVisible();
  return essential.evaluate(element => {
    const body = element.closest<HTMLElement>('[data-review-scroll]');
    const footer = element.closest('[data-review-viewport]')?.querySelector('[data-review-actions]');
    if (!body || !footer) throw new Error('Essential review requires its real scrollport and footer');
    const rect = element.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const top = Math.max(bodyRect.top, 0);
    const bottom = Math.min(bodyRect.bottom, footerRect.top, innerHeight);
    return { top: rect.top, bottom: rect.bottom, height: rect.height,
      visibleTop: top, visibleBottom: bottom, bodyScrollTop: body.scrollTop,
      bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight,
      terms: [...element.querySelectorAll<HTMLElement>('[data-review-fact]')].map(row => ({ label: row.dataset.reviewFact, text: row.innerText })),
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      fits: body.scrollTop === 0 && rect.top >= top - 1 && rect.bottom <= bottom + 1 };
  });
}

export function expectEssentialReviewFits(geometry: Awaited<ReturnType<typeof essentialReviewGeometry>>) {
  expect(geometry.bodyScrollTop, 'Review must start at its first terms').toBe(0);
  expect(geometry.horizontalOverflow, 'Essential terms must not clip horizontally').toBeLessThanOrEqual(1);
  expect(geometry.top, 'Essential terms must start inside the visible scrollport').toBeGreaterThanOrEqual(geometry.visibleTop - 1);
  expect(geometry.bottom, 'All essential terms must fit before scrolling or opening details').toBeLessThanOrEqual(geometry.visibleBottom + 1);
}
