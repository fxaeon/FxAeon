# FxAeon design contract

FxAeon presents onchain actions as a calm, precise workspace: one decision per surface, numbers as the hero, and blue reserved for intent. Prioritize clear transaction context, readable balances, and obvious next steps over decoration. Light uses a neutral off-white canvas, white cards, and charcoal text. Dark uses a charcoal canvas and neutral raised surfaces. Blue identifies actions, focus, and selected states; avoid cream, purple, and blue-gray surface mixtures. Poppins supplies product text and Manrope supplies headings and figures. Light and Dark are the only appearance choices; the stored official id remains an alias for Light. Portfolio introductions and wallet totals sit directly on the canvas; the market overview and trade form retain separate containers. Avoid colored banner strips, nested decorative cards, and local palettes that override a user's theme.

## Principles

1. **One surface per decision.** Depth comes from tone (`--bg` → `--surface` → `--surface-2` → `--surface-3`), not from boxes nested inside boxes. A raised control inside a card takes the next tone up instead of a border.
2. **Numbers lead.** Amounts and totals are large, tight, and tabular; units, cents, and labels recede.
3. **Blue means intent.** The accent marks the primary action, focus, the active selection, and the market's price line. Long and short use their semantic green and red; success, warning, and danger communicate state only. Token and protocol logos retain their original colors.
4. **Alive, never misleading.** The page canvas stays neutral and still. Controls respond to interaction; figures roll only when their value changes; positions draw their collateral split, Trade shows how leverage divides a position, and Earn illustrates the stability pool's sources. Transaction motion follows actual state and never fakes progress. Reduced motion removes loops, travel, and rolling. The landing hero stays still while later card illustrations may animate.
5. **Honest states.** Unknown, unavailable, or stale data stays distinguishable from zero, and placeholders reserve the final geometry. A placeholder announces what it is waiting for ("Loading fxSAVE APY") and only says "unavailable" once a read has failed.

## Tokens

`apps/mini-app/src/app/globals.css` is the single source of truth for every live token in the Light and Dark themes. `src/lib/theme.ts` only holds the preview and host-chrome colors used by the appearance swatches and Telegram; it never writes tokens inline.

| Group | Tokens | Use |
| --- | --- | --- |
| Surfaces | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--hairline`, `--line` | Canvas, cards, inner panels, selected and pressed states, optional separators |
| Text | `--text`, `--mut`, `--mut-2` | Primary, secondary (≥5.5:1), tertiary (≥4.5:1) on `--surface` and `--surface-2` in every theme |
| Intent | `--mint` (the accent, blue), `--mint-bright`, `--mint-dim`, `--on-accent` | Primary action, focus, active selection |
| State | `--success`, `--warn`, `--danger` and their `-dim` tints; `--long`, `--short` | Status and position side only |
| Overlay | `--scrim`, `--glass`, `--glass-strong`, `--elevation-1/2`, `--ring-inset` | Sheets, the navigation dock, floating panels |

Type follows one scale: `--fs-micro` 11, `--fs-caption` 12, `--fs-small` 13, `--fs-body` 15, `--fs-title` 17, `--fs-heading` 22, `--fs-display` 28, `--fs-amount` 38, and `--fs-hero` 44 (px). Inter with tabular figures; large figures use weight 500–600 with `--tracking-figure`.

Geometry uses the 4px rhythm and `--radius-xs` 8, `--radius-sm` 12, `--radius-md` 16 (amount panels, inner tiles), `--radius-lg` 24 (cards), and `--radius-xl` 28 (sheets, hero). Controls keep at least a 44px target; primary actions are 52px. Preserve visible keyboard focus and contrast in every theme.

| Role | Contract |
| --- | --- |
| Related controls | 8–10px gap |
| Cards | 16–20px padding; 24px radius |
| Position rows | No box, border or radius, inside or out: lists are ruled stacks with full-width hairlines (`--line`) between rows. A row is one compact unit: token, market and side in its color, leverage and ID muted, the value as the hero at the right, then the split bar and its one-line brake. A selected row takes a mint tint with an accent edge; a row at its rebalance point stands out by its warning line. The other figures (collateral, debt, market price, debt / collateral) are in the position's details, a plain two-column list one tap away |
| Sections | 18–20px separation |
| Segmented controls | Tinted container with a sliding thumb (`data-thumb`, `--seg-index`, `--seg-count`) |
| Navigation | Floating dock on phones whose highlight travels between routes; pill navigation on desktop |
| Charts | One 2px accent line over a fading fill, no grid, recessive axes; a crosshair reads exact values. Axis and crosshair times are in the viewer's time zone. Candlesticks stay one tap away. Sparklines take the direction color of their 24h change and draw in once |
| Headline figures | Portfolio and wallet totals stand on the canvas without a card at the landing's headline scale (40–60px, tight tracking): label, figure, actions directly beneath, a slow light behind the figure. Yields are figures too, never badges |
| Route headings | Arrive lit: one band of accent light crosses the word once, leaving plain text. Reduced motion and forced colors show plain text |
| Mechanics | Explainers are arithmetic on a stated premise or documented f(x) Protocol mechanics, never live-looking invented data: a position row's split bar is drawn from the position's on-chain debt ratio, moved with the live quote, with a line at its pool's live rebalance point (liquidation fainter) and one plain line saying how far the market can move before it (≈, rounded toward safety); when that read is unavailable the bar falls back to the position's displayed collateral and debt values without markers. Trade's leverage split shows the borrowed share at 2× and 3× before fees, (L − 1) / L for a long and L / (L + 1) for a short, for the ticket's own side (the pool's live range stays in the Leverage stat); the ticket's leverage slider is that split at the chosen leverage: its track is the position's value, the thumb sits where the debt ends, hairline ticks mark whole × (hidden beside the thumb), and leverage outside the pool's range lies on thinned, dimmed ends; Earn's yield flow names the stability pool's documented sources. Their motion draws in once or runs only while on screen; the brake fill eases between quotes. Reviews do not yet show post-action rebalance or liquidation prices |
| Primary actions | Name what is still missing ("Enter an amount", "Borrow at most 0.6032 fxUSD") instead of sitting silently disabled. Enabled ones lift and catch one sheen on hover and compress on press |
| Settings | One gear per action card, at the right of its first row; quiet at the defaults, with a chip once something differs. Slippage presets plus a custom value up to 2%, and network speed; changes save at once for every open form |
| Page continuation | After the main action a page keeps going: live facts, how it works, questions, and risk notes, written from reviewed Docs and protocol copy and centered to the action's measure. Section titles carry no eyebrow; they are large and read into light word by word as they scroll up, as on the landing. Facts are borderless figures under a hairline |

## Motion

| Tier | Tokens | Use |
| --- | --- | --- |
| Press | `--dur-press` 90ms | Compress on press (`scale(.97–.98)`), release on `--ease-spring` |
| Feedback | `--dur-fast` 140ms | Color, hover, chevrons |
| Content | `--dur-base` 220ms, `--ease-out` | Disclosures, status changes, route fades |
| Spatial | `--dur-slow` 340ms, `--ease-spring` | Thumbs, the dock highlight, the result mark |
| Sheets | `--dur-sheet` 420ms, `--ease-sheet` | Bottom sheets and anchored panels |

Exits are faster than entrances. Route content fades in once with opacity only, so tested geometry never shifts and fixed descendants keep their containing block. The living canvas (`body::before/::after`) drifts on 42s and 56s loops with transform only; sections below the main action rise in once as they are scrolled to. Signed out, Portfolio's headline sits over the f(x) split as a horizon: a collateral line drifting over a flat fxUSD floor, moved only by a compositor transform. Related sheet/backdrop and disclosure/chevron effects start together. Transaction motion follows actual state changes, never a timer pretending a transaction progressed: a wallet prompt's status icon breathes only while the wallet waits, and a confirmed receipt draws its check once. Reduced motion removes travel, staggers, and loops.

## Layout baseline

Layouts are fluid at every phone width and height, never tuned to a few devices; check a sweep from 320 to 480px wide (including 412 × 818 Android Chrome) rather than one size. A form's primary action is never hidden behind the tab bar: it rests in the form when its place is on screen and otherwise rides just above the navigation (`StickyAction`). Center a stage only when its content fits, so nothing is stranded above the scroll top. Never hide facts, shrink tap targets, or clip content to fit. Amount fields keep the label and shortcuts above the amount and token, and the available balance beneath the token; the amount figure sizes to its own field width, stepping long exact values down to a 14px floor before they scroll.

## Interaction and content

Show the amount, asset, network, fees, minimum output, and other signing-relevant details before wallet approval. Reviews lead with the amount at stake and name the network; exact route data stays one disclosure away. Before review, Trade's ticket previews the route it has warmed for exactly its current inputs (collateral, debt and protocol fee in the review's own figures, each amount marked "≈"); any change clears the figures at once, and the review still plans, simulates and validates the route itself. One amount keeps one unit across screens: an ETH long's collateral reads in stETH, the unit its pool accounts it in, in the position's details, its reviews and the ticket, while a signed floor stays exact in the token it is signed in (wstETH) with its stETH equivalent muted beneath it. Preserve explicit review and clear pending, success, and error states. A status names the exact request the wallet is showing (for example "Approve fxUSD (step 1 of 2)"). Wherever people verify an address (Receive, the Send review, a connected wallet), show it whole in reading groups of four with the first and last groups emphasized, and keep it copyable as one exact string; shortened forms such as `0x930f…98b9` belong only in compact chrome. Keep confirmation text factual and concise; do not imply an execution, return, endorsement, or protocol guarantee that the app has not established.

History says what each transaction did in plain words ("Swapped FXN + wstETH for ETH"): past tense once it is confirmed, the plain action while it is pending or after it failed. Amounts show five significant digits, truncated, with the exact value in a tooltip and a copyable line in the detail. A token outside FxAeon's canonical list always carries an "Unverified" marker, is never priced, and transactions that only brought such tokens stay behind a "Show unverified" toggle.

Positions on a phone show one view at a time. The list carries no per-row buttons: tapping a row opens that position (one history step) with its details, then its actions (Add · Reduce · Leverage · Close, and Borrow against for a long), then the form directly beneath, so an action sits next to the position it changes. "All positions", browser Back and Telegram Back return to the list where it was left; the row travels into the details with a short view transition, or the views simply swap under reduced motion. Wide screens keep the list beside the selected position and select in place. Portfolio and Trade list the same rows, each opening its position. A position opened on Trade is born in place: its confirmed result says what happened in History's words ("Opened ETH Long", the name its row uses) and draws the split chosen on the ticket as the new row, labelled with its target leverage; "View position" carries that bar into the position's own split, drawn from the confirmed chain read, in one view transition (440ms on `--ease-spring`, the result leaving quicker than the position arrives). Until the chain returns the position, its page shows the receipt's syncing row instead; under reduced motion or without the API the pages simply swap.

Forms keep labels attached to their controls, errors close to the affected field, and the primary action easy to find. A not-yet-actionable primary action reads as neutral, never as a dimmed accent. Disclosures may keep secondary detail collapsed, but their summaries must still communicate the relevant state. Notices show the state they announce. Icons supplement accessible names rather than replacing them.

## Public landing page

The landing page (fxaeon.xyz) uses a continuous neutral canvas, editorial type, and the real product rendered in HTML. Offer explicit Open mini app and Open web app actions. Keep the closing footer as a contained card and describe only supported Trade, Earn, Borrow, Move, and protocol behavior in the Docs' reviewed wording.

| Element | Contract |
| --- | --- |
| Aurora | `aurora.js` draws curtains of light in raw WebGL at a fraction of screen resolution and at most 30 frames a second. They hang high above the hero, dim through the middle of the page, and settle behind the finale. The CSS gradient beneath is the still frame and the fallback. Curtain colors are capped so text keeps WCAG AA on the brightest frame; `scripts/verify_landing_browser.mjs` measures contrast against the painted pixels |
| Phones | HTML screens in the app's Official theme, with a status bar and its tab bar. Illustrations are `role="img"` with labels that call them examples, and contain no controls |
| Chapters | From 960px one pinned phone follows the chapter at the middle of the screen: its screen slides in from the side it comes from and its tab highlight travels. Narrower screens stack a phone inside each chapter |
| How f(x) Protocol works | Borderless scenes, each a headline, the plain mechanism, and an instrument on the aurora: the split (a slider moves ETH ±20% on the stated premise of 1 ETH at 3× and $3,000; readouts are arithmetic), the brake (2×–7× shows the f(x) docs' own price falls to the 88% rebalance and 95% liquidation lines, with the governance caveat), the peg (the documented defenses in order), and the pool (the stability pool's documented yield sources into fxSAVE). Controls exist only when script can drive them |
| What runs when you tap | FxAeon's screens beside the fifteen locked f(x) Protocol SDK methods from `docs/sdk-scope.md`; choosing a screen lights the methods it uses and says which prepare transactions and which read |
| Motion | Arrivals settle within a few seconds. Loops are slow and confined to ambient regions (`data-ambient`). Reduced motion shows every section in place, removes transitions, and holds one aurora frame |
| Policy | No inline styles or scripts, no network requests, no runtime dependencies. States that wait for script are gated on `:root[data-js]`, so the page is complete without it |
