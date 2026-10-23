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
    const box = (node: Element | null) => {
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
    };
    const viewport = element.closest('[data-review-viewport]')!;
    return { top: rect.top, bottom: rect.bottom, height: rect.height,
      visibleTop: top, visibleBottom: bottom, bodyScrollTop: body.scrollTop,
      bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight,
      closedBodyFits: body.scrollHeight <= body.clientHeight + 1,
      layout: { viewport: box(viewport), header: box(viewport.querySelector('[data-review-header]')),
        body: box(body), footer: box(footer),
        footerChildren: [...footer.children].map(node => ({ text: (node as HTMLElement).innerText, ...box(node) })),
        bodyChildren: [...body.children].map(node => ({ kind: node.hasAttribute('data-review-essential') ? 'essential'
          : node.hasAttribute('data-review-secondary') ? 'execution-details' : node.getAttribute('role') ?? node.tagName.toLowerCase(), ...box(node) })) },
      terms: [...element.querySelectorAll<HTMLElement>('[data-review-fact]')].map(row => ({ label: row.dataset.reviewFact, text: row.innerText, ...box(row) })),
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

/** The closed review includes its execution-details entry point, not just facts. */
export function expectClosedReviewFits(geometry: Awaited<ReturnType<typeof essentialReviewGeometry>>) {
  expectEssentialReviewFits(geometry);
  expect(geometry.closedBodyFits, 'The complete closed review, including Execution details, must fit without scrolling').toBe(true);
}
