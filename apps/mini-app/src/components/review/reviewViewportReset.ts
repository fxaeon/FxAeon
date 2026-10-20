/** Presentation-only: a new wallet phase starts at its status and accepted amounts. */
export function resetReviewViewport(root: (Pick<HTMLElement, 'querySelectorAll' | 'querySelector'> & Partial<Pick<HTMLElement, 'getBoundingClientRect' | 'scrollIntoView'>>) | null) {
  root?.querySelectorAll<HTMLDetailsElement>('details[data-review-secondary]').forEach(detail => { detail.open = false; });
  const scroller = root?.querySelector<HTMLElement>('[data-review-scroll]');
  if (scroller) scroller.scrollTop = 0;
  // Desktop reviews use document scrolling rather than an inner scroll region.
  if (root?.getBoundingClientRect && root.getBoundingClientRect().top < 0) root.scrollIntoView?.({ block: 'start', behavior: 'auto' });
}
