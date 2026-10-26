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
    const viewport = element.closest('[data-review-viewport]')!;
    // Keep this serialized callback self-contained. A named local function
    // makes tsx emit its Node-side __name helper inside the browser callback.
    const boxes = [viewport, viewport.querySelector('[data-review-header]'), body, footer].map(node => {
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
    });
    return { top: rect.top, bottom: rect.bottom, height: rect.height,
      visibleTop: top, visibleBottom: bottom, bodyScrollTop: body.scrollTop,
      bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight,
      closedBodyFits: body.scrollHeight <= body.clientHeight + 1,
      layout: { viewport: boxes[0], header: boxes[1], body: boxes[2], footer: boxes[3],
        footerChildren: [...footer.children].map(node => {
          const bounds = node.getBoundingClientRect();
          return { text: (node as HTMLElement).innerText, top: bounds.top, bottom: bounds.bottom, height: bounds.height };
        }),
        bodyChildren: [...body.children].map(node => {
          const bounds = node.getBoundingClientRect();
          return { kind: node.hasAttribute('data-review-essential') ? 'essential'
            : node.hasAttribute('data-review-secondary') ? 'execution-details' : node.getAttribute('role') ?? node.tagName.toLowerCase(),
            top: bounds.top, bottom: bounds.bottom, height: bounds.height };
        }) },
      terms: [...element.querySelectorAll<HTMLElement>('[data-review-fact]')].map(row => {
        const bounds = row.getBoundingClientRect();
        return { label: row.dataset.reviewFact, text: row.innerText, top: bounds.top, bottom: bounds.bottom, height: bounds.height };
      }),
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

/** The full review includes its notices and action footer, not just facts. */
export function expectClosedReviewFits(geometry: Awaited<ReturnType<typeof essentialReviewGeometry>>) {
  expectEssentialReviewFits(geometry);
  expect(geometry.closedBodyFits, 'The complete review must fit without scrolling').toBe(true);
}
