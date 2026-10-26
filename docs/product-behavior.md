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

## Inputs and previews

A preview describes its matching ticket. Amount, asset, direction, recipient, or wallet changes invalidate it; stale values must not describe a newer intent.

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
collateral valuation or an unverified form limit show “Sensitivity unavailable”
without an invented zero value or risk curve.

Borrow funding history presents the current gross collateral charge per eight
hours first, with annualized APR as secondary context. Historical charges and
their period average use the same eight-hour basis. Short-pool earnings are
not folded into the chart's gross whole-collateral basis; historical values are
not a current quote or an earned return.

## Position rows and units

Portfolio, Trade, and Positions use the same names, units and rows. A row identifies market/side, leverage, position number, value, the debt/equity split, and a display estimate of distance to rebalance when fresh inputs are available.

Phone rows open a position with its details/actions; list navigation and browser/Telegram Back return appropriately. Wide screens keep the list beside selection. A management review remains bound to its selected position.

ETH long pool collateral uses stETH accounting even when backed by wstETH. Reviews preserve native quote values and conversion caveats. The rebalance marker and estimated position value are display context, not liquidation guarantees, P&L, ROI, or transaction authority. See [collateral units](sdk-scope.md#collateral-units) and [position brake](sdk-scope.md#position-brake).

## Review and approval

A product action prepares an explicit review before execution. Accepted routes are bound to current signing inputs and wallet session; expired/changed reviews require refresh and acceptance.

The review leads with amount consequences, then relevant debt/LTV, limits, costs and risk. Contextual information controls explain terms; exact-value controls retain precision and source caveats. Additional contract/request/verification evidence lives in one technical disclosure rather than duplicating decision terms.

Estimates are labelled. Rounded displays and USD equivalents retain appropriate approximation; minimums, accepted amounts and native fee caps remain inspectable. An unknown rate is not 0%, an unavailable fee is not free, and a displayed USD estimate is not a signed limit.

The review checks native funding and names a shortfall before signing; when fully estimated, it can state the ETH to add. Approval requests and protocol actions remain distinct, and multiple wallet requests are disclosed. Every transaction still needs wallet approval.

## Submission, receipts, and recovery

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
