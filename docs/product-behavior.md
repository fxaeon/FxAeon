# Product behavior

This guide describes implemented product behavior. [Architecture](architecture.md) owns the technical boundaries; the [SDK contract](sdk-scope.md) owns the allowed methods and units.

## Product areas

| Area | Behavior and important limits |
| --- | --- |
| Portfolio | Wallet assets, positions and attention items; distinguishes confirmed zero, unavailable data and incomplete valuation |
| Trade | Supported ETH/BTC long/short tickets within live pool limits; matching previews of collateral, debt and applicable protocol fee |
| Positions | Shared rows and position-specific Add, Reduce, Leverage and Close actions; supported long positions can expose borrowing management |
| Borrow | Collateral-first fxUSD borrowing with live limits/LTV, collateral addition, debt repayment and available combined actions |
| Earn | fxSAVE deposits from supported fxUSD/USDC/fxSP paths; direct fxSP redemption without cooldown or queued claim, or fxUSD/USDC withdrawal instantly for the applicable fee or through a fresh on-chain claim after cooldown |
| Move | Reviewed fxUSD/fxSAVE transfers between Ethereum and Base; separate source and destination status |
| Send | Reviewed native/token wallet transfer on a supported network; returned hashes are submitted, not confirmed |
| History | Verified activity plus distinct local drafts and transaction-recovery records |
| Settings and More | Preferences, explicit wallet controls, and access to remaining app areas |

Positions, borrowing, and fxSAVE accounting use Ethereum. Base is a supported bridge network, not a second position or vault ledger.

When disconnected, Portfolio remains a public starting point: it links the four products and shows ETH/BTC market price, 24-hour change, and a 24-hour trend. These market displays are not wallet balances or transaction inputs.

First paint uses that same public presentation while wallet providers initialize.
The account skeleton appears only after an authenticated selected wallet is known;
wallet restoration does not manufacture a connected account or a zero balance.

## Inputs and previews

A preview describes its matching ticket. Amount, asset, direction, recipient, or wallet changes invalidate it; stale values must not describe a newer intent.

Forms use concise outcome labels (Receive, Current → After) without repeating
“estimated”. Approximation marks, freshness checks and the detailed review
remain unchanged; shorter wording does not turn a public quote into a guarantee.

Missing numeric values remain blank, with their metric labels and accessible
status retained. Pending reads may use the existing stable skeleton. Forms and
reviews do not add “Not quoted”, “Live limit unavailable”, or alert icons as
numeric placeholders. Retry controls and actionable transaction blockers remain;
blank values never imply zero or authorize an action that lacks required data.

Trade's split shows debt and the trader's share, with preview context separate from a signed plan. Borrow derives its displayed limit and LTV from supported collateral and pool conditions. Move uses a live estimated receive amount when available; an unavailable quote is not zero.

Amount fields preserve decimal text and token precision. A shortened number is presentation; full values remain reachable directly. USD equivalents use fresh matching display prices and never set transaction amounts or limits.

## Earn history and Borrow scenarios

Earn includes 30- and 90-day views of daily fxSAVE APY reported by DefiLlama.
The displayed average is the arithmetic mean of the visible samples, not a
realized return or earnings forecast. The live APY above the chart remains an
independent f(x) read. Pointer, touch, and keyboard controls expose each sample;
missing days break the line. Unavailable or stale history never blocks the form.
On phones, the deposit or withdrawal form appears before the chart. On desktop,
performance continues directly below the overview while disclosures follow the
form, without forcing both columns to share their upper section's height.

Borrow exposes a collateral-value scenario after valid amounts and a live form
limit are available. Moving the slider changes only the illustration: debt stays
constant while collateral value moves between −30% and +30%. The form limit is a
borrowing guard, not a liquidation threshold. Funding, fees, rebalancing, and
liquidation are excluded. The chart cannot change ticket values or a signed plan.
Empty amounts omit the sensitivity section. Entered amounts with unavailable
collateral valuation or an unverified form limit also omit the illustration,
without an invented zero value or risk curve.

Borrow funding history presents the current gross collateral charge per eight
hours first, with annualized APR as secondary context. Historical charges and
their period average use the same eight-hour basis. Short-pool earnings are
not folded into the chart's gross whole-collateral basis; historical values are
not a current quote or an earned return.

Borrow places the verified state beside its label: “Funding status: ON” or
“Funding status: OFF”. Only ON is red and OFF green; the eight-hour rate remains
separate. Loading or failed reads never imply OFF.

## Position rows and units

Portfolio, Trade, and Positions use the same names, units and rows. A row identifies market/side, leverage, position number, value, the debt/equity split, and a display estimate of distance to rebalance when fresh inputs are available.

Phone rows open a position with its details/actions; list navigation and browser/Telegram Back return appropriately. Wide screens keep the list beside selection. A management review remains bound to its selected position.

ETH long pool collateral uses stETH accounting even when backed by wstETH. Reviews preserve native quote values and conversion caveats. The rebalance marker and estimated position value are display context, not liquidation guarantees, P&L, ROI, or transaction authority. See [collateral units](sdk-scope.md#collateral-units) and [position brake](sdk-scope.md#position-brake). Without a live market quote, the estimated rebalance and liquidation prices name the pool's own price per stETH or WBTC.

A position's estimated PnL is a separate figure: its own labelled column in wide Positions rows and a line under the value on phones, and, with the entry price, in the position's details and an open Portfolio row. Both come from the position's orders on the f(x) index, worked out as the official f(x) app does, and the PnL is taken at the SDK's DEX mid price. They appear only once the index's record matches the position on chain, and say unavailable rather than show a stale figure. Info controls state that the PnL excludes exit costs (closing fee, slippage, network fees) and the fees paid to open. See [position cost basis](sdk-scope.md#position-cost-basis).

## Review and approval

A product action prepares an explicit review before execution. Accepted routes are bound to current signing inputs and wallet session; expired/changed reviews require refresh and acceptance.

The review leads with amount consequences, then relevant debt/LTV, limits, costs and risk. Contextual information controls explain terms; exact-value controls retain precision and source caveats. Additional contract/request/verification evidence lives in one technical disclosure rather than duplicating decision terms.

Estimates are labelled. Rounded displays and USD equivalents retain appropriate approximation; minimums, accepted amounts and native fee caps remain inspectable. An unknown rate is not 0%, an unavailable fee is not free, and a displayed USD estimate is not a signed limit.

The review checks native funding and names a shortfall before signing; when fully estimated, it can state the ETH to add. Approval requests and protocol actions remain distinct, and multiple wallet requests are disclosed. Every transaction still needs wallet approval.

## Submission, receipts, and recovery

Positions confirm after one canonical block: the successful receipt and its
transaction identity are verified, with no wait for two additional blocks.
The result is shown before optional position and wallet refreshes finish.
Bridge destination delivery also requires one canonical destination confirmation,
with the matching message, recipient and amount re-read in its exact block.
Source inclusion alone never proves destination receipt.

Send has a separate wallet-transfer preparation path rather than an added f(x)
SDK method. It rechecks the immutable accepted transfer, network cost, wallet
context, and dispatch ownership before approval. A higher fresh network cost
requires review again. Its completion screen says Submitted and points to
History while confirmation remains unresolved.

A wallet request is not submission. A returned hash is not confirmation. Results use verified receipt data and token movements when available; missing receipt facts stay unavailable.

The next dependent step waits for its verified predecessor. Rejection, revert, timeout, canonical mismatch, or signing-session changes stop progression. Uncertain transactions remain inspectable and do not create an automatic retry/resubmit action.

Drafts restore form values into a fresh review. They contain no executable authority and do not prove a prompt, signature, hash, or receipt. Local and indexed history remain distinct sources.

A bridge source receipt does not establish destination delivery. Move matches the relevant cross-chain events and preserves pending/unverified states until delivery is proven.

## Responsive and accessible behavior

Phone reviews retain reachable decisions above navigation, with internal scrolling where needed. Desktop content can use natural page height. Controls keep complete 44px targets; amount/value disclosures support keyboard and touch, and focus remains visible.

The mobile top bar and bottom navigation remain below 840px. Desktop uses an
icon rail from 840px through 1199px; at 1200px and wider the rail starts
expanded and can collapse to icons, with the choice retained for the session.
On hover-capable desktops, a collapsed rail reveals its labels while the pointer
is over it and returns to the saved state on exit. This temporary reveal overlays
content rather than moving it; keyboard focus can also reveal the labels.
The mobile More directory is a modal menu; its heading is visually hidden but
remains available to assistive technology.

The wallet picker keeps its header and Other wallets action outside the scrolling
wallet list. Compact rows retain at least 44px controls; long detected-wallet
lists scroll independently without hiding the close or catalog entry point.

Layouts must handle short/narrow phones, large integers, long addresses, enlarged text, unavailable data and reduced motion. Test actual control bounds and hit areas as well as rendered appearance. [Browser gates](browser-test-gates.md) document the relevant contracts.

The product uses the current shared dark appearance. Historical light/theme screenshots and older wording are evidence of earlier versions, not supported-current-theme claims.

## Evidence scope

UI fixtures can show deterministic balances and receipts. They do not prove live account state, real authentication, signing, or bridge settlement. Use [testing](testing.md#evidence-boundaries), [security](security.md), and the [release checklist](launch-readiness.md) when assessing a result. Evidence must identify the tested revision and environment.

Earn deposit forms omit the outcome row until a real received-amount estimate is available. A token-only Receive fxSAVE label is not shown; route quotes and reviewed outcomes keep their existing authority.

Earn withdrawals choose a method first: After cooldown, Instant, or direct fxSP. Only Instant offers an fxUSD/USDC receive-asset selector. Cooldown claims use the protocol-determined fxUSD/USDC mix; neither asset is guaranteed to have a positive amount. Direct fxSP redemption has no queued claim. Method changes retain the entered share amount; resumed drafts retain their route semantics. The overview omits the Value per fxSAVE row; APY, vault holdings, connected position value, and Share value history remain.

Earn chart help follows the selected APY or Share value series. Borrow funding history defaults to 1Y and offers 1M, 3M, 6M, 1Y, and All. Its selected-period average is time-weighted over the displayed dates and represents annualized gross collateral cost, not earned yield or a debt APR. Historical observations never substitute for current funding; current status and charges require a fresh live read. Direct Earn redemption omits token-only Receive fxSP when no received-amount estimate is available.

Selecting the already active asset closes its picker without resetting the ticket. Earn Instant receive-asset changes preserve the fxSAVE amount and require a fresh review. Move asset changes retain a custom recipient on the same destination chain while clearing the amount and prior route review; wallet/chain context changes retain their full resets.

## Navigation readiness

The mobile menu is included in the app shell and opens without a separate code
download or loading message. Opening and closing it preserves the mounted form
and its scroll position.

Desktop page gutters are part of the main scroll surface. Clicking either side
of the centered content preserves wheel and keyboard scrolling; sidebar and
modal interactions remain isolated from the page beneath them.

## Estimates before connection

Entering an amount exposes the same available form estimates before wallet
connection. Trade shows execution price, rebalance price (f(x)'s liquidation
brake), liquidation price and protocol fee;
Earn deposits show estimated fxSAVE received; Borrow shows its public collateral,
debt and LTV calculations; canonical Move shows its receive estimate and messaging
fee. Empty or failed quotes never become fabricated amounts or zero balances.
The action remains Connect wallet, without additional preview banners.

Move keeps the receive and fee layout stable while a public quote is pending,
including its initial debounce. Pending figures use quiet placeholders; genuine
failed or expired quotes retain their recovery states. Refresh quote stays
disabled until the pending request resolves. Earn's raw underlying fxSP quantity
is available in Vault details rather than repeated beneath the USD holdings.

Public estimates are display facts only. Trade discards the SDK planner's unsigned
route at an isolated boundary; Earn uses the pool and vault previewDeposit reads;
Move uses the official messaging quote and quoteOFT receipt. These facts cannot
enter an executable review. Connection preserves the entered ticket and requires
fresh account-specific planning and checks. Input edits, expiry and context changes
invalidate estimates. Cooldown withdrawal output remains protocol-determined;
no future payout mix is inferred from the currently selected asset.

## Current Trade funding and historical accounting

Trade reviews show the current eight-hour net collateral funding rate when the
reviewed SDK price sample and both pools' funding inputs are verified. The public
Trade subsection explicitly says Gross funding charge. Reviews omit the rate
when its net value cannot be verified. Neither value is an accrued payment or a fixed future rate.
The row belongs in the cost group, appears once, and expires after 60 seconds.
No funding row is added to position cards.

Long and short pools use different configuration methods. Offset inputs are
pinned to one Ethereum block; net conversion uses the reviewed route's native
SDK price and ETH accounting conversion, never a display-token USD feed.
Negative net funding remains signed. The public reader shares fresh same-pool
requests without extending their original timestamp, and never caches failures.

The official f(x) frontend's Funding History uses indexed CollIndexChanged and
DebtIndexChanged events (debt reductions), valued with their event data. Current
getPosition balances already incorporate index accounting. An additional
current-rate-times-duration subtraction would double-count or misstate costs.
FxAeon does not claim an all-time funding-paid total from those current rates.

## Bounded background reads

Fully verified empty wallets suppress automatic block-triggered position
rediscovery for 15 seconds after a successful read. The next block after that
window refreshes discovery. Occupied, partial, failed and changed-wallet states
retain their prior refresh behavior; manual and post-confirmation reads bypass
the gate. This reduces redundant reads without delaying transaction completion
refreshes.

When a collapsed desktop rail reveals on hover or keyboard focus at wide desktop
sizes, its toggle returns beside the brand to the same coordinates used by the
pinned-expanded rail. The brand and destination icons remain fixed, and transient
reveal does not move content or replace the saved preference. The toggle retains
its 44px target and respects reduced motion.

## Compact review follow-up — 2026-10-27

Transaction review, pending, result, and bridge cards omit the Execution details
disclosure and contract, calldata, nonce, quote payload, and fingerprint rows.
Amounts, recipient, minimum received, fees, risk terms, and wallet signing
progress remain visible. Embedded wallets retain the network fee speed control.

Confirmed receipts retain explorer links and a network fee total that includes
approvals and Base fee components when complete; incomplete fee data stays
explicitly unavailable. Receipt details appear only for additional token
movements not otherwise displayed. Bridge source confirmation remains distinct
from destination delivery, with retry and external tracking available while
delivery is unverified. Simulation keeps its explicit label and has no public
transaction links. Signing-time and destination verification guards are unchanged.

Bridge review presents Recipient beside a right-aligned, directly copyable address.
The compact address copies the full accepted recipient, exposes it in its accessible
name and hover title, and shows a check only after clipboard success. There is no
Show full disclosure or extra address panel.
