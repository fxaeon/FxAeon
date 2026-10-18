/**
 * The position is born: after Trade opens a position, "View position" carries
 * the split chosen on the ticket into the new position's own split bar.
 *
 * The confirmed result draws the chosen split (`data-position-born-source`);
 * the position's page draws its split from the confirmed chain read
 * (`[data-position-details] [data-position-split]`). Both take one view
 * transition name keyed by the position, so the browser moves the one bar into
 * the other while the page crossfades: the animation carries the shape, and
 * the figures that land are the position's own. Without the View Transitions
 * API, under reduced motion, or while the chain has not returned the position
 * yet, the page simply changes.
 */

/** The longest the old frame may hold while the position's page renders. */
export const POSITION_BORN_WAIT_MS = 1_000;
/** The travel, on the app's spring curve (`--ease-spring`). */
export const POSITION_BORN_DURATION_MS = 440;

export type PositionBornMode = 'transition' | 'plain';

/** One transition name per position: "ETH:long:42" becomes "position-born-eth-long-42". */
export function positionBornName(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `position-born-${slug || 'position'}`;
}

/**
 * Carry the bar only where the browser can, motion is welcome, the chosen
 * split is on screen, and the position has been read, so its page has a bar
 * of its own to land on. Anything else is a plain change of page.
 */
export function positionBornMode(input: { supported: boolean; reducedMotion: boolean; readable: boolean; source: boolean }): PositionBornMode {
  return input.supported && !input.reducedMotion && input.readable && input.source ? 'transition' : 'plain';
}

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};
type TransitionDocument = Document & { startViewTransition?: (update: () => Promise<void>) => ViewTransitionLike };

/**
 * The position's split on its own page once that page shows the position:
 * undefined while it is not shown yet, null when it is shown without a split
 * (no read or price to draw it from).
 */
function bornTarget(doc: Document, key: string): HTMLElement | null | undefined {
  const details = doc.querySelector<HTMLElement>(`[data-position-details="${CSS.escape(key)}"]`);
  if (!details || details.getClientRects().length === 0) return undefined;
  const split = details.querySelector<HTMLElement>('[data-position-split]');
  // Compact management intentionally omits the split. Skip the travel instead
  // of animating into an invisible element or delaying the opened card.
  return split && split.getClientRects().length > 0 ? split : null;
}

/**
 * Resolve with the position's split as soon as its page shows it. The app's
 * router renders asynchronously, so this watches the document instead of
 * assuming a render count, and gives up after `waitMs`.
 */
function waitForBornTarget(doc: Document, key: string, waitMs: number): Promise<HTMLElement | null> {
  const view = doc.defaultView ?? window;
  return new Promise((resolve) => {
    let settled = false;
    const observer = new view.MutationObserver(() => check());
    const timer = view.setTimeout(() => finish(null), waitMs);
    function finish(target: HTMLElement | null) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      view.clearTimeout(timer);
      resolve(target);
    }
    function check() {
      const target = bornTarget(doc, key);
      if (target !== undefined) finish(target);
    }
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
    check();
  });
}

/**
 * Times this one transition. The name is keyed by the position, so its rule
 * is added for the transition and removed after it. The result leaves quicker
 * than the position arrives, and the position's details arrive with its page,
 * so the bar is the one thing still moving.
 */
function adoptTravelTiming(doc: Document, name: string): () => void {
  const Sheet = doc.defaultView?.CSSStyleSheet;
  if (!Sheet || !('adoptedStyleSheets' in doc)) return () => undefined;
  try {
    const sheet = new Sheet();
    sheet.replaceSync([
      `::view-transition-group(${name}) { animation-duration: ${POSITION_BORN_DURATION_MS}ms; animation-timing-function: var(--ease-spring); }`,
      '::view-transition-old(root) { animation-duration: var(--dur-fast); }',
      '::view-transition-group(position-focus) { animation-duration: var(--dur-base); }',
    ].join('\n'));
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return () => { doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((item) => item !== sheet); };
  } catch {
    // The default timing still carries the bar.
    return () => undefined;
  }
}

/**
 * Open a position this result just created. `navigate` changes the page (the
 * app router's push); `readable` says whether the confirmed read of the
 * position is already in hand. Returns how the page changed.
 */
export function carryNewPosition({ key, readable, navigate, doc = document, waitMs = POSITION_BORN_WAIT_MS }: {
  key: string;
  readable: boolean;
  navigate: () => void;
  doc?: Document;
  waitMs?: number;
}): PositionBornMode {
  const transitionDoc = doc as TransitionDocument;
  const source = doc.querySelector<HTMLElement>(`[data-position-born-source="${CSS.escape(key)}"]`);
  const mode = positionBornMode({
    supported: typeof transitionDoc.startViewTransition === 'function',
    reducedMotion: Boolean(doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
    readable,
    source: Boolean(source),
  });
  if (mode === 'plain' || !source || !transitionDoc.startViewTransition) {
    navigate();
    return 'plain';
  }

  const name = positionBornName(key);
  const removeTiming = adoptTravelTiming(doc, name);
  source.style.viewTransitionName = name;
  let target: HTMLElement | null = null;
  const transition = transitionDoc.startViewTransition(async () => {
    navigate();
    target = await waitForBornTarget(doc, key, waitMs);
    if (target) {
      target.style.viewTransitionName = name;
      // It arrives drawn: the travel is its entrance.
      target.setAttribute('data-born', '');
    } else {
      // Nothing to land on in time: the page changes without the travel.
      transition.skipTransition();
    }
  });
  // A skipped transition rejects `ready`; the page change itself is not affected.
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
  void transition.finished.catch(() => undefined).then(() => {
    source.style.viewTransitionName = '';
    if (target) target.style.viewTransitionName = '';
    removeTiming();
  });
  return 'transition';
}
