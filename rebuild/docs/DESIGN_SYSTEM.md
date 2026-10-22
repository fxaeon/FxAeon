# FxAeon interface system

Status: first ETH-long slice. Authored for the isolated rebuild on 22 October 2026.
The scope and financial authority are defined in repository `DECISIONS.md`
(D-004–D-006, D-008–D-011, D-014) and `BEHAVIOR_SPEC.md`, with the complete audit
ledgers as annexes. This document describes the replacement interface; it is not
a declaration of parity with the deferred products.

## Product composition

The first interface has two working destinations: **Trade** and **History**.
There are no placeholder navigation items for unimplemented products. The ETH
amount can be edited before a wallet is connected. Connecting never prepares or
signs a transaction automatically.

Desktop composition pairs a quiet market context with a concentrated transaction
ticket. The large heading identifies the long direction. A verified reference
price, collateral/debt units and supported leverage range give the left column
a purpose without inventing a chart. The ticket holds the amount, leverage,
slippage and next action in one stable surface. At phone widths the context
contracts into an asset heading and price row above the same ticket.

The hierarchy is asset and direction → deposit → leverage → review → explicit
wallet confirmation → verified outcome. Copy distinguishes unavailable data,
estimates, exact signing limits and actual receipt facts.

## Palette

Colors are semantic custom properties in `src/ui/styles.css`. Theme changes
call the controller and never alter amount, leverage, slippage or accepted terms.

| Token | Dark | Light | Purpose |
| --- | --- | --- | --- |
| `--page` | `#111510` | `#f3f3ed` | Graphite / warm-white canvas |
| `--surface` | `#1a1e18` | `#fdfdf8` | Main ticket, History and dialogs |
| `--surface-raised` | `#20261e` | `#ecf0e6` | Selected navigation and controls |
| `--surface-inset` | `#12170f` | `#eef1e8` | Amount, exact data and result inset |
| `--text` | `#f1f1e8` | `#202a1c` | Primary information |
| `--muted` | `#a6afa0` | `#5c6955` | Supporting information |
| `--line` | `#343e2e` | `#cbd5c3` | Structural boundaries |
| `--accent` | `#c1e8aa` | `#315d25` | Primary action, selected intent, verified success |
| `--accent-ink` | `#192a12` | `#f7fff0` | Text on primary action |
| `--warning` | `#eac48c` | `#805911` | Expiry and uncertainty |
| `--error` | `#f3aaa0` | `#a33329` | Verified failure and actionable errors |

The green accent is reserved for intention and evidence. Pending transactions
do not receive a success treatment. A persistent simulation/local-fork label
appears in the environment strip and every financial dialog. Synthetic hashes
never link to a public-chain explorer.

## Type, spacing and shapes

The interface uses the operating system's sans-serif stack, with no external
font request. Exact addresses, calldata, nonce and block identity use the local
monospace stack. Numeric readouts use tabular numerals where they help comparison.
The largest desktop heading is approximately 68px; phone uses approximately
31–34px. Supporting text is normally 12px or larger; the smallest environment
and provenance labels are 11px. All type is expressed in rem and can grow with
the user's text preference.

The spacing scale is 4, 8, 12, 16, 20, 24, 28, 32, 40, 48 and 64px. Major desktop
sections have deliberate whitespace; form controls have compact internal
spacing. Corner radii are 10px for controls, 16px for insets and 24px for principal
surfaces. Mobile principal surfaces use 20–22px radii. Dividers carry structure;
small facts do not each get a separate card.

Controls retain at least 44px targets. Main financial actions are at least 48px
high; the ticket action is 54px and modal footer actions are 50px. The layout
allows natural vertical scrolling instead of compressing text or targets to fit
one viewport.

## Brand and icons

The FxAeon mark is original vector source: two cut planes share a diagonal axis.
It is implemented by `FxMark` in `src/ui/icons.tsx` and mirrored as a standalone
asset in `public/brand/fxaeon-mark.svg`. It is newly authored for this rebuild,
not a copied component or a recolored legacy mark. The wordmark remains text.

Interface glyphs are locally authored SVG paths with a consistent 24-unit box,
1.7-unit stroke and rounded joins. The Ethereum diamond identifies ETH; it is
not an additional selectable asset. Wallet choices use a neutral wallet glyph
and adapter-provided local labels. Provider-supplied images and remote icon URLs
are never fetched by the UI.

## Financial presentation

| Fact | Display and authority |
| --- | --- |
| Deposit | Editable native ETH; exact bigint parsing belongs to the domain |
| Balance | Read only from current `MarketFacts`; unavailable is explicit; positive dust does not render as zero |
| Reference price | Only supplied market facts; loading or unavailable when absent; fixture provenance is stated |
| Requested leverage | The user's explicit scaled value |
| Estimated leverage | Accepted plan economics, clearly separated from requested leverage |
| Collateral / debt | Accepted estimates in stETH / fxUSD; no local route calculation |
| Minimum received | Full exact wstETH amount from the accepted plan |
| Fees | Native gas estimate, required wallet balance and protocol fee rates remain separate |
| Unknown impact / risk / fee | `Unavailable`, never a manufactured zero |
| Exact request | Chain, from, to, value in ETH and wei, nonce, gas, fee basis, block and complete calldata |
| Receipt | Actual verified status, network fee, hash and block |
| Position accounting | Verified current accounting when supplied; otherwise syncing/unavailable, never requested leverage relabeled as achieved |

Amounts are formatted with the new domain's integer helpers. The UI does not
convert token units to `Number`. Bigint-derived USD presentation and fee-ratio
formatting preserve scale. Positive sub-display-precision quantities receive a
less-than label. Signed minima and transaction values are rendered in full.

Native ETH is the sole input in this slice. The reviewed route requires no
token approval. External wallets choose gas; the UI labels fee estimates and
does not offer unsupported embedded-wallet fee-tier controls. The three slippage
choices are 0.1%, 0.5% and 1%, within the domain's accepted limit.

## State and recovery language

| State | Interface behavior |
| --- | --- |
| Disconnected | Input remains editable; Connect opens the explicit picker |
| Preparing | Editor stays present; bounded work is announced; Cancel retires preparation |
| Review | Shows accepted terms and their remaining lifetime; separate Confirm in wallet action |
| Expired | Keeps accepted facts visible; Refresh returns to the editor while preparing new terms |
| Checking | Labels final preflight as checking; does not claim the wallet is open |
| Signing | Waits for the selected wallet response; no duplicate action |
| Pending | Shows returned hash and observation action; closing only hides progress |
| Declined | Clear rejection wording and a path back to the editable deposit |
| Reverted | Explicit verified revert and any supplied actual paid gas |
| Unverified | No success/failure assumption; no resend; receipt observation or History |
| Confirmed | Receipt evidence first; accounting can still be syncing |

History is filtered to the currently selected account. A persisted confirmed or
reverted status is labelled as needing verification until checked in the current
session. Receipt checks call the controller; expanding a record never opens a
wallet. There is no Send again control.

## Interaction and accessibility ownership

`App` observes `AppController` through `useSyncExternalStore`. Financial effects,
planning, connection, chain switching, dispatch and receipt checks go through
the controller. Local state covers presentation only: overlay visibility,
connection waiting display, copy feedback and a receipt-check busy label.

There is one dialog layer. Its header and content share a single scrolling
body; its footer actions remain outside that scroll region. This lets the full
review stay reachable when enlarged text makes the header tall. The underlying
application is inert. On open, focus goes to Close; Tab and
Shift+Tab wrap among visible enabled controls. Escape closes an open native
details disclosure before its parent dialog. On dismissal, focus returns to the
recorded opener, with the wallet trigger as a safe fallback if that element no
longer exists. There is no second focus owner behind the dialog.

The UI owns one browser history marker for its active overlay. Browser Back and
Telegram Back dismiss that layer. Dismissing unissued review invokes
`cancelReview`; dismissing submitted progress preserves execution and recovery.
Route navigation remains controller-owned. A pending disconnected-wallet picker
dismissal calls `disconnect` to retire the connection attempt; a late promise
cannot reopen the UI or continue a trade. An existing connected-wallet dialog
offers Disconnect without an implicit wallet replacement.

Clipboard buttons act only on explicit clicks. Failed clipboard access leaves
the exact selectable value visible. Only validated live transaction hashes get
an Etherscan link. `Open in MetaMask` delegates the safe destination to the host
adapter and does not claim a connection.

Safe-area and host content insets are honored. The modal body can scroll on
short screens. Font growth can wrap descriptions, facts and actions. Native
summary controls expose exact details; long addresses and calldata wrap without
horizontal page scrolling. Focus indicators are explicit; disabled states keep
readable text. Forced-color mode retains control boundaries.

Motion is limited to 140–180ms color/opacity/entry transitions. No continuous
decorative animation appears in the financial flow. Reduced motion disables
transitions and entry animation without removing progress information.

## Verification record and boundary

The author ran the new TypeScript check with the provisioned Node 22.23.4
toolchain. Supplemental Chromium 153.0.8010.0 inspection used the loopback
fixture dev build, not public RPC or a real wallet. The 393px synthetic journey
reached a fixture receipt and one scoped History row with one send and no page
errors. The development inspection covered 1440px light desktop, 393px dark
phone, 320×568 dark phone and a 320×360 short viewport. Review axe scans reported
no violations. The initial main-screen scan identified the environment strip
outside a landmark; it now has a named Environment region.

At 200% root text size, the initial 320px interface exposed a price-row overflow
and a review header that left too little scrolling space. The corrected 320×568
light and 320×852 dark runs had a document width of 320px and dialog scroll width
equal to its client width. Both Trade and Review axe scans reported zero
violations. The final 393px run also reported zero violations and no horizontal
overflow. The modal header scrolls with its content, while its footer remains
reachable. PageUp/PageDown adjust requested leverage by one multiple, and the
native range retains its arrow and Home/End behavior.

Keyboard inspection verified the focus trap, Escape closing exact transaction
details without closing the parent, browser Back dismissing an unissued review,
retained amount and restoration to the Review position control. Reduced-motion
inspection reported no dialog animation. The fixture scenarios for wallet
decline, verified revert, pending receipt, unavailable receipt and an uncertain
wallet send each retained the deposit, exposed no resend action and produced no
page errors. These are synthetic interface observations.

Screenshots and fixture assertions establish interface behavior only. They do
not establish real f(x) execution, public-network latency, physical wallet
handoff or native Telegram authentication. The separate integrator gates own
those claims. Checkpoint browser evidence is maintained separately from this
design specification.
