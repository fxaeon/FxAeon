# Reference direction and visual acceptance

## Evidence and limits

The twenty supplied phone images were inspected directly. All show **Phantom**; ChatGPT is a stated preference for cleanliness, not an image-backed comparison in this upload set. The IDs below are the numeric parts of the uploaded filenames. No private account values, addresses, handles, transaction details, or raw uploaded images are reproduced here or added to the repository.

These are still images, so they establish composition and visible states, not animation timing, gesture behavior, native performance, accessibility, or actual wallet safety. The dimensions and type sizes proposed below are FxAeon design decisions, not measurements inferred from scaled phone captures.

The comparison baseline is the completed first slice in `src/ui/App.tsx`, `src/ui/styles.css`, and `docs/DESIGN_SYSTEM.md`, together with `docs/evidence/checkpoint-trade-dark-desktop.png`, `checkpoint-review-light-320.png`, and the dark/light 200% text captures. The baseline already has a working review, exact transaction values, accessible sheets, and honest receipt states. The next design should retain those behaviors while simplifying its composition.

## What the references establish

| Image IDs | Visible evidence | Adopt for FxAeon | Avoid or qualify |
| --- | --- | --- | --- |
| 25676, 25677 | Compact identity header, pill destinations, large main account metric, flat rounded asset rows, broad section spacing | A quiet app header, one clear primary value, consistent asset/position rows | Collectible and prediction widgets do not establish FxAeon scope. Never transplant private account content. |
| 25678, 25679 | Strong section titles, sparse lists, short supporting lines, selected filter contrast, restrained horizontal cards | Separate route navigation from local filters; give each row a clear name and supporting value | Avoid making every row a bordered card or using carousels for essential transaction information. |
| 25680, 25681 | Focused exploration sheet, clear title, icon-led categories; grouped market cards | A sheet should answer one question and show a short set of meaningful choices | Prediction content, countdowns, and sports visuals are not requirements. |
| 25682 | Wide navigation drawer, dimmed underlying page, primary links above utility links | Compact mobile top navigation plus an explicit menu exposing every other destination | Do not hide critical transaction actions inside the drawer or copy personal profile identity. |
| 25683, 25684, 25685 | One rounded surface per settings group, separators within groups, trailing state/action controls, distinct selection markers | Settings and wallet choices as readable rows with state at the trailing edge; a clear selected wallet | A displayed network or account does not prove support or permission. Preserve explicit selection semantics. |
| 25686, 25687 | Single recovery action in a permission state; network headings and selected radio options | Explain the current limitation briefly, then provide one useful action; align selection controls consistently | Avoid multiple competing recovery CTAs or implying permission was granted by opening another app. |
| 25688, 25690 | Motion preference choices and explanatory two-line settings rows; disabled/active toggles | Support reduced motion; let longer descriptions increase row height naturally | Do not copy clipped descriptions or developer/auto-confirm settings. The motion screen does not prove any easing or duration. |
| 25689 | Sparse utility page, centered own-brand identity, large external-link rows | A concise About/support surface with clearly identified external destinations | Keep the FxAeon mark; do not reproduce Phantom branding. |
| 25692, 25694, 25695 | Large asset title and principal metric, low-noise chart, timeframe strip, persistent contextual actions; alternate metric preserves layout | Stable metric hierarchy, restrained real-data charts where useful, reachable contextual actions | Do not fabricate charts or market data. Social-holder counts and leverage badges are not decoration to borrow. |
| 25693, 25697 | Scrolled asset information and flat history rows with persistent actions | Date-grouped history with outcome, asset, amount, and an inspectable transaction | The compact sticky title visibly overlaps scrolled text in these captures; prevent that artifact with an opaque header region and correct scroll offsets. |

## Owned direction

**Neutral graphite, warm readable text, and one restrained mint accent.** The first slice's green-tinted backgrounds and green muted text should become neutral. Mint should identify the primary action, selected state, or positive semantic result; it should not tint every panel. Error, warning, pending, and uncertainty retain their own clearly named states. Light mode receives equal design attention rather than a simple color inversion.

Use a system-compatible sans-serif stack with familiar proportions. Prefer 16–20px primary row labels, 14–16px secondary text, and larger meaningful monetary values. These are starting tokens, with rem-based scaling and natural wrapping. Keep tabular numerals for financial comparisons. Reserve oversized display copy for the public landing page: the authenticated app should prioritize the user's account, current task, and useful data. The current desktop “Long Ethereum. Your terms.” block is larger than the working app needs.

Use a 4px spacing foundation, typically 16–20px horizontal phone padding and 24–32px between sections. Group related rows on one quiet surface; do not wrap every value in nested bordered panels. Keep borders subtle and limited to structural separation. Prefer 16–24px container radii and pill shapes for genuinely compact controls. Touch targets remain at least 44px; primary actions can be 48–52px tall.

On desktop, a slim persistent rail can expose Portfolio, Trade, Positions, Earn, Borrow, Move, History, and Settings. On phones, a compact identity/header with Portfolio, Trade, and Positions pills plus an explicit menu keeps the main destinations readable. The menu must expose the remaining destinations without ambiguous icons. Active location and browser Back remain reliable. This is an FxAeon navigation choice informed by the reference, not a claim that Phantom has this exact information architecture.

Use one-purpose sheets with a readable title, explicit Close/Back, one scrolling body, and a reachable action footer. Preserve the existing focus trap, background inertness, focus restoration, and native Back handling. Wallet choice should be simple; provider availability and the selected account are distinct. A review sheet keeps exact amount, minimum received, fees, chain, sender, recipient, and uncertainty inspectable without turning the main form into dense explanatory copy.

Motion should explain a state change without delaying it. A restrained 120–180ms opacity/position transition is an authored starting point, not evidence from the still images. Reduced motion removes displacement and nonessential animation. Avoid animated numbers during financial review and avoid success animation before a verified receipt.

## Acceptance criteria

- At 320px and 393px phone widths, tablet, and desktop, both themes present an obvious current route, a readable primary value, and a single main action. No document, panel, or sheet has unintended horizontal overflow.
- At 200% text size, labels and explanations wrap; exact financial values remain complete and inspectable. The sheet body scrolls independently, and its footer neither occludes content nor becomes unreachable. Sticky headers do not overlap scrolled text.
- Settings and asset/history rows use consistent leading icons, text alignment, trailing values/actions, and minimum 44px hit areas. A row's name and state remain understandable without color alone.
- Sheet focus stays inside while open. Escape, Close, browser Back, and Telegram Back dismiss one layer and restore sensible focus. Loading, cancellation, and account changes do not trap a stale overlay.
- Empty, disconnected, pending, rejected, reverted, and uncertain states have distinct authored copy and a relevant next action. A wallet handoff is never presented as a completed connection; a hash is never presented as a verified position.
- Money, dust amounts, negative values, long token names, large position IDs, and transaction details remain legible. Important safety information is not ellipsized. Charts and totals use identified real data or explicit unavailable states.
- Reduced motion, keyboard navigation, accessible names, contrast, axe checks, and visual inspection accompany functional acceptance. Screenshot similarity alone does not establish correctness, native Telegram support, or live wallet reliability.

This direction adopts the references' restraint and clarity while preserving FxAeon's identity and the audited transaction guarantees.
