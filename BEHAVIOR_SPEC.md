# FxAeon behavior specification

Baseline: [`b69d9ce1`](https://github.com/fxaeon/FxAeon/tree/b69d9ce1be59f982fca3ac43a8b037f7037269d4).
Extracted 22 October 2026. This is the preservation contract for the clean
implementation on `rebuild/fxaeon-foundation-20261022`.

## 1. What constitutes this specification

This document defines the common contracts, state model and interpretation of
the source evidence. **The three complete behavior ledgers below are normative
annexes**, including their exact source paths, test titles/section anchors,
edge cases and evidence limitations. They are part of the specification, not
optional background. Overlapping records deliberately preserve independent
product and security observations; their count is not a feature count.

| Annex | Contents |
| --- | --- |
| [Product behavior ledger](docs/rebuild/product-behaviors.json) | Product contracts, every inventoried product test family, landing assertions, responsive states and documentation conflicts |
| [Security behavior ledger](docs/rebuild/security-behaviors.json) | Wallet authority, exact amounts, all 15 SDK capabilities, reviewed patches, simulation, policy, receipts, recovery and fork proof |
| [Delivery behavior ledger](docs/rebuild/delivery-behaviors.json) | Build, CI, source and bundle gates, fixed-source endpoints, hosting, browser/fork isolation and deployment contracts |
| [Source inventory](docs/rebuild/source-inventory.json) | Baseline hashes, declaration locations and document headings for 243 test files and 46 documents |
| [Product audit](docs/rebuild/audit-product.md), [security audit](docs/rebuild/audit-security.md), [delivery audit](docs/rebuild/audit-delivery.md) | Human-readable evidence analysis and explicit limits of inspection |
| [Baseline execution](docs/rebuild/BASELINE.md) | Commands actually run, results, skipped gates and environment limitations |
| [Audit coverage check](docs/rebuild/audit-coverage.json) | 3,373 overlapping records; all 243 inventoried test files and 46 documents mapped; baseline file hashes unchanged |

Every ledger record has a stable ID, a requirement, evidence, status and
optional qualification. `test-backed` means checked-in assertions encode it;
it does **not** mean a current test ran or a mock proves a real chain/device.
`documented` means the document or inspected gate states it. `gap` identifies
missing or conflicting evidence, not an automatically reproduced defect.
Parameterized titles remain families until a runtime expands them. Four
deliberately vulnerable negative controls are not desired product behavior.

The new parity map must reference individual IDs and named new tests. A blanket
mapping to a smoke test, a screenshot, a test count, or a reviewer's opinion
cannot close financial behavior. Changed visual or implementation-specific
requirements require an explicit decision and replacement acceptance evidence.

## 2. Authority and immutable boundaries

| Required behavior | Source evidence |
| --- | --- |
| The selected user's wallet is the sole signer. No application private keys, delegated signer, server planner, account database or background executor. | `SEC-ARCH-001`, `006`; [architecture: Boundaries](docs/architecture.md), [security](docs/security.md) |
| Browser and Telegram share client-side financial logic. Host detection chooses presentation/adapter, never authentication or signing authority. | `SEC-ARCH-005`; `SEC-TELEGRAM-001`–`004`; `telegram-wallet-host.test.ts`, `telegram.test.ts` |
| Exactly the pinned official SDK surface below plans protocol actions. Canonical read-only enrichment and standard wallet transfers do not expand the protocol planner surface. | `SEC-ARCH-002`–`004`; `scope-contract.test.ts`; [scope lock](fx-scope.lock.json) |
| Ethereum is authoritative for positions, Borrow and Earn. Base is a supported Move/wallet network, not a second position or fxSAVE ledger. | `SEC-ARCH-002`; [architecture: Source of truth](docs/architecture.md) |
| Chain evidence establishes financial state; local storage, indexers and display feeds are hints with distinct provenance. | `SEC-ARCH-004`; `recovery.test.ts`, `receipt-presentation.test.ts`, `wallet-assets.test.ts` |
| Optional gas and landing market-data servers are read-only and bounded to approved upstreams; neither may plan or sign. | Delivery ledger; `apps/landing/test/market-data-server.test.mjs`; `scripts/verify_architecture.contract.test.mjs` |

Unless otherwise qualified, test basenames in this document refer to
`apps/mini-app/test/`; the annexes retain the full unambiguous paths and titles.

### Complete SDK surface

Package `@aladdindao/fx-sdk@1.0.5`; reviewed SDK commit
`53c0b9805a169e75ad375c92c241e1292b66405f`. Capability details and exact
input/output/order/refresh semantics are in `SEC-METHOD-01` through `15`, sourced
from [docs/sdk-scope.md](docs/sdk-scope.md).

| Area | Allowed methods |
| --- | --- |
| Positions / Trade | `getPositions`, `increasePosition`, `reducePosition`, `adjustPositionLeverage` |
| Borrow | `depositAndMint`, `repayAndWithdraw` |
| Move | `getBridgeQuote`, `buildBridgeTx` |
| Earn reads | `getFxSaveBalance`, `getFxSaveConfig`, `getFxSaveRedeemStatus`, `getFxSaveClaimable` |
| Earn actions | `getRedeemTx`, `depositFxSave`, `withdrawFxSave` |

No replacement custom leverage planner, new contract action or hidden server
quote service is authorized by a redesign.

## 3. Money, units and economic meaning

| Required behavior and edge cases | Source evidence |
| --- | --- |
| Parse exact decimal inputs into integer base units. Reject exponents, signs, excess precision, ambiguous separators, non-finite and malformed values. Preserve useful intermediate editing states; invalid pasted replacements must not leave a previous valid spend active. | `SEC-AMOUNT-001`–`003`; `amount.test.ts`, `decimal-input.test.ts` |
| Round spendable amounts down and required costs up. Preserve exact accessible values, positive dust, large integers and signed sub-cent values. Unknown is not zero. | `SEC-AMOUNT-002`, `005`; product amount contracts; `amount-field-render.test.ts`, `missing-value.test.ts` |
| Separate ETH long stETH accounting from wstETH transfer/minimum units. Use a validated live wrapping rate; failed optional reads omit conversion, never assume 1:1. | `SEC-AMOUNT-006`–`007`; `wsteth-rate.test.ts`; product position accounting contracts |
| BTC pool accounting uses 18 decimals, external WBTC transfers use 8; never repair an untrusted display estimate by altering signed amounts. | `SEC-READ-007`, `SEC-GAP-006`; `position-economics.test.ts`, `position-reader.test.ts` |
| fxSAVE wallet shares, fxSP underlying assets/queued shares and fxUSD/USDC claim amounts are distinct. No assumed one-dollar exchange rate. | `SEC-AMOUNT-004`; `fxsave-units.test.ts`, `earn-state.test.ts` |
| Requested leverage, quote-derived leverage and freshly read achieved leverage are different facts. Validate borrowing/exposure independently of the SDK's leverage echo. | `SEC-ECON-001`–`006`; `position-economics.test.ts`, `sdk-position-economics.test.ts` |
| Added capital uses its requested incremental leverage. Reject the debt-free-add sentinel bug; large existing balances cannot hide incorrect tiny changes. True 1x/zero borrow remains zero. | `SEC-ECON-002`, `003`, `005`; same economic suites |
| Economic compatibility uses the reviewed 2% solver allowance and compounded selected slippage against changed exposure, plus bounded native-unit rounding, without widening signed minima. | `SEC-ECON-003`, `006`; exact named cases in security ledger |
| Live price feeds and charts are display-only. Estimated equity is collateral value less debt, not profit, ROI or an invented liquidation metric. | Product portfolio/market-data contracts; [architecture: Source of truth](docs/architecture.md) |

## 4. Review, signing and receipt state machine

The shared lifecycle must represent editing, preparing, cancelled/failed
preparation, accepted review, expired review, wallet request, submitted hash,
confirming, approval-only partial completion, confirmed action, on-chain
revert, uncertain confirmation and post-confirmation synchronization. A
failure does not erase a completed prerequisite. A pending transaction is not
retryable as a new spend.

| Phase | Acceptance contract | Source IDs and tests |
| --- | --- | --- |
| Intent | Bind operation, wallet session, chain, market/side, ID, token, exact amount, leverage, slippage, destination and route choices. Editing signing inputs invalidates acceptance. | `SEC-REVIEW-001`; `action-binding.test.ts` |
| Prepare | One 45-second total deadline for quote and fee work. Cancelling or superseding rejects late results. Keep the editor until essential checks settle. | `SEC-REVIEW-003`; `review-preparation*.test.ts`; `e2e/overlay-specs/review-ready-preflight.spec.ts` |
| Warm reuse | Exact intent, current bounds and wallet must still match; a newer block alone may retain a plan within its original 30-second expiry. Never renew expiry by reuse. | `SEC-REVIEW-004`–`005`; `route-prefetch.test.ts` |
| Validate | Operation-specific destinations/selectors and decoded arguments must match. Exact token/spender/approval/value/nonce; no extra official action merely because its target is known. | `SEC-POLICY-001`–`011`; `plan-security.test.ts`, `action-binding.test.ts` |
| Simulate | Simulate the complete ordered route, including approval-dependent actions. Missing results fail closed. Keep SDK order even if safe preview reads run concurrently. | `SEC-RUN-001`; `runner.test.ts` |
| Accept | Review lasts at most 30 seconds and exposes expected effects, exact spend, enforced minima, network, recipient, fee provenance and exact transaction details. Expiry/change requires refreshed terms and explicit acceptance. | `SEC-REVIEW-001`–`002`; product review contracts; `review-formatting.test.ts` |
| Before every prompt | Recheck session/provider authority, chain, pending nonce, exact policy, gas/funding and fresh simulation. Freeze the accepted route; never silently replace it. | `SEC-RUN-002`, `005`–`006`; wallet boundary suites, `runner.test.ts` |
| Dispatch | One wallet request per step, pinned provider, serialized per wallet. Persist a scoped intent before prompting. UI callback failure cannot break journaling. | `SEC-LOCK-001`–`002`; `SEC-RUN-004`, `007`–`008`; `journal-lock.test.ts` |
| Submitted | Only a returned valid hash establishes submission. Retirement after dispatch preserves the original outcome for the original runner, without replay or publication into a replacement wallet session. | `SEC-WALLET-011`–`012`, `021`–`023`; browser/Privy dispatch tests |
| Included | Verify hash, sender, target, calldata, value, nonce, terminal status and canonical block identity. Reorg/timeout/missing receipt stays unresolved; no automatic replay or next step. | `SEC-RUN-009`–`012`; `recovery.test.ts`, `runner.test.ts` |
| Continue | A dependent step requires the predecessor's verified canonical receipt and fresh preflight. A user may decline the action after approving; retain that partial result honestly. | `SEC-RUN-003`–`007`; `transaction-progress.test.ts` |
| Confirmed | Actual received amounts come from verified logs/transaction data. An approval receipt cannot create a position. Mint identity requires unambiguous reviewed events and current ownership. | `SEC-RECEIPT-001`–`002`; `SEC-MINT-001`–`005`; `confirmed-positions.test.ts` |
| Refresh | Cancel/refetch affected wallet/chain state; coalesce overlapping requests with a trailing refresh. Receipt success remains separate from unavailable post-action accounting. | `SEC-RUN-013`–`014`; `wallet-data-refresh.test.ts`, `confirmed-positions.test.ts` |
| Recover | Local hints are scoped and bounded, never authority. Unknown submissions persist and may be checked again, never blindly resubmitted. Unsigned form drafts contain no executable calldata. | `SEC-RECOVERY-001`–`006`; `history-drafts.test.ts`, `recovery.test.ts` |

At least one canonical confirmation is the existing minimum, not a promise of
irreversible finality. An explicitly configured deeper confirmation depth must
be honored (`SEC-RUN-011`).

## 5. Wallets, Telegram and chain reads

Browser selection resolves to one exact EIP-1193 provider object. Self-reported
names, rdns and icons are not authentication. Ambiguous identities fail closed;
a missing named wallet cannot borrow a generic provider. Connection requests
are single-flight; cancellation, account/chain changes, reconnect and eventless
replacement fence late callbacks. Silent restoration may use only the exact
previously approved account/provider and cannot prompt. Explicit disconnect
retires authority and prevents automatic fallback. See `SEC-WALLET-001`–`016`,
`browser-wagmi-session-owner.test.ts`, `wallet-provider.test.ts`, and mobile
wallet browser tests in the product annex.

Telegram launch payload detection chooses the host. Signed-payload validation
belongs to the configured authentication boundary. Privy readiness/candidate
callbacks are not wallet acceptance. Identity is user-bound and stays in
document memory; logout, disappearance and replacement invalidate dispatch
tickets. A visible wallet modal does not time out while the user is using it.
See `SEC-WALLET-017`–`024`, `SEC-TELEGRAM-001`–`004` and
[wallet ownership](docs/privy-wallet-ownership.md).

Wallet browser handoff preserves a sanitized same-origin route through one
encoding layer while removing Telegram/OAuth credentials, cross-origin targets
and executable schemes. Handoff never equals connection or permission to
resume a transaction. Start parameters can only select fixed allowed screens.
See `SEC-HANDOFF-001`–`003`, `wallet-browser-links.test.ts`,
`wallet-connection-routes.test.ts`, `telegram-start-param.test.ts`.

Every financial RPC endpoint must prove its expected chain before dependent
reads. Wrong, late, failed or aborted proofs cannot publish. Explicit chain
guards make fresh requests; fallback order is bounded and terminal reverts do
not become transport retries. Standard balances are session/chain/address
scoped with 15-second freshness. Claim reads require fresh matching successful
Ethereum state, a 60-second window and 45-second active refresh. Evidence:
`SEC-RPC-001`–`003`, `SEC-READ-008`, `rpc-chain-proof.test.ts`,
`wallet-balance-cache.test.ts`, `wagmi-wallet-queries.test.ts`.

## 6. Product surfaces and state coverage

| Surface | Required behavior and states | Evidence |
| --- | --- | --- |
| Portfolio | Disconnected/editable navigation; wallet initialization timeout; Tokens/DeFi/Activity; loading, verified empty, partial, stale and outage per network. Known holdings remain during refresh. Unpriced positive assets cannot create a zero headline or a misleading complete total. | Product `Portfolio`, `Amounts and display`, `Market data`, `Wallet presentation` groups; `SEC-HISTORY-001` |
| Trade | ETH/BTC long/short, valid collateral choices, exact amount/leverage/slippage, live limits, optional chart, input-keyed preview, Max with actual native gas reserve. Warm quote pending/failure/expiry and cancellation. No fabricated price impact or threshold. | `UXP-C-TRADE-*`; `SEC-POLICY-003`, `SEC-THRESHOLD-001`, `003`; `native-max.test.ts` |
| Positions | All four market groups, canonical ownership/accounting, partial refresh and true empty. Add, reduce, leverage, full close retain ID/side/token intent. Deep links, selected manager, disappeared position, rebalancing/liquidation attention and receipt-sync states. | Product `Positions` group; `SEC-READ-002`–`007`; `position-reader.test.ts`, `direct-position-discovery.test.ts` |
| Borrow | New/existing long positions; deposit/mint/repay/withdraw combinations including valid zero legs. Exact capacity and LTV boundaries; repay approval uses actual fee-adjusted calldata. Missing price/selection cannot silently choose a position. | Product `Borrow` group; `SEC-POLICY-006`–`007`; `borrow-limits.test.ts`, `borrow-position-state.test.ts` |
| Earn | Deposit fxUSD/USDC/fxSP; independent read/error states; fxSAVE shares; explicit instant versus default queued withdrawal; direct fxSP redemption; canonical waiting/claim-ready status; separate fxUSD and USDC receipts. Clock alone never enables claim. | `UXP-C-EARN-*`; `SEC-METHOD-09`–`15`; `earn-state.test.ts`, `fxsave-units.test.ts` |
| Move | Ethereum↔Base fxUSD/fxSAVE; source/destination identity; own/custom recipient; exact min and fee; expired/malformed quote; source prompt/hash/confirmation and separate destination observation/recovery. Expert routes keep their reviewed verification boundary. | Product `Move` group; `SEC-BRIDGE-001`–`010`; `advanced-bridge.test.ts`, `bridge-delivery.test.ts` |
| History | Unsigned drafts, approval-only results, submitted/pending/unknown/reverted/confirmed receipts, exact actual amounts, partial network fees, source-only bridge results and explicit evidence provenance. Bounded pagination; no claim of complete transferred-out position history. | Product `History and receipts` group; `SEC-RECOVERY-*`, `SEC-HISTORY-*`, `SEC-GAP-008` |
| Wallet Send | Exact native transfer or ERC20 transfer, no unnecessary approval; zero/invalid recipient, precision, wrong chain, false token return and known gas shortfall block. Base fees require all components. | `SEC-SEND-001`–`002`; `wallet-send.test.ts` |
| Settings / docs | Validated slippage/fee preferences; legacy appearance migration cannot modify transaction settings. Accessible explanations, current network/asset limitations, no guaranteed-return or false zero-cost claims. | Product `Settings`, `Documentation`, `Theme` groups; `settings.test.ts` |
| Landing | Independent wallet-free build; accurate product/chain/cost claims; fixed-source validated market data; separate freshness and unavailable states; reachable app/Telegram/docs links and responsive navigation. | Product `Landing`/`Landing browser` groups; delivery ledger and all `apps/landing/test` files |

The ledger retains the exact edge cases for each row. A redesign may simplify
navigation or postpone a module at the checkpoint; it must not present an
unimplemented control as functional or quietly drop its safety requirements.

### Earn disclosure that must not be lost

A stable fxSAVE deposit does **not** enforce a final fxSAVE-share minimum.
The SDK route enforces its fxSP floor. Present that distinction explicitly;
selected slippage must not be described as final-share protection. Evidence:
`UXP-C-EARN-013`, `UXP-G-014`, `SEC-POLICY-010`–`011`,
`review-formatting.test.ts` — “stable fxSAVE deposit review discloses the
final-share limitation without claiming selected slippage”.

### Bridge proof that must not be collapsed

Source success requires the reviewed OFT/sender/destination and one matching
OFTSent event. Preserve dust-adjusted actual debit separately from input.
Destination proof requires its matching GUID, OFT, source EID, receiver and
exact amount; removed/ambiguous logs reject. Bounded scan progress is resumable.
A source reorg/revert invalidates cached delivery evidence. Evidence:
`SEC-BRIDGE-005`–`010`, `bridge-proof-journal.test.ts`,
`bridge-result-card.test.ts`, `bridge-delivery.test.ts`.

## 7. Fees and risk presentation

Network gas, native action value, protocol fees, conversion effects and bridge
fees remain separate. Use the actual bound router's raw 1e9 fee ratios; unknown
is not zero. A rate is not an exact fee amount unless its chargeable base is
independently bound. Base totals require execution, L1 data and operator fees.
Fee cache identity includes sender/chain/calldata/value/operation. External
wallets own their gas choice; review estimates cannot silently override it.
Known shortfalls block and round up; incomplete evidence cannot invent an exact
shortfall. Evidence: `SEC-FEE-001`–`008`, `SEC-WALLET-013`,
`protocol-fee-review.test.ts`, `gas-cost.test.ts`, `native-max.test.ts`.

New Trade and new Borrow may show post-action liquidation/rebalance estimates
only with correctly bound live pool inputs and units. Failed optional reads
leave the figure unavailable and do not alter planning. Existing-position
changes need their own proof. Evidence: `SEC-THRESHOLD-001`–`003`,
`liquidation-quote.test.ts`, `position-brake.test.ts`.

## 8. Interaction, accessibility, motion and performance

Required source behaviors include compact controls with 44px targets, review
actions of at least 48px, keyboard operation and visible focus, accessible exact
amounts, 200% text, reduced motion, forced-color compatibility and usable narrow
layouts. No clipping financial facts or shrinking targets to make a screenshot
fit. Phone review/management owns one focus/scroll container; browser/Telegram
Back dismisses the upper surface first and preserves drafts. Resizing must not
destroy an in-progress review. Loading reserves useful space, never animates an
unconfirmed balance into apparent success. Evidence: product `Accessibility`,
`Motion`, `Shell`, `Shell accessibility and layout` groups and exact browser
scenarios, including 320px sweeps and the 279px Trade regression.

The current baseline supports one dark theme; old multi-theme prose is
historical. New theme decisions are allowed by the user, but must be explicit
and tested. Existing 393×852 fit assertions are useful regression evidence,
not a reason to forbid natural scrolling on short/enlarged-text screens.

Existing bundle ceilings are 12 MiB static, 8 MiB raw JS, 3 MiB gzip JS and
2 MiB single JS chunk. They are guardrails, not latency measurements. The
rebuild must define and measure form readiness, critical transfer size and
interaction budgets independently. Existing performance collection scripts do
not prove a speed improvement. Evidence: `UXP-G-008`, delivery ledger,
`scripts/check_bundle_size.mjs`, `e2e/specs/performance-measurement.spec.ts`.

## 9. Reviewed dependency fixes

The complete **30 atomic patch requirements** are `SEC-PATCH-001`–`030`, with
exact installed-file hashes and regression names in the security audit. They
cover short-pool tuple mapping; lossless uint60 packing; diagnostics removal;
chain-bound shared SDK transport; bounded multicall spacing; concurrent pool
reads with deterministic error priority; fee metadata; fail-closed borrow
search; independent economics metadata; BTC leverage-down quote units;
fxSAVE quote metadata/optional previews; Privy fee units; query-string decoder
compatibility; and the braces recursion-depth backport/expiry gate.

The original SDK's 50-call chunks, 500ms cross-call spacing, ordinary 5-second
HTTP timeout, ten-pass/100-sample borrow search and evaluated upper crossing
remain part of the reviewed behavior. Preserve exact minima and calldata;
metadata fixes do not authorize planner changes. Execute replacement tests
against the installed patched ESM and CJS bundles, not a detached imitation.

The braces exception is exact-package/exact-advisory and expires
**2026-11-03T00:00:00Z**. Registry failure is blocking; it cannot become an
assumed clean dependency scan (`SEC-PATCH-024`–`030`).

## 10. Delivery and proof requirements

The delivery annex enumerates all build/CI/hosting/endpoint gates, including
strict typing, scope enforcement, dependency auditing, source and built secret
scans, early per-document CSP, no broad RPC connect schemes, bounded header
length, source-map policy, production-build browser testing and isolated test
fixtures. Existing deployment credentials and protected workflows are not
permission to deploy this rewrite.

Real protocol fork proof must use a disposable local node with a loopback-only
signing adapter. No test may broadcast to a public chain. Full parity requires
the real four-market position lifecycle, existing-ID Borrow changes, full
closes and fxSAVE deposit/instant/direct/queued/claim accounting. Browser proof
must compare the exact displayed bytes with submitted transactions. A mock
wallet or locally deployed fixture is useful deterministic evidence but cannot
stand in for f(x) contracts. See `SEC-FORK-001`–`007`,
`anvil.integration.test.ts`, `earn.anvil.test.ts`, and the procedural
`apps/mini-app/e2e/fork/positions.browser.ts` proof.

Native Telegram authentication, physical wallet handoff and real Base delivery
remain separate evidence requirements. Ethereum fork success cannot close
them. The original tree stays intact until the user's step-5 parity gate passes.

## 11. Conflicts and intentional resolutions

1. **Safety semantics take precedence over stale presentation prose.** Current
   readiness-first review, 30-second exact-input warm reuse and current new-action
   threshold tests are the baseline, with explicit unknown states retained.
2. **Visual freedom is real.** Card radii, borders, navigation grouping and the
   former framework are evidence of old presentation, not immutable financial
   requirements. Replacements need accessible running-app evidence.
3. **Tests are not all behavioral proof.** Source-regex and snapshot-presence
   checks may be replaced with stronger executable assertions over the new app.
   Their intended guarantees remain mapped; do not merely rename old files.
4. **Known limitations stay explicit.** Missing final fxSAVE minimum, BTC reduce
   quote scaling, incomplete historic attribution, unverified devices and the
   missing dark Windows reference cannot be concealed behind new visuals.
5. **Proposals are not existing behavior.** The Telegram admission/billing cap
   document describes a proposal. Do not ship a client counter as enforcement.

Exact conflicts and evidence are all `UXP-G-*`, `SEC-GAP-*` and delivery `gap`
records. Implementation resolutions and scope cuts belong in
[`DECISIONS.md`](DECISIONS.md); unresolved items belong in [`ISSUES.md`](ISSUES.md).

## 12. First vertical-slice acceptance

The checkpoint implements a bounded **new ETH leveraged long**. It must allow
precise input, real SDK planning, policy/economics checks, simulation, accepted
review, selected-wallet signing, canonical receipt verification and scoped
history. It must show cancellation/rejection, expired review, changed wallet,
wrong chain, known insufficient funds, simulation failure, reverted action,
unknown confirmation and unavailable accounting without false success.

The checkpoint does not imply every later module is built or that fork/device
evidence exists. Its report must name the exact tested paths, adapters and
runtime versions, distinguish deterministic fixtures from actual protocol
execution, and stop for the requested user review before expanding scope.
