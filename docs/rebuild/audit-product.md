# Product and UX behavior audit

Baseline: `b69d9ce1be59f982fca3ac43a8b037f7037269d4`. Branch: `rebuild/fxaeon-foundation-20261022`. Audit date: 22 October 2026.

## Result and interpretation

The source contains a much larger preservation surface than six product pages. Transaction review, execution progress, partial outcomes, honest valuation, device navigation, and exact unit presentation are shared product contracts. Replacing their layout must retain those contracts.

`product-behaviors.json` contains **1,754 traceable records**: 266 curated product contracts, 1,410 exact test-declaration scenarios, 44 explicit landing-browser assertions, 16 recorded gaps/conflicts, 17 document dispositions, and one named-suite metadata entry. The curated contracts atomize the highest-risk behaviors; the source-test scenarios provide broader traceability and can overlap intentionally. These counts are **not unique independent features**, passing tests, or a claim that every scenario has run.

Evidence status has a narrow meaning:

- `test-backed`: a checked-in source test or assertion encodes the behavior. This audit did not execute it.
- `documented`: the identified document states the requirement; separate ledger scenarios may cover part of it.
- `gap`: evidence is missing, outdated, contradictory, or requires a separate verification context. A gap is not automatically a reproduced production bug.

Stable IDs beginning `UXP-C-` identify curated contracts; `UXP-T-` are deterministic hashes of the exact test path and title; `UXP-L-` identify landing assertions; `UXP-G-` identify gaps; `UXP-D-` classify documentary authority; `UXP-S-` identifies a named suite group that is not itself an executable case. Reordering source tests does not change hashed IDs. Template titles are preserved literally so parameterized source cases are not silently narrowed to one example. The JSON retains exact filenames, titles, and declaration locations. New tests should map to these IDs even if their implementation changes.

### Review method and limits

Read the product/design documentation and indexed the behavior declarations in 179 product-relevant unit/browser files. Inspected representative assertion bodies for amounts, settings, exact token/accounting units, review structure, fee presentation, claim readiness, state-lab behavior, and the Windows reference guard. The coverage follow-up inspected mobile wallet preflight/cancellation/reconnect assertions, focus and viewport controls, safe handoff links, wallet RPC demand/freshness assertions, and deferred cache-publication cleanup. Reviewed the real-component versus mocked-service boundaries of the shell, Portfolio, position-brake, Trade and state-lab harness builders. Indexed explicit assertions in the standalone landing browser verifier. Source inventory is comprehensive for the selected files; it is not a statement that every line was manually reviewed or every assertion independently verified.

No application code, snapshots, tests, branches or commits were changed by this audit. The integrator owns current baseline execution and final candidate validation. Wallet signer/provider authority, security policy, SDK internals and RPC integrity have separate audit owners. Their user-visible consequences are included here where they affect amounts, recovery or eligibility.

## Critical preservation decisions

### 1. Displayed facts have different sources

Entered amounts, accepted quote estimates, signed minima, verified receipt amounts, and fresh post-transaction position state must stay distinguishable. An estimated receive amount is not evidence of an actual receipt. A requested leverage is not achieved leverage. A confirmed approval is not a completed product action. An outer success status is insufficient without confirmed action evidence.

Retain exact evidence behind compact numbers and expose unavailable states instead of zero. Position/receipt arithmetic must preserve integer and rational precision. BTC pool accounting uses 18 decimals even when external WBTC transfers use 8. ETH long accounting is stETH; new wstETH quote conversion requires a matching validated rate, while a signed minimum remains exact in wstETH. Relevant contracts: `UXP-C-AMOUNT-*`, `UXP-C-POSITION-002`–`005`, `UXP-C-REVIEW-010`–`019`.

### 2. Earn has three distinct share/asset meanings

Wallet holdings and withdrawals use fxSAVE shares. SDK vault assets and queued redemption amounts use fxSP base-pool shares. Queued stablecoin claims may pay fxUSD and/or USDC; both components retain separate amounts and uncertainty. Local elapsed time must never make a claim ready.

**The stable deposit route does not enforce a final fxSAVE received minimum.** Its accepted base-pool floor is a different protection. `review-formatting.test.ts`, “stable fxSAVE deposit review discloses the final-share limitation without claiming selected slippage,” explicitly requires `Final fxSAVE minimum: Not enforced by this route`, keeps `Minimum fxSP`, and rejects both generic selected-slippage copy and `Minimum fxSAVE received`. See `UXP-C-EARN-013` and `UXP-G-014`.

Direct redemption to fxSP is neither queued stablecoin redemption nor instant conversion to a selected stablecoin. Slippage controls must appear only for routes that actually use them. A gas-only preference change must not rewrite an explicitly restored planner tolerance.

### 3. A compact review must retain signing context

Current tests require a side-by-side action identity and accepted amount, a single grouped facts surface, and one technical disclosure. Primary buttons name the next approval or action. Exact approval amounts, recipient, network, enforced minima, fee bounds and required risk facts remain available. “Unavailable” is correct when an impact, fee or threshold has no bound source; inventing `0%` is not acceptable.

The current readiness tests keep the editor visible until route/gas checks settle. The older immediate-opening performance note conflicts with that behavior. Accepted terms stay frozen through wallet requests, expiry requires explicit refreshed acceptance, and cancelling preparation must reject late responses. The action stays reachable while long details scroll inside the owned phone sheet. See `UXP-C-REVIEW-*` and `UXP-G-002`.

### 4. Totals and fees must remain honest

A partial wallet read is not empty. An unpriced positive balance plus an unrelated verified zero must not create a zero total. A newer authoritative zero does clear an older holding. Independent asset-price timestamps cannot inherit freshness from another token. Failed groups keep last-verified data visibly distinct while successful groups advance.

Network fee, native value, protocol fee and bridge fee remain separate. Base fee totals require all execution, L1 data and operator components. The ETH-to-add figure uses the same buffered requirement that prevents signing and rounds upward. A partial fee estimate may prove underfunding without proving the size of the shortfall. External wallets own their gas selection; app fee tiers apply to the embedded-wallet path. See `UXP-C-PORTFOLIO-*` and `UXP-C-FEE-*`.

### 5. Source confirmation and delivery are separate

A Move success screen must retain source submission, source confirmation, destination verification, uncertain states and recovery. Event-derived sent and received amounts must not be replaced by quoted amounts. External delivery-success claims do not bypass local proof. A reverted source clears prior cached destination evidence. Existing Ethereum-only fork records do not prove Base delivery. See `UXP-C-MOVE-*` and `UXP-G-007`.

### 6. Responsive behavior is part of correctness

Retain 44px compact control targets, at least 48px review actions, keyboard navigation, visible single focus rings, 200% text behavior, on-screen keyboard reachability, reduced motion and exact-value access. The 393×852 baseline keeps financial actions above navigation without starting scrolled; shorter or enlarged-text screens may scroll naturally. Narrow sweeps include 320px, with a dedicated 279px Trade regression. A design may not hide facts or shrink touch targets just to fit a screenshot.

Phone managers/reviews need one focus/scroll owner. Browser Back and Telegram Back dismiss the top surface first and preserve drafts/list position. Desktop resize must not destroy an in-progress manager. The current application is dark-only; old appearance preferences migrate without changing transaction settings. See `UXP-C-A11Y-*`, `UXP-C-SHELL-*`, `UXP-C-THEME-*`.

## State inventory for migration

| Surface | States that must survive |
| --- | --- |
| Data fields | Initial loading, verified zero, positive, partial, same-wallet refresh, stale, unavailable, retry, positive dust, signed sub-cent value, very large exact amount |
| Portfolio | Disconnected, wallet initializing/timeout, Tokens/DeFi/Activity, per-network loading/empty/failure, unpriced holding, one-cent total, retained verified snapshot, account change |
| Trade | ETH/BTC × long/short, disconnected editable form, optional mobile chart, expanded chart, invalid/empty leverage, tightened live bounds, warm preview pending/success/failure/expired, Max pending/cancel/error |
| Positions | Loading, verified empty, full outage, partial groups, stale group, zeroed closed position, selected/deep-linked manager, Add/Reduce/Leverage/Close, vanished position, confirmed receipt syncing, rebalance reached, liquidation reached |
| Borrow | New versus existing position, optional zero leg, collateral-only, borrow-only where valid, repay/withdraw combinations, stale/disappeared selection, capacity exceeded, unknown price, exact LTV boundary |
| Earn | Deposit fxUSD/USDC/fxSP, first-read pending/failure, existing shares, queued/default withdrawal, explicitly chosen Instant, direct fxSP redemption, unknown fee/cooldown, queued waiting, authoritative claim-ready, account-switched stale claim |
| Move | Canonical/custom expert route, source/destination swap, own/custom recipient, invalid recipient, pending/failed/expired quote, unsigned request, source submitted, source confirmed, destination checking/unknown/verified, interrupted/reverted recovery |
| Review/execution | Editing, preparing, cancelled preparation, failed preparation, accepted review, expired/changed quote, fee refresh pending, insufficient gas, wallet request, approval submitted/confirmed, action declined, action submitted, confirmation unknown, on-chain revert, partial completion, confirmed action, post-confirm refresh pending |
| History/receipt | Local resume draft, cancelled draft, pending hash, verified receipt, unverified receipt, approval-only partial route, unknown token, unverified incoming filter, exact receipt quantities, partial Base fees, source-only bridge, simulated fixture |
| Navigation/overlays | Header/menu open, nested settings/token/help panel, keyboard focus trap, outside dismissal, browser Back/Forward, Telegram Back, rapid reopen, route change, desktop resize, reduced motion |

Every row has multiple exact source scenarios in the JSON. This matrix is a migration checklist, not proof of exhaustive cross-product state combinations.

## Known conflicts and verification gaps

### UXP-G-001 — Design specification

Reconcile competing geometry and position-row descriptions before using documentation as a rebuild acceptance contract.

Documentation conflict: DESIGN describes 24px cards and borderless rows; the later product record describes 16px cards, compact rectangles and content-sized phone managers. Preserve financial semantics, use current rendered behavior plus explicit owner direction to settle appearance.

Evidence: `DESIGN.md` — Tokens — Cards / Position rows; `docs/review/reference-led-product-design.md` — Implemented system / Verification contract; `apps/mini-app/e2e/positions-harness/positions-screens.spec.ts` — wide screens show the list first and open management only after selecting a position.

### UXP-G-002 — Transaction review and progress

Resolve the historical immediate-review description against current readiness-first editor behavior.

The dated performance note says Review opens immediately; current tests retain the editor until quote/gas preflight settles. Do not restore the obsolete interaction accidentally.

Evidence: `docs/performance/long-review-preparation.md` — What changes; `docs/review/reference-led-product-design.md` — Implemented system — Preparing a review; `apps/mini-app/e2e/overlay-specs/review-ready-preflight.spec.ts` — quote and gas checks finish before the first review frame.

### UXP-G-003 — Visual regression

Create and review a complete current dark-only state-lab reference set on its pinned Windows environment before claiming its visual-comparison gate passed.

Concrete baseline mismatch: current snapshotNames has 16 entries including amount-theme-dark. Checked-in directory has 17 old entries including official/light and lacks dark. This audit did not generate or approve screenshots. Linux attachment-only behavior does not satisfy Windows comparison.

Evidence: `apps/mini-app/e2e/state-lab/spec.ts` — captures focused components and compares approved Windows references when present; `apps/mini-app/e2e/state-lab/state-lab-snapshots` — checked-in ui-state-amount-theme-official and ui-state-amount-theme-light; required amount-theme-dark is absent.

### UXP-G-004 — Theme

Update test documentation that still advertises official/light/dark UI support.

Documentation lags dark-only production/test behavior. Historical image filenames must not be read as a current supported-theme requirement.

Evidence: `docs/ui-state-lab.md` — catalog coverage / 17 approved references; `docs/browser-test-gates.md` — Light (official) and Dark themes; `docs/testing.md` — Production E2E checks ... Light (official) and Dark; `apps/mini-app/test/theme.test.ts` — light and official preferences migrate to dark while transaction preferences survive.

### UXP-G-005 — Release evidence

Collect baseline/candidate results for the exact rebuild revision instead of adopting historical passing counts.

Old evidence identifies ae59fe1 and d66a7f7, not baseline b69d9ce1. Root integrator owns the current baseline run; this audit did not execute suites.

Evidence: `docs/release-validation.md` — Historical source and test evidence / Release boundary; `docs/review/README.md` — Historical source candidate and validation.

### UXP-G-006 — Telegram

Validate native Telegram sizing, sign-in and real wallet-app return on devices before claiming native coverage.

Coverage limitation, not a detected failure. Browser shims verify app reactions; they do not prove native Telegram or operating-system handoff. Coordinate with wallet/security audit.

Evidence: `docs/testing.md` — No browser emulation establishes native Telegram authentication, wallet handoff; `apps/mini-app/e2e/README.md` — deterministic test shim / suite scope.

### UXP-G-007 — Move

Validate actual Ethereum↔Base delivery separately from Ethereum fork and mocked bridge presentation.

Receipt/event algorithms have source tests, but cited historical fork evidence excludes cross-chain execution. Do not report live delivery proven by UI success fixtures.

Evidence: `docs/release-validation.md` — Local fork verification — no Base bridge delivery; `docs/testing.md` — Protected Ethereum fork tests — Ethereum-only preview; `apps/mini-app/test/bridge-delivery.test.ts` — destination delivery proof requires the same GUID, reviewed OFT, source EID, recipient, and exact amount.

### UXP-G-008 — Performance

Define measured release budgets for production form readiness, review preparation and mobile interaction before claiming the rebuild is faster.

Current helper records timings but does not enforce numeric performance thresholds. Controlled SDK and render measurements are useful but are not physical-device or live-RPC latency budgets.

Evidence: `apps/mini-app/e2e/specs/performance-measurement.spec.ts` — records time from Trade navigation to an editable amount field; `apps/mini-app/e2e/performance-evidence.md` — fixed 125ms/225ms harness waits; no comparable before-change baseline; `apps/mini-app/e2e/performance-evidence.ts` — measureSince / reportPerformanceEvidence.

### UXP-G-009 — Design quality

Inspect actual new phone and desktop renders and task journeys; existing tests do not establish aesthetic superiority or conversion improvement.

Automated containment, contrast and behavior checks do not judge visual craft. Historical captures and generated concepts are not current rendered-product evidence.

Evidence: `docs/review/reference-led-product-design.md` — Professional method / Verification contract; `docs/brand-assets.md` — Screenshots — historical exports.

### UXP-G-010 — Test fidelity

Replace implementation-shape assertions with equivalent meaningful behavior coverage when rebuilding a component rather than blindly preserving old markup.

Several source tests assert regexes over component/CSS source. They document intended behavior but cannot alone prove it survives a new architecture. Ledger notes flag these cases.

Evidence: `apps/mini-app/test/transaction-card-layout.test.ts` — reference review owns a side-by-side identity outside one grouped facts card; `apps/mini-app/test/review-polish.test.ts` — review removes the duplicate stepper but retains approval/action CTA and full approval evidence.

### UXP-G-011 — Trade

Align prefetch documentation with current validated new-block reuse semantics.

Current tests allow a newer-block plan reuse without extending TTL and still require validation/simulation. Dated notes mention changed-block rejection. Do not weaken exact-input/session/bounds checks or resurrect old needless replanning.

Evidence: `docs/frontend-research-jumper-curve.md` — Transfer to FxAeon — route warm-up; `docs/performance/long-review-preparation.md` — Regression coverage — changed-block rejection; `apps/mini-app/test/route-prefetch.test.ts` — a newer block reuses exact input calldata without extending its deadline; `apps/mini-app/e2e/trade-harness/review-preparation.spec.ts` — a new block reuses the warmed plan but still validates and simulates it.

### UXP-G-012 — Positions

Retire dated statements that post-action thresholds are absent after confirming current per-action threshold coverage.

Current source tests cover threshold estimates and explicit unavailable cases; the dated hardening record remains historical. Do not infer every action has a verified numeric threshold merely because a risk row exists.

Evidence: `docs/runtime-hardening-2026-10.md` — Remaining action-specific review gaps; `apps/mini-app/test/liquidation-quote.test.ts` — all four new-position thresholds use actual quote units and the pool liquidation ratio; `apps/mini-app/test/transaction-card-layout.test.ts` — all position and loan reviews retain risk rows without manufacturing prices.

### UXP-G-013 — Landing copy

Reconcile stale landing README descriptions of the removed proof strip and 0% borrowing statement.

Documentation conflict; inspect current source/render before using either historical description as a design instruction. Never add a zero-cost or permanently interest-free claim.

Evidence: `apps/landing/README.md` — Visual and performance notes — proof strip / 0% statement; `docs/review/reference-led-product-design.md` — Implemented system — unused price ticker and separate proof strip removed / no longer markets borrowing with 0%.

### UXP-G-014 — Earn

Clarify documentation whenever a generic SDK minimum could be mistaken for an enforced final fxSAVE minimum.

The enforceable base-pool share floor is distinct from final vault shares; the test explicitly requires Final fxSAVE minimum: Not enforced by this route. Audit ledger UXP-C-EARN-013 records the precise contract.

Evidence: `apps/mini-app/src/app/docs/ProductArticle.tsx` — earn — Deposits use a fixed minimum set by the f(x) SDK; `apps/mini-app/test/review-formatting.test.ts` — stable fxSAVE deposit review discloses the final-share limitation without claiming selected slippage.

### UXP-G-015 — Verification coverage

Preserve required browser harnesses as distinct gates rather than assuming production E2E collects them.

Production E2E, Borrow, Move, Positions, Trade, overlays and state-lab have different entry/config boundaries; a rebuild smoke pass cannot stand in for all of them.

Evidence: `docs/browser-test-gates.md` — Gate table / pnpm test:e2e runs only production export; `docs/testing.md` — Browser checks have separate gates.

### UXP-G-016 — Precision contract

Keep audited unavailable states even when a compact design request suggests displaying 0% by default.

Zero is valid only when supported by accepted route data. Missing impact/fee/threshold evidence must not become an apparent zero to simplify a card.

Evidence: `apps/mini-app/test/transaction-card-layout.test.ts` — all position and loan reviews retain risk rows without manufacturing prices; `apps/mini-app/test/protocol-fee-review.test.ts` — unbound, malformed or missing fee data never becomes a zero-fee claim.

## Documentation coverage

| Source | Review scope and authority |
| --- | --- |
| `README.md`; `apps/mini-app/README.md`; `docs/README.md` | Product scope, route ownership, local draft versus submission distinction, historical document classification |
| `DESIGN.md` | Theme, type, geometry, amounts, review, mobile reachability, motion, landing graphics and data boundaries; conflicts recorded |
| `docs/product-behavior.md` | All product areas, signed/estimated values, gas shortfall, review and compact mobile contract |
| `docs/review/reference-led-product-design.md` | Dated owner-selected refinement direction, dark-only migration, Portfolio hierarchy, sheet ownership, PnL exclusion, landing and verification boundaries |
| `docs/design-critique-2026-10.md` | Scrub readout and ambient pending activity; note explicitly says the recorded fixes shipped |
| `docs/frontend-research-jumper-curve.md`; `docs/frontend-research-uniswap-balancer.md` | Relevant reuse/quote-key/approval/read/freshness comparisons; dated external observations are references, not mandatory borrowed implementations |
| `docs/brand-assets.md`; `docs/landing-art-prompt.md` | Brand/token identity, fonts/assets, historical screenshot and rejected artwork provenance |
| `apps/landing/README.md` | Scenario calculator, same-origin data, freshness, fixed-source API, WebGL budgets/fallback, routes and modal menu; stale descriptions recorded |
| `docs/ui-state-lab.md`; `docs/browser-test-gates.md`; `docs/testing.md`; `apps/mini-app/e2e/README.md` | Gate boundaries, fixture versus production evidence, accessibility/viewports, Windows comparison policy |
| `docs/release-validation.md`; `docs/review/README.md`; `docs/position-screenshot-fixture.md` | Historical revision-specific results, gallery/fork distinctions, Base/native-wallet exclusions |
| `docs/runtime-hardening-2026-10.md` | Product review, receipts, fees, history and known historical gaps; later source supersedes dated statements |
| `docs/performance/market-render-updates.md`; `docs/performance/long-review-preparation.md` | Quote render cadence, controlled evidence, preparation semantics and stale timing claims |
| `apps/mini-app/e2e/performance-evidence.md`; `performance-evidence.ts`; `playwright.performance.config.ts` | Observable timing stages, fixture delays, absence of enforceable latency thresholds and environment limits |
| `apps/mini-app/src/app/docs/ProductArticle.tsx`; `productNavigation.ts`; `page.tsx`; guide route files | Public guidance: networks/assets, trade, leverage risk, positions, Earn units/withdrawal modes, Borrow, Move, fees, history/recovery, privacy and troubleshooting |

SDK, security, wallet-host/ownership/rollout and RPC implementation documents are assigned to the parallel engineering/security audits. Product contracts here link to their observable consequences but do not replace those audits.

### Inventory follow-up: documentary authority

The following 17 records close evidence-path omissions from the initial product/security/delivery union. Their classification is deliberate: a historical research note, proposal, or contribution template is accounted for without promoting it into an executable current product requirement. The security owner separately maps the current wallet ownership and Telegram rollout documents; the delivery owner maps setup, contributing, deployment, launch gates and release records.

| ID and source | Disposition and boundary |
| --- | --- |
| `UXP-D-001` — `.github/ISSUE_TEMPLATE/bug_report.md` — Describe the bug; To Reproduce; Expected behavior; Environment | Contribution template: preserve reproducible bug reports with expected result and device/wallet environment. Reference-only repository workflow; not a runtime application assertion. |
| `UXP-D-002` — `.github/ISSUE_TEMPLATE/feature_request.md` — Is your feature request related to a problem?; Describe the solution you'd like; Describe alternatives you've considered | Contribution template: a feature proposal records the problem, desired behavior and alternatives. Reference-only intake template; filing a proposal does not establish accepted rebuild scope. |
| `UXP-D-003` — `CHANGELOG.md` — [Unreleased]; Historical architecture | Historical change ledger: use entries as pointers to source evidence, with current tests and accepted contracts resolving version conflicts. Historical/reference-only; the unreleased list is not a current executable acceptance report or proof of deployment. |
| `UXP-D-004` — `CODE_OF_CONDUCT.md` — Expected behavior; Scope; Enforcement | Community governance: contributors are expected to give constructive evidence-based feedback and protect private credentials and personal data. Repository/community policy, not a product UI requirement or executable product evidence. |
| `UXP-D-005` — `apps/mini-app/README.md` — Runtime boundary; Routes and transaction records | Current app overview: static app, selected-wallet approvals, route-local input/session-bound reviews, separate resume drafts and submitted records. Supporting current documentation. Atomic current behavior is represented by the Navigation, Review and History contracts; the overview is not independent execution evidence. Native Telegram authentication/handoff explicitly requires separate device testing. |
| `UXP-D-006` — `apps/mini-app/public/wallets/README.md` — Wallet marks; opening paragraphs; Base Square attribution and stable coinbase identity | Wallet marks identify official links or exact announced brands without establishing installation, connection or endorsement; arbitrary extension icon URLs must not be fetched. Current documented identity boundary; dated sources and licensing paragraphs are provenance references. A Base branding asset does not change the stable coinbase provider identity, account or authentication method. |
| `UXP-D-007` — `docs/README.md` — Maintainer guides; Dated records and research | Documentation index: distinguish maintainer contracts from dated research and screenshot evidence from automated gates. Current index and classification guidance. Linked dated records may not reflect later changes; the index itself is not application behavior proof. |
| `UXP-D-008` — `docs/design-critique-2026-10.md` — Since then (introductory paragraph); Critique of FxAeon; Not adopted | Dated design critique records chart-scrub readouts and ambient pending-status improvements as shipped in its accompanying PR. Historical/reference-only. Old table cells labelled Gap are explicitly superseded by the Since then paragraph; do not reopen those as current defects without checking the source. Its rejected count-up balance animation remains relevant rationale. |
| `UXP-D-009` — `docs/frontend-research-uniswap-balancer.md` — Comparison with FxAeon; Architecture limits | Pinned external-source research supplies comparison patterns for exact query identity, review freshness and sequential steps. Historical/reference-only research; do not copy other products' relayers, Permit2, account-abstraction or server RPC architecture into accepted scope. Local source references and timings describe that inspected revision, not current validation. |
| `UXP-D-010` — `docs/landing-art-prompt.md` — FxAeon dimensional mark artwork; Delivered asset paragraph | Historical artwork provenance: the unused dimensional sculpture was removed and does not replace the exact identity mark. Historical/reference-only. Retaining this prompt does not require regenerating or shipping the removed asset; current header/footer/favicon identity uses the vector mark. |
| `UXP-D-011` — `docs/performance/rpc-chain-proof.md` — Scope; Controlled measurement; Safety and tradeoffs | Supporting RPC optimization boundary: reuse explicit endpoint chain proof without caching balances, quotes, nonces, fees, receipts or simulations. Supporting performance/safety design; chain validation and guarded transport tests in the security ledger remain executable authority. Controlled timings and provider-cost scenarios are not a production latency or billing guarantee. |
| `UXP-D-012` — `docs/performance/rpc-demand-scoped-feeds.md` — Subscribe to Base only while its data is displayed; Reproducible comparison; Billing interpretation | Supporting read-demand contract: Base subscriptions follow displayed Base data while manual refresh, receipt invalidation, signing guards and foreground freshness remain intact. Current documented read-only scope, now cross-referenced by UXP-C-RPCB-005. Fixture request counts and billing estimates do not establish live provider costs or relax signing freshness. |
| `UXP-D-013` — `docs/performance/rpc-position-counts.md` — Batch the four initial position ownership counts; Failure behavior; Reproduction and cost scope | Supporting discovery boundary: batching covers only the four initial ownership counts and retains independent malformed/revert fallback plus later owner and count checks. Supporting performance/safety design; relevant discovery/security tests remain executable authority. No signing data is reused; fewer requests are not automatically the same number of saved round trips. |
| `UXP-D-014` — `docs/performance/sdk-pool-read-waterfall.md` — Change and boundary; Regression evidence; State, failures, and residual risks | Supporting SDK optimization boundary: overlap only the three independent pool views, preserving original failure priority and ordered buy/sell calls. Supporting performance/safety design and controlled historical measurement. It discloses absent full success-plan equivalence across every SDK path and no sibling cancellation; those limits cannot become stronger verified claims. |
| `UXP-D-015` — `docs/position-screenshot-fixture.md` — Position screenshot fixture; Regenerate the browser proof and captures | Capture provenance: synthetic display prices/charts must be labelled illustrative, and a screenshot manifest does not independently prove execution. Current documented evidence boundary. Disposable Ethereum-fork browser proof is separate from display-only captures, native wallet testing, Base delivery and production-fund execution. |
| `UXP-D-016` — `docs/privy-telegram-miniapp-audit.md` — Current dashboard and app configuration; What the pinned SDK supports for RPCs; Practical next step | Dated Privy configuration audit and prompt/export investigation are reference evidence for current wallet contracts. Historical/reference-only, dated 3 October 2026; dashboard settings, pinned SDK and commercial/product behavior require separate current verification. Current security ledger ownership/preflight contracts govern acceptance; this document does not prove native Telegram execution. |
| `UXP-D-017` — `docs/wallet-auth-cost-decision.md` — Current published commercial terms; A frontend waitlist cannot enforce provider billing admission; Decision and conditions for implementation | Proposed wallet admission/cost design remains a separate unimplemented backend and commercial decision. Historical/reference-only proposal. Do not infer a working admission limit, free-service guarantee, selected migration, server boundary or current vendor pricing from this dated note. |

## Harness and gate boundaries

| Gate | Product evidence | Limit |
| --- | --- | --- |
| Production Playwright export | Real routing, responsive surfaces, disconnected/fixture-wallet entry, chart interactions, settings, docs, unavailable states | Wallet/RPC configuration and public feeds are deliberately controlled in fixtures |
| Trade harness | Real Trade + review/planner path, warm-up reuse, native Max, fee checks, exact preview and leverage interaction | Read-only mocked RPC/quotes; no real wallet signing |
| Borrow harness | Real selection eligibility, collateral order, zero optional legs, capacity and stale selection | Fixtures control wallet, position and price snapshots |
| Positions harness | Real management/review layout, all four market/side close presentations, receipt-to-position syncing, focus/navigation | Fixtures do not prove chain execution on their own |
| Move harness | Recipient, quote identity/expiry, route direction and execution continuity | Does not prove real cross-chain delivery |
| Overlay harness | Real shell/component styles, overlay lifecycle, Portfolio states, brake display, refresh and retry | Mocked providers/router isolate the visible behavior |
| UI state lab | Real presentation helpers/components, amount states, transaction stages and receipt models, reduced motion | No network/signing; current Windows reference set is incomplete for the dark-only names |
| Standalone landing browser verifier | Real local build, calculator, market fixtures, menu, contrast, width sweep, sculpture pause/fallback and same-origin browser requests | Controlled data; no wallet or protocol transaction |
| Protected Anvil unit/browser proof | Actual SDK operations on a disposable Ethereum fork when explicitly run | Separate credentials/environment; no native Telegram or Base delivery proof |

Reviewed harness boundary sources include `e2e/fixtures/test.ts`, `e2e/harness/app-shell-build.ts`, `portfolio-states-build.ts`, `position-brake-build.ts`, `state-lab-build.mjs`, `ui-state-lab-entry.tsx`, `action-review-measurement-support.ts`, `e2e/trade-harness/long-review-build.cjs`, the focused Playwright configs, and the matching spec files below. Other harness entry files were inventoried with their spec imports; their component behavior is represented by exact spec titles rather than a claim that each mock implementation was fully audited.

The separate `scripts/verify_landing_browser.mjs` contains 44 message-bearing assertions in the JSON. They cover same-origin routing, 44px targets, 320–1440px widths, menu/focus, reduced motion, graphics pause and responsive fallback. The frame-rate and pixel-ratio limits remain documented requirements unless their actual runtime bounds are separately measured.

## Source-inventory closure and added assertions

The combined `product-behaviors.json`, `security-behaviors.json` and `delivery-behaviors.json` evidence paths now account for **243/243 test files and 46/46 documents** in `source-inventory.json`. There are no unmapped inventory files. This is a source-path traceability check, not proof that every assertion was independently reviewed, executed, or preserved in new code. Additional harness/implementation files referenced by the audits can lie outside that inventory.

The final product addition maps all 52 named mobile-wallet declarations (51 tests plus one describe group), all four wallet-RPC browser declarations, and the deferred-query notification test. The delivery owner mapped `apps/mini-app/test/e2e-serve.test.mjs`. Thirty-seven new curated contracts (`UXP-C-MOBILE-*`, `UXP-C-RPCB-*`, `UXP-C-QUERY-*`) record directly inspected assertion behavior and exact titles. The broader `UXP-T-*` rows remain declaration indices, and say so explicitly.

The most consequential assertions are provider identity pinning and same-turn preflight rejection; one shared approval attempt across consumers; cancellation and late-result isolation; stale reconnect/switch reads losing to newer user intent; manual disconnect detaching restore listeners; safe handoff that never claims connection; reachable 44px controls in a 320px short or doubled-text fixture; and query demand/freshness without session leakage. These contracts complement the security owner's signer/SDK/RPC authority review. They do not establish native Telegram device or live wallet-vendor behavior.

The wallet RPC browser suite uses real wallet read/provider/observer/transport code with fixture identity and intercepted RPC responses. It checks call counts and current balance publication. Its seven controlled 40ms-round-trip samples attach a median but assert no production latency ceiling. The deferred-cache unit test checks that synchronous cache callbacks do not publish React-store changes on the same stack, and queued work loses authority after unsubscribe.

## How to use the ledger during the rebuild

Map each curated ID and old source scenario to its retained or replacement test. Preserve user-visible semantics and financial evidence before adopting any new layout. Do not require a new component to retain an obsolete class name merely because an old source-regex test matched it. Conversely, do not remove a financial assertion to make a visual redesign pass. Resolve documentation conflicts explicitly, inspect the candidate renders, then run the relevant production and isolated gates against the same built revision. Report protected/device coverage separately.

## Test-source coverage inventory

| File | Test declarations | Lines |
| --- | ---: | ---: |
| `apps/landing/test/market-data-client.test.mjs` | 3 | 142 |
| `apps/landing/test/market-data-server.test.mjs` | 8 | 197 |
| `apps/landing/test/market-data.test.mjs` | 5 | 93 |
| `apps/landing/test/static.test.mjs` | 12 | 381 |
| `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` | 21 | 541 |
| `apps/mini-app/e2e/move-harness/move-session.spec.ts` | 4 | 179 |
| `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` | 27 | 854 |
| `apps/mini-app/e2e/overlay-specs/compact-mobile-review.spec.ts` | 1 | 112 |
| `apps/mini-app/e2e/overlay-specs/earn-form-consistency.spec.ts` | 18 | 578 |
| `apps/mini-app/e2e/overlay-specs/live-market-store.spec.ts` | 1 | 79 |
| `apps/mini-app/e2e/overlay-specs/move-form.spec.ts` | 2 | 123 |
| `apps/mini-app/e2e/overlay-specs/overlay-lifecycle.spec.ts` | 13 | 261 |
| `apps/mini-app/e2e/overlay-specs/portfolio-assets.spec.ts` | 6 | 130 |
| `apps/mini-app/e2e/overlay-specs/portfolio-loading.spec.ts` | 14 | 424 |
| `apps/mini-app/e2e/overlay-specs/position-brake.spec.ts` | 9 | 275 |
| `apps/mini-app/e2e/overlay-specs/position-provider-retry.spec.ts` | 7 | 171 |
| `apps/mini-app/e2e/overlay-specs/refresh-action.spec.ts` | 3 | 118 |
| `apps/mini-app/e2e/overlay-specs/review-polish.spec.ts` | 4 | 184 |
| `apps/mini-app/e2e/overlay-specs/review-ready-preflight.spec.ts` | 5 | 102 |
| `apps/mini-app/e2e/overlay-specs/transaction-journey.spec.ts` | 2 | 130 |
| `apps/mini-app/e2e/overlay-specs/use-gas-cost.spec.ts` | 3 | 117 |
| `apps/mini-app/e2e/overlay-specs/wallet-asset-details.spec.ts` | 4 | 101 |
| `apps/mini-app/e2e/positions-harness/position-born.spec.ts` | 7 | 339 |
| `apps/mini-app/e2e/positions-harness/positions-review-layout.spec.ts` | 4 | 507 |
| `apps/mini-app/e2e/positions-harness/positions-screens.spec.ts` | 13 | 598 |
| `apps/mini-app/e2e/specs/action-review-harness.spec.ts` | 50 | 1478 |
| `apps/mini-app/e2e/specs/compact-layout.spec.ts` | 3 | 126 |
| `apps/mini-app/e2e/specs/design-system.spec.ts` | 9 | 324 |
| `apps/mini-app/e2e/specs/docs-experience.spec.ts` | 11 | 285 |
| `apps/mini-app/e2e/specs/earn-route-settings.spec.ts` | 4 | 126 |
| `apps/mini-app/e2e/specs/earn-ux.spec.ts` | 6 | 125 |
| `apps/mini-app/e2e/specs/form-help.spec.ts` | 2 | 125 |
| `apps/mini-app/e2e/specs/implementation-regressions.spec.ts` | 7 | 224 |
| `apps/mini-app/e2e/specs/landing.spec.ts` | 3 | 30 |
| `apps/mini-app/e2e/specs/leverage-explainer.spec.ts` | 1 | 40 |
| `apps/mini-app/e2e/specs/mobile-accessibility.spec.ts` | 3 | 63 |
| `apps/mini-app/e2e/specs/mobile-interactions.spec.ts` | 4 | 166 |
| `apps/mini-app/e2e/specs/network-selector.spec.ts` | 10 | 298 |
| `apps/mini-app/e2e/specs/official-routes.spec.ts` | 35 | 794 |
| `apps/mini-app/e2e/specs/performance-measurement.spec.ts` | 2 | 44 |
| `apps/mini-app/e2e/specs/portfolio-hierarchy.spec.ts` | 8 | 341 |
| `apps/mini-app/e2e/specs/price-fallback.spec.ts` | 2 | 68 |
| `apps/mini-app/e2e/specs/product-copy.spec.ts` | 5 | 91 |
| `apps/mini-app/e2e/specs/review-wallet-entry.spec.ts` | 4 | 190 |
| `apps/mini-app/e2e/specs/route-metadata.spec.ts` | 1 | 42 |
| `apps/mini-app/e2e/specs/shell-spacing.spec.ts` | 3 | 156 |
| `apps/mini-app/e2e/specs/unified-product.spec.ts` | 5 | 115 |
| `apps/mini-app/e2e/specs/viewport-contract.spec.ts` | 9 | 568 |
| `apps/mini-app/e2e/specs/wallet-activity-send.spec.ts` | 17 | 503 |
| `apps/mini-app/e2e/state-lab/spec.ts` | 5 | 195 |
| `apps/mini-app/e2e/trade-harness/gas-check-pending.spec.ts` | 6 | 157 |
| `apps/mini-app/e2e/trade-harness/native-max.spec.ts` | 9 | 293 |
| `apps/mini-app/e2e/trade-harness/review-preparation.spec.ts` | 15 | 516 |
| `apps/mini-app/e2e/trade-harness/ticket.spec.ts` | 14 | 488 |
| `apps/mini-app/test/accepted-save-quote.test.ts` | 5 | 134 |
| `apps/mini-app/test/action-review-model.test.ts` | 9 | 94 |
| `apps/mini-app/test/action-review-presentation.test.ts` | 13 | 233 |
| `apps/mini-app/test/activity-calls.test.ts` | 3 | 76 |
| `apps/mini-app/test/activity-classification.test.ts` | 22 | 502 |
| `apps/mini-app/test/activity-receipt.test.ts` | 3 | 28 |
| `apps/mini-app/test/activity-time.test.ts` | 2 | 26 |
| `apps/mini-app/test/address-presentation.test.ts` | 2 | 15 |
| `apps/mini-app/test/advanced-bridge.test.ts` | 11 | 232 |
| `apps/mini-app/test/advanced-review-layout.test.ts` | 4 | 57 |
| `apps/mini-app/test/amount-field-render.test.ts` | 6 | 114 |
| `apps/mini-app/test/amount.test.ts` | 8 | 110 |
| `apps/mini-app/test/anvil.integration.test.ts` | 3 | 842 |
| `apps/mini-app/test/balances.test.ts` | 3 | 48 |
| `apps/mini-app/test/borrow-limit-presentation.test.ts` | 2 | 26 |
| `apps/mini-app/test/borrow-limits.test.ts` | 7 | 81 |
| `apps/mini-app/test/borrow-position-state.test.ts` | 2 | 56 |
| `apps/mini-app/test/bridge-delivery.test.ts` | 8 | 238 |
| `apps/mini-app/test/bridge-destination-label.test.ts` | 4 | 93 |
| `apps/mini-app/test/bridge-preview.test.ts` | 2 | 80 |
| `apps/mini-app/test/bridge-proof-journal.test.ts` | 8 | 196 |
| `apps/mini-app/test/bridge-result-card.test.ts` | 9 | 130 |
| `apps/mini-app/test/bridge-tracker-render.test.ts` | 4 | 43 |
| `apps/mini-app/test/chart-time.test.ts` | 5 | 46 |
| `apps/mini-app/test/coalesced-refresh.test.ts` | 2 | 78 |
| `apps/mini-app/test/coherent-interface.test.ts` | 12 | 204 |
| `apps/mini-app/test/compact-execution.test.ts` | 3 | 21 |
| `apps/mini-app/test/compact-review-valuations.test.ts` | 7 | 84 |
| `apps/mini-app/test/compact-transaction-footer.test.ts` | 16 | 267 |
| `apps/mini-app/test/confirmed-position-storage.test.ts` | 9 | 146 |
| `apps/mini-app/test/confirmed-positions.test.ts` | 18 | 469 |
| `apps/mini-app/test/decimal-input.test.ts` | 6 | 63 |
| `apps/mini-app/test/direct-position-discovery.test.ts` | 24 | 448 |
| `apps/mini-app/test/docs-search.test.ts` | 11 | 131 |
| `apps/mini-app/test/earn-claim-card.test.ts` | 9 | 188 |
| `apps/mini-app/test/earn-state.test.ts` | 4 | 51 |
| `apps/mini-app/test/earn.anvil.test.ts` | 1 | 596 |
| `apps/mini-app/test/earnJourneyPolish.test.ts` | 12 | 253 |
| `apps/mini-app/test/etherscan-gas.test.ts` | 16 | 364 |
| `apps/mini-app/test/fee-usd-presentation.test.ts` | 4 | 32 |
| `apps/mini-app/test/fee-usd-render.test.ts` | 1 | 28 |
| `apps/mini-app/test/form-blockers.test.ts` | 6 | 55 |
| `apps/mini-app/test/fxsave-apy.test.ts` | 4 | 48 |
| `apps/mini-app/test/fxsave-units.test.ts` | 8 | 67 |
| `apps/mini-app/test/gas-cost.test.ts` | 28 | 617 |
| `apps/mini-app/test/gas-fee-policy.test.ts` | 4 | 91 |
| `apps/mini-app/test/gas-fee-source-latency.test.ts` | 13 | 208 |
| `apps/mini-app/test/gas-limit.test.ts` | 1 | 11 |
| `apps/mini-app/test/history-drafts.test.ts` | 6 | 139 |
| `apps/mini-app/test/infoHelp.test.ts` | 13 | 270 |
| `apps/mini-app/test/leverage-share.test.ts` | 13 | 186 |
| `apps/mini-app/test/leverage-split-render.test.ts` | 7 | 165 |
| `apps/mini-app/test/leverage.test.ts` | 7 | 141 |
| `apps/mini-app/test/liquidation-quote.test.ts` | 9 | 192 |
| `apps/mini-app/test/live-market-store.test.ts` | 2 | 118 |
| `apps/mini-app/test/live-market.test.ts` | 6 | 166 |
| `apps/mini-app/test/market-data.test.ts` | 4 | 74 |
| `apps/mini-app/test/missing-value.test.ts` | 2 | 61 |
| `apps/mini-app/test/more-directory-render.test.ts` | 4 | 72 |
| `apps/mini-app/test/move-balances.test.ts` | 4 | 86 |
| `apps/mini-app/test/native-max.test.ts` | 11 | 152 |
| `apps/mini-app/test/pending-activity.test.ts` | 5 | 78 |
| `apps/mini-app/test/portfolio-asset-groups.test.ts` | 3 | 36 |
| `apps/mini-app/test/portfolio-refresh-regression.test.ts` | 21 | 220 |
| `apps/mini-app/test/portfolio-valuation.test.ts` | 7 | 143 |
| `apps/mini-app/test/position-born.test.ts` | 4 | 64 |
| `apps/mini-app/test/position-brake-reader.test.ts` | 6 | 202 |
| `apps/mini-app/test/position-brake.test.ts` | 12 | 220 |
| `apps/mini-app/test/position-card-render.test.ts` | 8 | 277 |
| `apps/mini-app/test/position-economics.test.ts` | 16 | 203 |
| `apps/mini-app/test/position-post-confirm-refresh.test.ts` | 4 | 83 |
| `apps/mini-app/test/position-presentation-render.test.ts` | 4 | 167 |
| `apps/mini-app/test/position-presentation.test.ts` | 3 | 87 |
| `apps/mini-app/test/position-reader.test.ts` | 11 | 228 |
| `apps/mini-app/test/position-review-presentation.test.ts` | 3 | 54 |
| `apps/mini-app/test/position-valuation.test.ts` | 6 | 188 |
| `apps/mini-app/test/prepared-gas-first-render.test.ts` | 2 | 39 |
| `apps/mini-app/test/price-provider-refresh.test.ts` | 3 | 54 |
| `apps/mini-app/test/prices.test.ts` | 15 | 272 |
| `apps/mini-app/test/privy-appearance.test.ts` | 6 | 69 |
| `apps/mini-app/test/privy-fee-display.test.ts` | 3 | 42 |
| `apps/mini-app/test/privy-theme.test.ts` | 7 | 118 |
| `apps/mini-app/test/protocol-fee-review.test.ts` | 7 | 139 |
| `apps/mini-app/test/protocol-position-history.test.ts` | 12 | 446 |
| `apps/mini-app/test/protocol-token-boundary.test.ts` | 3 | 98 |
| `apps/mini-app/test/receipt-presentation.test.ts` | 9 | 120 |
| `apps/mini-app/test/reduction.test.ts` | 7 | 119 |
| `apps/mini-app/test/review-fact-value.test.ts` | 11 | 145 |
| `apps/mini-app/test/review-formatting.test.ts` | 31 | 562 |
| `apps/mini-app/test/review-hierarchy.test.ts` | 9 | 137 |
| `apps/mini-app/test/review-polish.test.ts` | 4 | 40 |
| `apps/mini-app/test/review-preparation-scope.test.ts` | 4 | 42 |
| `apps/mini-app/test/review-preparation.test.ts` | 2 | 80 |
| `apps/mini-app/test/review-summary.test.ts` | 3 | 47 |
| `apps/mini-app/test/review-width-contract.test.ts` | 2 | 23 |
| `apps/mini-app/test/route-prefetch.test.ts` | 14 | 197 |
| `apps/mini-app/test/settings.test.ts` | 8 | 95 |
| `apps/mini-app/test/shell-initializer.test.ts` | 4 | 80 |
| `apps/mini-app/test/stable-trade-review-facts.test.ts` | 7 | 52 |
| `apps/mini-app/test/tailwind-variants.test.ts` | 1 | 23 |
| `apps/mini-app/test/task-state.test.ts` | 4 | 57 |
| `apps/mini-app/test/technical-evidence.test.ts` | 5 | 42 |
| `apps/mini-app/test/telegram-start-param.test.ts` | 10 | 184 |
| `apps/mini-app/test/telegram.test.ts` | 10 | 169 |
| `apps/mini-app/test/theme.test.ts` | 2 | 54 |
| `apps/mini-app/test/token-presentation.test.ts` | 1 | 9 |
| `apps/mini-app/test/trade-outcome-render.test.ts` | 7 | 163 |
| `apps/mini-app/test/trade-outcome.test.ts` | 7 | 129 |
| `apps/mini-app/test/transaction-card-identity.test.ts` | 7 | 56 |
| `apps/mini-app/test/transaction-card-layout.test.ts` | 3 | 43 |
| `apps/mini-app/test/transaction-progress.test.ts` | 8 | 97 |
| `apps/mini-app/test/transaction-result-render.test.ts` | 18 | 380 |
| `apps/mini-app/test/transaction-state.test.ts` | 3 | 35 |
| `apps/mini-app/test/user-errors.test.ts` | 4 | 31 |
| `apps/mini-app/test/wallet-activity.test.ts` | 11 | 121 |
| `apps/mini-app/test/wallet-assets.test.ts` | 18 | 257 |
| `apps/mini-app/test/wallet-balance-cache.test.ts` | 3 | 33 |
| `apps/mini-app/test/wallet-data-refresh.test.ts` | 16 | 263 |
| `apps/mini-app/test/wallet-picker-render.test.ts` | 8 | 130 |
| `apps/mini-app/test/wallet-send.test.ts` | 6 | 54 |
| `apps/mini-app/test/wallet-transfer-history.test.ts` | 11 | 298 |
| `apps/mini-app/test/wsteth-rate.test.ts` | 4 | 69 |
| `apps/mini-app/e2e/overlay-specs/wallet-rpc-proof.spec.ts` | 4 | 260 |
| `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` | 51 executable declarations + 1 suite group | 1667 |
| `apps/mini-app/test/deferred-query-cache-notification.test.ts` | 1 | 27 |

Inventory total: 179 files, 1,410 executable test declarations plus one named suite group. The mobile-wallet source inventory lists 52 names because it includes `test.describe(`${profile} browser defaults`, ...)` at line 933; this group is explicitly classified as suite metadata (`UXP-S-`) and is not counted as an executable case. Parameterized declarations may expand into multiple runtime cases. The existing 44 standalone landing assertions are additional assertion records, not added to this declaration total.

## Curated product contracts

The full scenario ledger is in `product-behaviors.json`; these entries are the implementation-facing summary.

### Navigation

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-ROUTE-001` | Opening the browser root must show Portfolio. | `apps/mini-app/e2e/specs/landing.spec.ts` — test title: browser root renders the Portfolio workspace (declaration line 6) |
| `UXP-C-ROUTE-002` | Legacy Portfolio links must remain compatible. | `apps/mini-app/e2e/specs/landing.spec.ts` — test title: legacy portfolio links remain compatible (declaration line 16) |
| `UXP-C-ROUTE-003` | Legacy Activity deep links must resolve to History. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: legacy Activity deep links resolve to the History workspace (declaration line 77) |
| `UXP-C-ROUTE-004` | Root routing must preserve Telegram launch payload and query state. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: canonical root preserves Telegram payloads and query state (declaration line 92) |
| `UXP-C-ROUTE-005` | Every product route must remain accessible without a transaction backend. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: ${route} loads without an FxAeon backend (declaration line 38) |
| `UXP-C-ROUTE-006` | Unknown routes must provide a scoped FxAeon recovery screen. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: unknown routes render the scoped FxAeon recovery screen (declaration line 787) |
| `UXP-C-ROUTE-007` | Launch metadata must identify each route before hydration. | `apps/mini-app/e2e/specs/route-metadata.spec.ts` — test title: ${route} exposes route-specific launch metadata before hydration (declaration line 25) |

### Documentation

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-ROUTE-008` | Entering Docs must defer wallet initialization. | `apps/mini-app/e2e/specs/docs-experience.spec.ts` — test title: defers wallet work on a docs entry and preserves the session after visiting the app (declaration line 7) |
| `UXP-C-ROUTE-009` | Product guide fragments, including recovery, must remain addressable. | `apps/mini-app/test/docs-search.test.ts` — test title: all existing product-guide fragments, including recovery, remain addressable (declaration line 62) |
| `UXP-C-ROUTE-010` | Search must index actual visible article content across pages and preserve navigation history. | `apps/mini-app/e2e/specs/docs-experience.spec.ts` — test title: searches actual text across pages and preserves back navigation (declaration line 66) |
| `UXP-C-ROUTE-011` | An unavailable static search index must permit retry and recovery. | `apps/mini-app/e2e/specs/docs-experience.spec.ts` — test title: search recovers when the static index request fails once (declaration line 241) |
| `UXP-C-ROUTE-012` | Privacy policy access must remain reachable through the product guide. | `apps/mini-app/e2e/specs/docs-experience.spec.ts` — test title: keeps the privacy disclosure reachable through the rendered product guide (declaration line 38) |

### Product scope

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-SCOPE-001` | Trade, Positions, Borrow and fxSAVE operations use Ethereum; supported Move routes connect Ethereum and Base. | `docs/product-behavior.md` — Main areas |
| `UXP-C-SCOPE-002` | USD values, charts and portfolio estimates must not determine signed transaction amounts. | `docs/product-behavior.md` — Reviews and mobile layout / Scope |
| `UXP-C-SCOPE-003` | The selected user wallet must approve each transaction step. | `README.md` — Built to be trusted / How it works |
| `UXP-C-SCOPE-004` | Current equity must never be labelled profit or PnL without dependable entry-cost evidence. | `docs/review/reference-led-product-design.md` — Implemented system — Position cards / PnL paragraph |

### Theme

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-THEME-001` | Dark must be the only product appearance and must apply before first paint. | `apps/mini-app/test/shell-initializer.test.ts` — test title: dark applies before the first paint and replaces saved light preferences (declaration line 31) |
| `UXP-C-THEME-002` | Migrating light or official preferences to dark must preserve slippage and gas settings. | `apps/mini-app/test/theme.test.ts` — test title: light and official preferences migrate to dark while transaction preferences survive (declaration line 31) |
| `UXP-C-THEME-003` | Malformed or blocked browser storage must not prevent dark appearance. | `apps/mini-app/test/theme.test.ts` — test title: blocked or malformed preferences cannot prevent dark appearance (declaration line 46) |
| `UXP-C-THEME-004` | Portalled wallet and token selectors must inherit the dark palette. | `apps/mini-app/e2e/specs/design-system.spec.ts` — test title: wallet and token portals use the dark palette and restore focus (declaration line 287) |
| `UXP-C-THEME-005` | Privy must use the app background, accent and own-origin FxAeon mark. | `apps/mini-app/test/privy-appearance.test.ts` — test title: the modal shows FxAeon's own mark from this origin at a set size (declaration line 32) |
| `UXP-C-THEME-006` | Use the existing semantic palette; preserve independent success, danger, long/short, token and network colors. | `docs/brand-assets.md` — Sources and use / Theme and layout |

### Typography

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-THEME-007` | Use self-hosted Inter for interface/financial figures and Manrope for display/brand headings; preserve their licenses. | `docs/review/reference-led-product-design.md` — Implemented system |

### Accessibility

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-A11Y-001` | Every official route must expose a main landmark and fit a narrow viewport. | `apps/mini-app/e2e/specs/mobile-accessibility.spec.ts` — test title: every official screen fits a narrow viewport, exposes a main landmark, and keeps controls reachable (declaration line 7) |
| `UXP-C-A11Y-002` | Amount shortcuts must retain at least 44px touch targets without covering their labels. | `apps/mini-app/e2e/specs/compact-layout.spec.ts` — test title: amount shortcuts retain touch targets and never overlap the label (declaration line 33) |
| `UXP-C-A11Y-003` | Main review actions must stay reachable above navigation at the 393×852 baseline. | `apps/mini-app/e2e/specs/compact-layout.spec.ts` — test title: baseline forms keep their action above navigation and Move stays centered (declaration line 5) |
| `UXP-C-A11Y-004` | All primary financial flows must remain reachable with 200% text in dark appearance. | `apps/mini-app/e2e/specs/compact-layout.spec.ts` — test title: form review actions remain reachable with 200% text in dark appearance (declaration line 49) |
| `UXP-C-A11Y-005` | Focused amount inputs must remain reachable when the visual viewport shrinks for a keyboard. | `apps/mini-app/e2e/specs/mobile-interactions.spec.ts` — test title: keeps the focused amount input reachable when the visual viewport shrinks (declaration line 6) |
| `UXP-C-A11Y-006` | Mobile reviews must scroll their information separately from a reachable action with a minimum 48px height. | `apps/mini-app/test/transaction-card-layout.test.ts` — test title: mobile review is content-height and keeps scrollable information separate from action (declaration line 32) |
| `UXP-C-A11Y-007` | Nested overlays must trap focus in the active surface and restore it to the correct opener. | `apps/mini-app/e2e/overlay-specs/overlay-lifecycle.spec.ts` — test title: contains keyboard focus and restores focus through nested dialogs (declaration line 50) |
| `UXP-C-A11Y-008` | Browser Back must dismiss one overlay without leaving its underlying page. | `apps/mini-app/e2e/overlay-specs/overlay-lifecycle.spec.ts` — test title: browser Back dismisses one overlay at a time without leaving the page (declaration line 117) |
| `UXP-C-A11Y-009` | Telegram Back must dismiss the top overlay and consume that event. | `apps/mini-app/e2e/overlay-specs/overlay-lifecycle.spec.ts` — test title: Telegram Back dismisses the top overlay and consumes the event (declaration line 150) |
| `UXP-C-A11Y-010` | Help panels must fit a 320px viewport with 200% text and a keyboard-offset visual viewport. | `apps/mini-app/test/infoHelp.test.ts` — test title: help fits a 320px viewport with 200% text, tall content, and anchors at every edge (declaration line 47); `apps/mini-app/test/infoHelp.test.ts` — test title: help accounts for a zoomed or keyboard-offset visual viewport and repositions above when needed (declaration line 71) |
| `UXP-C-A11Y-011` | Escape must close contextual help before its parent sheet and restore trigger focus. | `apps/mini-app/test/infoHelp.test.ts` — test title: Escape is captured before the sheet handler, closes only help and returns trigger focus (declaration line 181) |
| `UXP-C-A11Y-012` | Interactive controls must show one focus ring; nested wrappers must not add competing frames. | `apps/mini-app/e2e/positions-harness/positions-screens.spec.ts` — test title: keyboard focus belongs to the active field or button without nested frames (declaration line 478) |
| `UXP-C-A11Y-013` | Slippage radio controls must support Arrow, Home and End navigation with one tab stop. | `apps/mini-app/e2e/overlay-specs/earn-form-consistency.spec.ts` — test title: transaction setting radio groups support arrow, Home and End keys with one tab stop (declaration line 223) |
| `UXP-C-A11Y-014` | Disabled and busy actions must remain readable at AA contrast and visibly unavailable. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: disabled and busy actions stay readable (AA) and look unavailable in dark mode (declaration line 471) |
| `UXP-C-A11Y-015` | The skip link must remain keyboard accessible without shifting the connected Trade layout. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: skip link stays hidden while connected Trade remains fixed and remains keyboard accessible (declaration line 324) |
| `UXP-C-A11Y-016` | Long exact addresses and amounts must wrap or disclose exact evidence without widening a 320px review. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: a whole recipient address wraps inside the review at 320px instead of widening the card (declaration line 1054); `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: a long exact amount stays in the disabled editor at 320px until verification opens the review sheet (declaration line 1016) |

### Shell

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-SHELL-001` | The header must stay one row while wallet state settles at phone widths. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: the header stays one row while the wallet settles, at every phone width (declaration line 89) |
| `UXP-C-SHELL-002` | Network and wallet must open separate surfaces. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: network and wallet have separate surfaces and stay within the dark topbar (declaration line 42) |
| `UXP-C-SHELL-003` | Mobile menu toggling must preserve live form values, URL, history state and scroll. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: mobile menu toggles in place and preserves the live form, URL, history state and scroll (declaration line 725) |
| `UXP-C-SHELL-004` | Loading placeholders must hand over to the live shell without geometry shifts. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: the first-paint outline hands over to the live shell in place, at every phone width (declaration line 622) |
| `UXP-C-SHELL-005` | The mobile dock must retain a Borrow tab and reachable More access at narrow widths. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: Borrow has its own tab and More stays reachable through the full mobile navigation range (declaration line 644) |
| `UXP-C-SHELL-006` | Not-found, sign-in and error content must start at the scroll top when it cannot fit. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: sign-in, not-found and error screens scroll from their top when they do not fit, and lead back to Portfolio (declaration line 401) |

### Motion

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-MOTION-001` | Reduced motion must remove heading sweeps and decorative travel. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: reduced motion shows plain headings with no sweep and a still canvas (declaration line 282) |
| `UXP-C-MOTION-002` | Route headings must remain separate from route-fade transforms so fixed descendants keep their geometry. | `apps/mini-app/e2e/overlay-specs/app-shell.spec.ts` — test title: a route heading is never inside the route fade; heading-less content still fades in (declaration line 264) |
| `UXP-C-MOTION-003` | Transaction animation must follow actual transaction state; a submitted hash must not animate into confirmation. | `apps/mini-app/test/compact-execution.test.ts` — test title: pending labels preserve wallet approval versus action and no submission is called success (declaration line 6) |
| `UXP-C-MOTION-004` | Positions must open without a transition when reduced motion is requested or the View Transitions API is absent. | `apps/mini-app/e2e/positions-harness/position-born.spec.ts` — test title: without the View Transitions API the pages simply swap (declaration line 272) |
| `UXP-C-MOTION-005` | The landing sculpture must run at no more than 30fps and 1.5 device pixels per CSS pixel. | `DESIGN.md` — Public landing page — Motion |
| `UXP-C-MOTION-006` | Landing graphics must pause while offscreen or in hidden tabs and show a still fallback for unavailable WebGL, context loss, save-data or disabled JavaScript. | `apps/landing/README.md` — Visual and performance notes — hero sculpture |

### Amounts and display

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-AMOUNT-001` | Fractional balance shortcuts must compute token units exactly without floating-point drift. | `apps/mini-app/test/amount.test.ts` — test title: percentage sizing calculates exact token units without floating point drift (declaration line 5) |
| `UXP-C-AMOUNT-002` | An available balance must round down and must not display positive dust as zero. | `apps/mini-app/test/amount.test.ts` — test title: spendable balances round down, group, and never read as zero (declaration line 30) |
| `UXP-C-AMOUNT-003` | Cost and required-minimum displays must round upward rather than understate the exact requirement. | `apps/mini-app/test/amount.test.ts` — test title: costs and minimums round up so the figure shown always covers the exact one (declaration line 49) |
| `UXP-C-AMOUNT-004` | Input validation must identify excess token precision and explain how to fix it. | `apps/mini-app/test/amount.test.ts` — test title: amount errors name the problem and the fix (declaration line 19) |
| `UXP-C-AMOUNT-005` | Invalid scientific-notation or ambiguous-separator paste must not silently change meaning. | `apps/mini-app/test/decimal-input.test.ts` — test title: DecimalInput clears an invalid pasted scientific notation instead of changing its meaning (declaration line 22) |
| `UXP-C-AMOUNT-006` | Grouping must never change an amount, including integers beyond Number safe precision. | `apps/mini-app/test/amount.test.ts` — test title: digit grouping adds separators to the whole part only and never alters the value (declaration line 77) |
| `UXP-C-AMOUNT-007` | Unknown, loading, stale, unavailable and verified zero balances must remain distinguishable. | `apps/mini-app/test/missing-value.test.ts` — test title: missing value placeholders distinguish unknown reads from verified values (declaration line 19) |
| `UXP-C-AMOUNT-008` | Unavailable price data must never manufacture a zero USD value or a stablecoin dollar peg. | `apps/mini-app/test/prices.test.ts` — test title: unavailable fallback prices stay absent instead of assuming the stablecoin peg (declaration line 212) |
| `UXP-C-AMOUNT-009` | A complete exact signed amount must remain available when its compact display truncates digits. | `apps/mini-app/test/review-fact-value.test.ts` — test title: native closed disclosure exposes compact amount without helper prose, caret or nested controls (declaration line 122) |
| `UXP-C-AMOUNT-010` | Signed approvals must display exact amounts without the approximation marker. | `apps/mini-app/test/review-formatting.test.ts` — test title: approvals read as the exact amount the wallet signs, never rounded or marked "≈" (declaration line 15) |
| `UXP-C-AMOUNT-011` | Signed minima must remain exact while quote estimates retain ≈. | `apps/mini-app/test/review-formatting.test.ts` — test title: signed minimums read exactly while quote estimates keep "≈" (declaration line 27) |
| `UXP-C-AMOUNT-012` | A confirmed one-wei quantity must remain distinct from zero. | `apps/mini-app/test/position-presentation.test.ts` — test title: position quantities retain exact units and never make positive raw values look zero (declaration line 46) |
| `UXP-C-AMOUNT-013` | A negative sub-cent net value must retain its sign and must not appear as zero profit. | `apps/mini-app/test/position-presentation.test.ts` — test title: signed sub-cent USD labels require exact rational proof; cents remain byte-for-byte comparable (declaration line 65) |
| `UXP-C-AMOUNT-014` | A verified zero balance must produce actionable empty-wallet copy before the user types. | `apps/mini-app/test/form-blockers.test.ts` — test title: an empty wallet is named before anything is typed (declaration line 18) |
| `UXP-C-AMOUNT-015` | An unavailable balance alone must not be misclassified as insufficient funds. | `apps/mini-app/test/form-blockers.test.ts` — test title: an unsettled balance never blocks, and exact comparison avoids floats (declaration line 23) |

### Trade

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-TRADE-001` | The market selector must retain ETH and BTC and each market must support long and short with its official input set. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: trade exposes the full official input set and rejects an empty leverage in all four position flows (declaration line 267) |
| `UXP-C-TRADE-002` | Expanding a mobile chart must move the intact ticket below it and preserve its entered amount. | `apps/mini-app/e2e/specs/unified-product.spec.ts` — test title: opening the mobile chart moves an intact ticket below the market (declaration line 7) |
| `UXP-C-TRADE-003` | The mobile chart must remain cold until explicitly expanded. | `apps/mini-app/e2e/specs/design-system.spec.ts` — test title: collapsed mobile charts stay cold until explicitly expanded (declaration line 141) |
| `UXP-C-TRADE-004` | Desktop Trade must show the chart beside the ticket. | `apps/mini-app/e2e/specs/design-system.spec.ts` — test title: desktop Trade composes a chart beside the ticket, mobile keeps the chart optional (declaration line 25) |
| `UXP-C-TRADE-005` | Chart scrubbing must show the hovered price in the header and restore the live price on release. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: scrubbing the chart reads the hovered bar in the header, then returns to the live price (declaration line 484) |
| `UXP-C-TRADE-006` | Chart time labels must follow the viewer timezone without disordering points across DST. | `apps/mini-app/test/chart-time.test.ts` — test title: one offset from the newest bar keeps a series ordered across a daylight-saving change (declaration line 22) |
| `UXP-C-TRADE-007` | The leverage slider must use live bounds and step by 0.1×, with Page keys moving 1× and Home/End reaching the bounds. | `apps/mini-app/e2e/trade-harness/ticket.spec.ts` — test title: keys step 0.1×, pages move a whole ×, and Home/End reach the bounds (declaration line 381) |
| `UXP-C-TRADE-008` | Vertical swipes over the leverage track must scroll rather than change leverage. | `apps/mini-app/e2e/trade-harness/ticket.spec.ts` — test title: a sideways drag moves the thumb with the finger, a tap jumps it, and a vertical swipe leaves it alone (declaration line 417) |
| `UXP-C-TRADE-009` | An out-of-range typed leverage must block review until the value is committed and clamped. | `apps/mini-app/e2e/trade-harness/native-max.spec.ts` — test title: out-of-range leverage blocks review while typing and clamps only when committed (declaration line 254) |
| `UXP-C-TRADE-010` | An empty leverage value must never review a valid amount. | `apps/mini-app/e2e/trade-harness/native-max.spec.ts` — test title: empty leverage cannot review a valid amount before or after blur (declaration line 274) |
| `UXP-C-TRADE-011` | Long debt share uses (L−1)/L; short debt share uses L/(L+1). | `apps/mini-app/test/leverage-share.test.ts` — test title: a short is borrowed exposure over collateral, L / (L + 1) (declaration line 29); `apps/mini-app/test/leverage-share.test.ts` — test title: a long is debt over collateral, (L − 1) / L (declaration line 22) |
| `UXP-C-TRADE-012` | Preview collateral, debt and protocol-fee figures must come from the same warmed route shown in review. | `apps/mini-app/e2e/trade-harness/ticket.spec.ts` — test title: previews the warmed route with the figures its review then shows, from the same single plan (declaration line 78) |
| `UXP-C-TRADE-013` | Changing any ticket input must immediately clear the previous preview figures. | `apps/mini-app/e2e/trade-harness/ticket.spec.ts` — test title: clears its figures the moment an input changes, then estimates the new ticket (declaration line 162) |
| `UXP-C-TRADE-014` | A failed advisory warm-up must leave no fabricated preview and allow fresh explicit review. | `apps/mini-app/e2e/trade-harness/ticket.spec.ts` — test title: a failed warm-up leaves no preview and no error behind, and review still plans afresh (declaration line 189) |
| `UXP-C-TRADE-015` | Threshold estimates must disappear when their pool data expires. | `apps/mini-app/e2e/trade-harness/ticket.spec.ts` — test title: an untouched ticket stops showing a liquidation estimate once its pool threshold expires (declaration line 223) |
| `UXP-C-TRADE-016` | Native Max must reserve the fully estimated route fee and return only a verified fundable amount. | `apps/mini-app/test/native-max.test.ts` — test title: native max converges from a fundable half balance and verifies the final amount (declaration line 16) |
| `UXP-C-TRADE-017` | Balance or side changes must discard any in-flight native Max calculation. | `apps/mini-app/e2e/trade-harness/native-max.spec.ts` — test title: balance changes discard an in-flight Max result and restore the button (declaration line 131) |
| `UXP-C-TRADE-018` | Quoted leverage must be independently checked rather than trusted because the SDK echoes the requested target. | `apps/mini-app/test/action-review-presentation.test.ts` — test title: position review shows independently calculated leverage instead of the SDK target echo (declaration line 50) |

### Positions

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-POSITION-001` | Position rows must retain market, side, ID, leverage, current value and exact accounting details. | `apps/mini-app/test/position-card-render.test.ts` — test title: a position row leads with identity and value; its details keep every figure and raw unit (declaration line 102) |
| `UXP-C-POSITION-002` | An ETH long must display collateral in stETH accounting units; a signed wstETH minimum must stay in wstETH. | `apps/mini-app/test/review-formatting.test.ts` — test title: a wstETH floor stays exact in the unit it is signed in, with its stETH equivalent beside it (declaration line 353) |
| `UXP-C-POSITION-003` | A missing wstETH conversion rate must preserve the native quote unit rather than assume a 1:1 conversion. | `apps/mini-app/test/review-formatting.test.ts` — test title: without a usable rate a new ETH long keeps its native wstETH figure, never a guessed or 1:1 rate (declaration line 282) |
| `UXP-C-POSITION-004` | BTC pool accounting uses 18 decimals while the external WBTC conversion output uses 8. | `apps/mini-app/test/review-formatting.test.ts` — test title: BTC quote accounting uses 18 decimals, while converter output uses 8 decimals (declaration line 204) |
| `UXP-C-POSITION-005` | Short collateral must remain denominated in fxUSD and debt in its actual borrowed derivative. | `apps/mini-app/test/review-formatting.test.ts` — test title: short collateral is fxUSD and short debt retains the derivative denomination (declaration line 219) |
| `UXP-C-POSITION-006` | Position groups must settle independently so a failed pool cannot erase verified siblings. | `apps/mini-app/test/position-reader.test.ts` — test title: position groups settle independently and preserve verified positions after a partial failure (declaration line 44) |
| `UXP-C-POSITION-007` | A total read outage must remain distinguishable from an honestly empty account. | `apps/mini-app/test/position-reader.test.ts` — test title: a total outage is distinguishable from an honestly empty portfolio (declaration line 102) |
| `UXP-C-POSITION-008` | A successful empty group must clear old holdings while failed groups retain their last verified state. | `apps/mini-app/test/position-reader.test.ts` — test title: an honestly empty successful group clears old positions while a total outage retains the snapshot (declaration line 152) |
| `UXP-C-POSITION-009` | Position overview must not turn missing prices or incomplete reads into a fabricated total. | `apps/mini-app/e2e/positions-harness/positions-screens.spec.ts` — test title: position overview does not turn missing prices or incomplete reads into portfolio totals (declaration line 279) |
| `UXP-C-POSITION-010` | A phone must open one manager from its row and return to the prior list scroll position. | `apps/mini-app/e2e/positions-harness/positions-screens.spec.ts` — test title: a phone opens one position from its row and returns to the list where it was left (declaration line 324) |
| `UXP-C-POSITION-011` | Desktop must show the position list first and open management only after explicit selection. | `apps/mini-app/e2e/positions-harness/positions-screens.spec.ts` — test title: wide screens show the list first and open management only after selecting a position (declaration line 534) |
| `UXP-C-POSITION-012` | Add, Reduce, Leverage and Close must remain bound to the selected position and share its owned review surface. | `apps/mini-app/e2e/positions-harness/positions-review-layout.spec.ts` — test title: Add, Reduce, Close, and Leverage use one desktop review column and an inert phone underlay; context changes reset input and an empty final read keeps the review mounted (declaration line 323) |
| `UXP-C-POSITION-013` | Edit from a position review must return to the same management dialog. | `apps/mini-app/e2e/positions-harness/positions-review-layout.spec.ts` — test title: four-position Close review stays in its sheet, preserves approvals and fees, and Edit returns to management (declaration line 198) |
| `UXP-C-POSITION-014` | At-risk rebalance/liquidation state must remain visible while secondary position facts are collapsed. | `apps/mini-app/test/position-card-render.test.ts` — test title: compact management keeps risk visible and exact balances in its position-value disclosure (declaration line 137) |
| `UXP-C-POSITION-015` | Rebalance distance must round toward safety and use the pool threshold rather than a fixed universal buffer. | `apps/mini-app/test/position-brake.test.ts` — test title: percentages round toward safety, showing the smaller distance (declaration line 97) |
| `UXP-C-POSITION-016` | At or beyond liquidation, the card must identify the condition rather than show a remaining distance. | `apps/mini-app/test/position-brake.test.ts` — test title: at or past liquidation the card says so and offers no distance (declaration line 172) |
| `UXP-C-POSITION-017` | Unusable or stale threshold readings must not draw invented markers or zero thresholds. | `apps/mini-app/test/position-brake.test.ts` — test title: unusable readings draw nothing rather than a zero or a made-up threshold (declaration line 190) |
| `UXP-C-POSITION-018` | A confirmed open result must not label requested target leverage as achieved leverage. | `apps/mini-app/test/transaction-result-render.test.ts` — test title: newly opened live position shows verified identity without presenting requested leverage as achieved (declaration line 306) |
| `UXP-C-POSITION-019` | A receipt-proven new position must show syncing until a fresh matching chain read supplies accounting. | `apps/mini-app/e2e/positions-harness/position-born.spec.ts` — test title: a position the chain has not returned yet opens from its receipt, then in full (declaration line 284) |
| `UXP-C-POSITION-020` | Post-confirm readback must refer to the same position and require a genuinely fresh successful read. | `apps/mini-app/test/coherent-interface.test.ts` — test title: post-confirm readback is the refreshed same position, not the quoted target (declaration line 62) |

### Borrow

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-BORROW-001` | New Borrow must ask for collateral before the requested fxUSD amount. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: one collateral picker plans both ETH and BTC with collateral above borrowing (declaration line 273) |
| `UXP-C-BORROW-002` | New Borrow requires positive initial collateral even where existing-position collateral is optional. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: a new position still requires positive starting collateral (declaration line 488) |
| `UXP-C-BORROW-003` | Blank and exact-zero optional collateral must be equivalent without bypassing validation of a positive amount. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: optional collateral treats blank and exact zero equally without skipping positive amount checks (declaration line 355) |
| `UXP-C-BORROW-004` | Borrow must show debt separately from net wallet proceeds. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: borrowing previews debt separately from net proceeds and clears invalid or unpriced risk estimates (declaration line 499) |
| `UXP-C-BORROW-005` | Borrow capacity must account for existing debt and never become negative. | `apps/mini-app/test/borrow-limits.test.ts` — test title: existing debt uses up capacity, never below zero (declaration line 46) |
| `UXP-C-BORROW-006` | Displayed borrowable room must round down, while minimums and LTV round toward safety. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: borrowing limits round toward safety: room rounds down, minimums and loan-to-value round up (declaration line 407) |
| `UXP-C-BORROW-007` | The exact buffered 83.79% boundary must not be mislabeled 83.7% against an 83.8% displayed LTV. | `apps/mini-app/test/borrow-limit-presentation.test.ts` — test title: the buffered 83.79% boundary is not displayed as 83.7% against 83.8% LTV (declaration line 6) |
| `UXP-C-BORROW-008` | Withdrawing collateral must show the amount that can leave within current debt and live pool limits. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: the withdrawal field names how much collateral can leave before review (declaration line 432) |
| `UXP-C-BORROW-009` | A stale or disappeared selected position must block planning and wallet requests. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: mounted Borrow page prevents review planning and wallet requests when selection becomes stale (declaration line 228) |
| `UXP-C-BORROW-010` | Unavailable existing-position discovery must not by itself prevent a valid new-position plan. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: new-position planning remains available while existing-position discovery is unavailable (declaration line 203) |
| `UXP-C-BORROW-011` | Repayment outcome must use the selected position debt and clear when input becomes invalid. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: repayment outcomes use the selected position debt and clear invalid input (declaration line 525) |
| `UXP-C-BORROW-012` | A single eligible collateral asset must be named directly rather than offered in a one-row selector. | `apps/mini-app/e2e/borrow-harness/borrow-selection.spec.ts` — test title: a single collateral asset is named, not offered as a one-row picker (declaration line 471) |

### Earn

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-EARN-001` | Deposits must accept fxUSD, USDC and fxSP as distinct assets. | `apps/mini-app/test/token-presentation.test.ts` — test title: Earn assets have distinct user-facing identities (declaration line 5); `apps/mini-app/src/app/docs/ProductArticle.tsx` — productSections: earn — Deposit supports fxUSD, USDC, and fxSP |
| `UXP-C-EARN-002` | The withdrawal limit must use exact fxSAVE balance rather than underlying fxSP assets or USD value. | `apps/mini-app/e2e/overlay-specs/earn-form-consistency.spec.ts` — test title: withdrawals compare the exact fxSAVE balance, and vault details read in their own units (declaration line 184) |
| `UXP-C-EARN-003` | Wallet balance and vault supply must retain fxSAVE share units. | `apps/mini-app/test/fxsave-units.test.ts` — test title: wallet balance and vault supply remain denominated in fxSAVE shares (declaration line 26) |
| `UXP-C-EARN-004` | SDK vault assets and queued redemption amounts must be labelled fxSP base-pool shares, not fxUSD or fxSAVE. | `apps/mini-app/test/fxsave-units.test.ts` — test title: SDK assets and queued redemption fields are base-pool shares, not fxUSD or fxSAVE (declaration line 18) |
| `UXP-C-EARN-005` | Vault valuation must use validated fxSP pricing or recent official TVL and must not assume stablecoin parity. | `apps/mini-app/test/fxsave-units.test.ts` — test title: vault USD value uses fxSP valuation or a recent official TVL without stablecoin parity (declaration line 7) |
| `UXP-C-EARN-006` | Per-share fxSAVE value must use the address-matched fxSAVE quote and its own freshness time. | `apps/mini-app/test/earnJourneyPolish.test.ts` — test title: per-share value uses the address-matched fxSAVE quote, not fxSP or fxUSD (declaration line 77) |
| `UXP-C-EARN-007` | APY must come from a validated official fxSAVE payload with matching contract identity. | `apps/mini-app/test/fxsave-apy.test.ts` — test title: rejects an APY response for another token or invalid value (declaration line 17) |
| `UXP-C-EARN-008` | Fresh withdrawal defaults to cooldown; later mode or token edits must preserve an explicitly selected Instant method. | `apps/mini-app/test/earnJourneyPolish.test.ts` — test title: fresh withdrawal uses cooldown, but mode/token changes do not overwrite selected Instant (declaration line 167) |
| `UXP-C-EARN-009` | Queued stablecoin withdrawal review must retain both potential later claim assets, fxUSD and USDC. | `apps/mini-app/test/action-review-presentation.test.ts` — test title: queued fxSAVE reviews keep both later claim assets visible for either selected stablecoin (declaration line 58) |
| `UXP-C-EARN-010` | Instant withdrawal must preserve its selected converted receive asset and accepted net output/fee. | `apps/mini-app/test/accepted-save-quote.test.ts` — test title: normalized accepted instant quote shows net chosen-token output and its own fee (declaration line 76) |
| `UXP-C-EARN-011` | Direct redemption to fxSP must not be labelled an instant stablecoin withdrawal or a later claim. | `apps/mini-app/test/transaction-card-identity.test.ts` — test title: direct base pool redemption is not labelled as instant stablecoin withdrawal (declaration line 47) |
| `UXP-C-EARN-012` | Deposits and queued/direct withdrawals must hide slippage controls that do not apply. | `apps/mini-app/e2e/overlay-specs/earn-form-consistency.spec.ts` — test title: queued stable and direct base-pool withdrawals hide unused settings and preserve active tolerance (declaration line 439) |
| `UXP-C-EARN-013` | Stablecoin deposits must state that the final fxSAVE minimum is not enforced by this route, retain the actual minimum fxSP floor, and never claim user-selected slippage protection for final fxSAVE received. | `apps/mini-app/test/review-formatting.test.ts` — test title: stable fxSAVE deposit review discloses the final-share limitation without claiming selected slippage (declaration line 446) |
| `UXP-C-EARN-014` | A claim may become reviewable only with positive pending shares and authoritative cooldown completion. | `apps/mini-app/test/earn-state.test.ts` — test title: claim requires both a positive pending amount and authoritative cooldown completion (declaration line 38) |
| `UXP-C-EARN-015` | Local elapsed time must never promote a queued withdrawal to ready. | `apps/mini-app/test/earn-claim-card.test.ts` — test title: queued card groups the real fxSP amount and waiting status without local-clock promotion (declaration line 57) |
| `UXP-C-EARN-016` | A ready claim must retain separate approximate fxUSD and USDC payout amounts and the final-amount caveat. | `apps/mini-app/test/earn-claim-card.test.ts` — test title: ready card preserves separate approximate fxUSD and USDC amounts and final-amount caveat (declaration line 80) |
| `UXP-C-EARN-017` | An unavailable redemption read must not reuse stale pending shares or payout previews. | `apps/mini-app/test/earn-claim-card.test.ts` — test title: unavailable or empty authoritative reads never expose fallback pending amounts or payout previews (declaration line 115) |
| `UXP-C-EARN-018` | A queued receipt must report the confirmed request without inventing fxSP shares or claim readiness. | `apps/mini-app/test/transaction-result-render.test.ts` — test title: queue result reports the confirmed request without inventing claim readiness or fxSP shares (declaration line 230) |
| `UXP-C-EARN-019` | Claim must retain one sheet owner through planning, review, signing and result. | `apps/mini-app/test/earn-claim-card.test.ts` — test title: the claim flow retains one sheet owner and the same action child across every stage (declaration line 150) |
| `UXP-C-EARN-020` | Withdrawal fee, cooldown, payout-unit and unknown-term information must remain visible outside optional generic help. | `apps/mini-app/test/earnJourneyPolish.test.ts` — test title: withdrawal fees, configured cooldown, queued payout units and unknown terms stay visible (declaration line 211) |

### Move

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-MOVE-001` | Canonical Move source balances must use underlying tokens on Ethereum and corresponding OFTs on Base. | `apps/mini-app/test/move-balances.test.ts` — test title: uses the Ethereum underlying token and Base OFT for canonical source balances (declaration line 26) |
| `UXP-C-MOVE-002` | Recipient defaults to the selected wallet but must remain editable. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: Move keeps recipient editable and centralizes wallet connection in review (declaration line 664) |
| `UXP-C-MOVE-003` | Source and destination network, asset, recipient, minimum received and bridge fee must remain visible in review. | `apps/mini-app/test/review-formatting.test.ts` — test title: bridge review keeps validated source, destination, asset, recipient, receive bound, and fee together (declaration line 159) |
| `UXP-C-MOVE-004` | A late quote must remain bound to its exact amount and recipient. | `apps/mini-app/e2e/move-harness/move-session.spec.ts` — test title: Move keeps a late quote bound to the current amount and recipient (declaration line 117) |
| `UXP-C-MOVE-005` | Zero or invalid recipients must show field errors and block a review. | `apps/mini-app/e2e/move-harness/move-session.spec.ts` — test title: Move expires and refreshes its quote, and blocks zero or invalid recipients with field errors (declaration line 151) |
| `UXP-C-MOVE-006` | Source confirmation must not imply destination delivery or active checking when recovery context is absent. | `apps/mini-app/test/bridge-tracker-render.test.ts` — test title: source confirmation without recovery context does not imply delivery or active checking (declaration line 25) |
| `UXP-C-MOVE-007` | External destination-success claims must never bypass local delivery verification. | `apps/mini-app/test/bridge-tracker-render.test.ts` — test title: externally supplied destination success never bypasses local verification (declaration line 32) |
| `UXP-C-MOVE-008` | Confirmed sent and received amounts must come from matching events rather than the requested quote. | `apps/mini-app/test/bridge-result-card.test.ts` — test title: bridge outcome uses verified source and destination amounts, never the requested quote (declaration line 21) |
| `UXP-C-MOVE-009` | An interrupted bridge must not claim source reversion without a matching receipt. | `apps/mini-app/test/bridge-tracker-render.test.ts` — test title: an interrupted bridge does not claim the source reverted without a receipt (declaration line 38) |
| `UXP-C-MOVE-010` | Destination recovery must expose a resumable cursor when its bounded scan has not caught up. | `apps/mini-app/test/bridge-delivery.test.ts` — test title: destination recovery exposes a resumable cursor when the bounded scan has not caught up (declaration line 204) |
| `UXP-C-MOVE-011` | Simulation must remain explicitly distinct and must not expose fake public explorer links. | `apps/mini-app/test/bridge-result-card.test.ts` — test title: simulation has distinct disclosure and no fake on-chain links (declaration line 54) |
| `UXP-C-MOVE-012` | The expert route must remain a clearly identified disclosure with reviewed source/destination contracts. | `apps/mini-app/e2e/move-harness/move-session.spec.ts` — test title: the recipient row is a status, and the developer disclosure reads as expert mode (declaration line 83) |

### Transaction review and progress

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-REVIEW-001` | Review identity must place accepted position/action identity beside the amount paid, without generating a second quote. | `apps/mini-app/test/transaction-card-layout.test.ts` — test title: reference review owns a side-by-side identity outside one grouped facts card (declaration line 6) |
| `UXP-C-REVIEW-002` | The editor must stay visible while quote and fee checks prepare; review opens only after readiness settles. | `apps/mini-app/e2e/overlay-specs/review-ready-preflight.spec.ts` — test title: quote and gas checks finish before the first review frame (declaration line 48) |
| `UXP-C-REVIEW-003` | Preparation must have one bounded budget covering quote and fee work. | `apps/mini-app/test/review-preparation-scope.test.ts` — test title: quote and fee work share one bounded preparation budget (declaration line 12) |
| `UXP-C-REVIEW-004` | Cancel or a changed wallet/form intent must invalidate pending preparation and reject late results. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: Cancel returns to the editor during preparation and ignores its late result (declaration line 1316) |
| `UXP-C-REVIEW-005` | An explicit review must never sign until the user performs a separate confirmation action. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: explicit review never signs until the separate confirmation action (declaration line 517) |
| `UXP-C-REVIEW-006` | The primary action must name the next required token approval before naming the actual action. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: primary action names the required token approval and fee tier reaches wallet request fields (declaration line 324) |
| `UXP-C-REVIEW-007` | Accepted route terms must stay frozen while a wallet request is pending. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: locks the accepted route while the wallet response is pending (declaration line 532) |
| `UXP-C-REVIEW-008` | An account change during a pending wallet request must keep its execution visible while blocking later signatures. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: keeps a deferred send visible after account change and stops later signatures (declaration line 556) |
| `UXP-C-REVIEW-009` | Expired reviews must retain accepted terms while requiring an explicit refreshed review before signing. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: expires a resumed review without dropping accepted terms and requires an explicit quote refresh (declaration line 1396) |
| `UXP-C-REVIEW-010` | An approval-only partial result must never claim the protocol action completed. | `apps/mini-app/test/review-formatting.test.ts` — test title: an approval-only partial result does not claim the reviewed action completed (declaration line 112) |
| `UXP-C-REVIEW-011` | A validated broadcast hash must be linkable before receipt arrival, without being labelled confirmed. | `apps/mini-app/test/transaction-progress.test.ts` — test title: a validated broadcast hash is immediately linkable before any receipt arrives (declaration line 36) |
| `UXP-C-REVIEW-012` | Receipt-read failure must present confirmation unknown rather than claim success or failure. | `apps/mini-app/test/transaction-progress.test.ts` — test title: a receipt read failure preserves unknown submission rather than claiming failure or success (declaration line 71) |
| `UXP-C-REVIEW-013` | A verified on-chain revert must remain distinct from an unverified receipt. | `apps/mini-app/test/transaction-progress.test.ts` — test title: an on-chain revert stays separate from an unverified receipt (declaration line 83) |
| `UXP-C-REVIEW-014` | A confirmed result must require confirmed action evidence; an outer status alone is insufficient. | `apps/mini-app/test/transaction-result-render.test.ts` — test title: outer confirmed status cannot create a success card without confirmed action evidence (declaration line 257) |
| `UXP-C-REVIEW-015` | Actual receipt outcomes must remain separate from reviewed future terms in partial recovery. | `apps/mini-app/test/transaction-result-render.test.ts` — test title: partial recovery shows already confirmed wallet movements separately from reviewed future terms (declaration line 336) |
| `UXP-C-REVIEW-016` | Unavailable price impact or risk-price evidence must remain unavailable rather than become 0%. | `apps/mini-app/test/transaction-card-layout.test.ts` — test title: all position and loan reviews retain risk rows without manufacturing prices (declaration line 19) |
| `UXP-C-REVIEW-017` | Exact contract, spender, amount, native value, nonce and calldata must remain inspectable in one Execution details disclosure. | `apps/mini-app/test/advanced-review-layout.test.ts` — test title: review has a single Execution details disclosure with flat transaction and contract rows (declaration line 6) |
| `UXP-C-REVIEW-018` | Confirmed receipt rendering must not wait for a slow account refresh to finish. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: shows the confirmed receipt while wallet refresh is pending and starts completion concurrently (declaration line 1329) |
| `UXP-C-REVIEW-019` | Approvals and actions must retain separate hashes, labels and independent receipt states. | `apps/mini-app/test/transaction-progress.test.ts` — test title: approval and action hashes keep distinct labels and independent receipt states (declaration line 60) |
| `UXP-C-REVIEW-020` | Submitting twice during a delayed wallet signature must not produce repeated sends. | `apps/mini-app/e2e/specs/wallet-activity-send.spec.ts` — test title: Send latches repeated confirmation through a delayed signature and publishes its reviewed-network result once (declaration line 245) |

### Fees

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-FEE-001` | Network gas must remain separate from native transfer value and bridge protocol fees. | `apps/mini-app/test/gas-cost.test.ts` — test title: estimates every route step and separates gas from native transaction value (declaration line 57) |
| `UXP-C-FEE-002` | Base fee totals must include execution, L1 data and operator fees; missing components must remain partial. | `apps/mini-app/test/compact-transaction-footer.test.ts` — test title: Base requires all execution, L1 data and operator components; partial never becomes a total (declaration line 77) |
| `UXP-C-FEE-003` | Displayed gas shortfall must use the same buffered maximum that the wallet is required to fund. | `apps/mini-app/test/gas-cost.test.ts` — test title: the shortfall uses the same buffered basis that blocks signing, and adding it exactly unblocks (declaration line 436) |
| `UXP-C-FEE-004` | The ETH-to-add amount must round upward to the displayed 0.000001 ETH increment. | `apps/mini-app/test/gas-cost.test.ts` — test title: the ETH to add is rounded up, never down, to the 0.000001 ETH step reviews show (declaration line 492) |
| `UXP-C-FEE-005` | A partial fee estimate may prove insufficient funds but must not invent the exact shortfall. | `apps/mini-app/test/gas-cost.test.ts` — test title: a partial estimate proves a shortfall without inventing its size (declaration line 478) |
| `UXP-C-FEE-006` | A pending fee refresh must block confirmation even if a fresh cached estimate exists. | `apps/mini-app/e2e/trade-harness/review-preparation.spec.ts` — test title: fresh-cache visibility refresh disables confirmation until the request settles (declaration line 368) |
| `UXP-C-FEE-007` | A settled unavailable display estimate must be labelled honestly while execution retains its authoritative checks. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: keeps the editor visible until gas settles and labels an unavailable estimate honestly (declaration line 768) |
| `UXP-C-FEE-008` | Browser wallets choose their gas; app fee-tier controls and caps apply only to the embedded-wallet path. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: external wallets see estimated gas without fee tiers and receive no app fee caps (declaration line 368) |
| `UXP-C-FEE-009` | Fee USD conversions must use fresh native ETH prices and retain exact native fallback. | `apps/mini-app/test/fee-usd-presentation.test.ts` — test title: fees use fresh native ETH price, not transferred asset price; zero and tiny stay distinct (declaration line 8) |
| `UXP-C-FEE-010` | Missing, malformed or unbound protocol-fee data must never become a zero-fee claim. | `apps/mini-app/test/protocol-fee-review.test.ts` — test title: unbound, malformed or missing fee data never becomes a zero-fee claim (declaration line 124) |
| `UXP-C-FEE-011` | Confirmed paid fees must aggregate exact verified action and approval fees, not rounded labels or native value. | `apps/mini-app/test/compact-transaction-footer.test.ts` — test title: aggregates exact paid fees including approvals without reading rounded labels or native value (declaration line 66) |
| `UXP-C-FEE-012` | A successful bridge may show a verified destination explorer link but must not invent destination gas. | `apps/mini-app/test/compact-transaction-footer.test.ts` — test title: verified bridge destination adds a named explorer but does not invent destination gas (declaration line 133) |

### Portfolio

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-PORTFOLIO-001` | Tokens, DeFi and Activity must be separate accessible tab panels with roving keyboard navigation. | `apps/mini-app/e2e/specs/portfolio-hierarchy.spec.ts` — test title: supports roving keyboard navigation and wraps through all three tabs (declaration line 85) |
| `UXP-C-PORTFOLIO-002` | Disconnected Portfolio must show wallet entry and product links without fictional balance placeholders. | `apps/mini-app/e2e/specs/portfolio-hierarchy.spec.ts` — test title: offers a clear disconnected entry without placeholder balances (declaration line 216); `apps/mini-app/e2e/specs/portfolio-hierarchy.spec.ts` — test title: keeps Trade, Earn, and Borrow directly reachable from the disconnected home (declaration line 236) |
| `UXP-C-PORTFOLIO-003` | Canonical holdings must not be counted twice when an expanded indexed row also exists; stale fallback data must not replace a fresher canonical value. | `apps/mini-app/test/portfolio-valuation.test.ts` — test title: does not double count an expanded canonical row or use stale fallback data (declaration line 34) |
| `UXP-C-PORTFOLIO-004` | A positive holding without a price plus unrelated zero holdings must not produce a zero total. | `apps/mini-app/test/portfolio-refresh-regression.test.ts` — test title: nonzero ETH without a quote plus an unrelated zero balance is unavailable, not $0 (declaration line 30) |
| `UXP-C-PORTFOLIO-005` | Independent price timestamps must survive partial refresh; a fresh sibling quote must not freshen older assets. | `apps/mini-app/test/portfolio-refresh-regression.test.ts` — test title: per-token timestamps never inherit a different token's newer timestamp (declaration line 136) |
| `UXP-C-PORTFOLIO-006` | An authoritative newer zero balance must clear a prior positive holding. | `apps/mini-app/test/portfolio-refresh-regression.test.ts` — test title: a newer authoritative zero still removes a previously positive holding (declaration line 49) |
| `UXP-C-PORTFOLIO-007` | Failed initial reads must end skeletons with an explicit unavailable state and Retry. | `apps/mini-app/e2e/overlay-specs/portfolio-loading.spec.ts` — test title: reads that fail end every placeholder: each section says so with a retry (declaration line 298) |
| `UXP-C-PORTFOLIO-008` | Same-wallet refresh must retain verified holdings without renewing their original timestamps. | `apps/mini-app/test/wallet-assets.test.ts` — test title: pending refresh preserves canonical rows without restamping cached values (declaration line 218) |
| `UXP-C-PORTFOLIO-009` | A network filter must not call a still-pending network empty or failed. | `apps/mini-app/e2e/overlay-specs/portfolio-assets.spec.ts` — test title: a pending filtered network keeps loading copy instead of reporting a balance failure (declaration line 77) |
| `UXP-C-PORTFOLIO-010` | All-networks totals must wait for the complete initial scope while completed individual networks remain available. | `apps/mini-app/e2e/overlay-specs/portfolio-assets.spec.ts` — test title: all networks waits for the complete first scope while a ready network remains immediately available (declaration line 94) |
| `UXP-C-PORTFOLIO-011` | Only positively held, freshly valued assets below one dollar may enter the low-value group. | `apps/mini-app/test/portfolio-asset-groups.test.ts` — test title: groups positively held, freshly valued assets strictly below one dollar (declaration line 16) |
| `UXP-C-PORTFOLIO-012` | Unsupported indexed holdings must not enter canonical wallet totals. | `apps/mini-app/test/portfolio-valuation.test.ts` — test title: ignores unsupported indexed tokens when valuing fresh canonical ETH (declaration line 11) |

### History and receipts

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-HISTORY-001` | History must name confirmed actions in past tense and pending/failed actions as attempts. | `apps/mini-app/test/activity-classification.test.ts` — test title: a failed journal record states the attempt and that nothing moved (declaration line 429) |
| `UXP-C-HISTORY-002` | Journal, indexed movement and position-event evidence for one chain/hash must merge into one coherent transaction row. | `apps/mini-app/test/wallet-activity.test.ts` — test title: journal, indexed transfer and position event produce one row per chain/hash (declaration line 15) |
| `UXP-C-HISTORY-003` | Approval-only events must not appear as completed position actions. | `apps/mini-app/test/wallet-activity.test.ts` — test title: an approval is left out of History and never becomes a completed position or a transfer (declaration line 21) |
| `UXP-C-HISTORY-004` | Unknown token movements must retain an Unverified marker and exact technical details. | `apps/mini-app/test/activity-classification.test.ts` — test title: unverified-only incoming tokens are spam-suspect and never shown without a marker (declaration line 407) |
| `UXP-C-HISTORY-005` | Unknown-token-only incoming transactions must remain behind the unverified/spam filter. | `apps/mini-app/test/activity-classification.test.ts` — test title: unverified-only incoming tokens are spam-suspect and never shown without a marker (declaration line 407); `DESIGN.md` — Interaction and content — Show unverified toggle |
| `UXP-C-HISTORY-006` | A swap must be presented as one action rather than unrelated transfers. | `apps/mini-app/test/activity-classification.test.ts` — test title: the reported swap reads as one swap with rounded amounts, not four raw transfers (declaration line 62) |
| `UXP-C-HISTORY-007` | Saved resume drafts must contain editable form data and no executable transaction request. | `apps/mini-app/test/history-drafts.test.ts` — test title: signature-required history drafts are scoped and contain no executable request (declaration line 22) |
| `UXP-C-HISTORY-008` | A submitted hash must go to transaction progress rather than a retry/send-again action. | `apps/mini-app/test/task-state.test.ts` — test title: wallet task selector scopes transaction facts by identity and never offers retry for submitted hashes (declaration line 18) |
| `UXP-C-HISTORY-009` | History continuation must reconstruct a fresh review rather than execute stored data. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: keeps the draft after approval when action signing is rejected, then replans on resume (declaration line 639) |
| `UXP-C-HISTORY-010` | Receipt costs must use gas used and effective price and must distinguish reverted value/movements from paid gas. | `apps/mini-app/test/receipt-presentation.test.ts` — test title: reverted receipts show no token movement or native value (declaration line 76); `apps/mini-app/test/activity-receipt.test.ts` — test title: activity cost uses receipt gas used and effective price for successful and reverted transactions (declaration line 12) |
| `UXP-C-HISTORY-011` | Pending indicators must refer only to this wallet and avoid duplicate settlement notices while its review is open. | `apps/mini-app/test/pending-activity.test.ts` — test title: a step the open review already shows settles without a second notice (declaration line 68) |
| `UXP-C-HISTORY-012` | History dates must use Today/Yesterday and relative times today without misdating older rows. | `apps/mini-app/test/activity-time.test.ts` — test title: day headers read Today, Yesterday, then a short weekday date (declaration line 9) |

### Settings

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-SETTINGS-001` | Supported slippage presets are 0.1%, 0.5%, 1% and 2%. | `apps/mini-app/test/settings.test.ts` — test title: slippage presets are read from device storage as percentages (declaration line 20) |
| `UXP-C-SETTINGS-002` | Custom saved slippage must remain within 0.1%–2% in whole basis points. | `apps/mini-app/test/settings.test.ts` — test title: custom whole basis points between 0.1% and 2% are kept (declaration line 28) |
| `UXP-C-SETTINGS-003` | Gas-only changes must preserve a restored planner slippage value. | `apps/mini-app/e2e/trade-harness/review-preparation.spec.ts` — test title: Trade settings preserve restored planner slippage through gas-only changes and explicit matching preset choices (declaration line 201) |
| `UXP-C-SETTINGS-004` | Preference changes must update open forms and invalidate accepted reviews when their terms change. | `apps/mini-app/e2e/specs/action-review-harness.spec.ts` — test title: same-tab gas-tier preference changes invalidate the accepted review until an updated quote is explicit (declaration line 1244) |
| `UXP-C-SETTINGS-005` | Blocked storage must produce safe defaults and reset feedback without silently changing active values. | `apps/mini-app/e2e/overlay-specs/earn-form-consistency.spec.ts` — test title: shared settings reset visible preferences and report blocked storage without changing active values (declaration line 362); `apps/mini-app/test/settings.test.ts` — test title: invalid, corrupt, out-of-range, and throwing storage use the safe default (declaration line 39) |

### Telegram

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-TELEGRAM-001` | Only allowlisted start parameters may open fixed same-origin product paths. | `apps/mini-app/test/telegram-start-param.test.ts` — test title: start parameters open only the listed screens, at fixed same-origin paths (declaration line 50) |
| `UXP-C-TELEGRAM-002` | A Telegram start link must navigate only once per launch and preserve subsequent user navigation after reload. | `apps/mini-app/test/telegram-start-param.test.ts` — test title: reloading after a start screen opened leaves the visitor where they went (declaration line 161) |
| `UXP-C-TELEGRAM-003` | A missing or delayed Telegram bridge must not indefinitely block usable app entry. | `apps/mini-app/e2e/specs/official-routes.spec.ts` — test title: a Telegram launch remains usable when its bridge never arrives (declaration line 154) |
| `UXP-C-TELEGRAM-004` | Host chrome colors and haptics must be version-gated and must not call Telegram-only APIs through browser stubs. | `apps/mini-app/test/telegram.test.ts` — test title: browser-injected Telegram stub never receives Telegram-only calls (declaration line 91); `apps/mini-app/test/telegram.test.ts` — test title: supported Telegram host receives haptics and version-gated chrome colors (declaration line 115) |
| `UXP-C-TELEGRAM-005` | Telegram entry must say Sign in while browser entry remains Connect. | `apps/mini-app/e2e/specs/network-selector.spec.ts` — test title: labels the Telegram entry Sign in without changing the browser entry (declaration line 291) |

### Landing

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-LANDING-001` | Every device must retain explicit web-app and Telegram launch actions. | `DESIGN.md` — Public landing page |
| `UXP-C-LANDING-002` | The four product cards must link directly to their real Trade, Earn, Borrow and Move routes. | `apps/landing/test/static.test.mjs` — test title: the four product cards link to their web routes and the three-use calculator (declaration line 85) |
| `UXP-C-LANDING-003` | Financial calculator fields requiring live data must begin blank rather than use fictional live values. | `apps/landing/test/static.test.mjs` — test title: calculator figures start blank where live data is required, use concise labels, and preserve their math (declaration line 121) |
| `UXP-C-LANDING-004` | The Earn calculator is a one-year constant-APY scenario, Borrow a stated 50% LTV scenario, and Trade gross exposure at a ±10% price move; none is an executable quote or borrowing limit. | `apps/landing/README.md` — Visual and performance notes — #outcomes |
| `UXP-C-LANDING-005` | Independent upstream failures must leave the healthy market metric available. | `apps/landing/test/market-data-server.test.mjs` — test title: partial upstream failure leaves the healthy source available (declaration line 65) |
| `UXP-C-LANDING-006` | Expired or future source timestamps must not be refreshed into valid prices. | `apps/landing/test/market-data.test.mjs` — test title: rejects stale and future market prices without refreshing their source times (declaration line 54) |
| `UXP-C-LANDING-007` | A zero validated APY or TVL must remain a real zero rather than an unavailable state. | `apps/landing/test/market-data.test.mjs` — test title: allows real zero APY or vault TVL and preserves percentage-point units (declaration line 66) |
| `UXP-C-LANDING-008` | Only the newest refresh may publish or schedule the next poll. | `apps/landing/test/market-data-client.test.mjs` — test title: only the newest overlapping refresh may publish or schedule the next poll (declaration line 62) |
| `UXP-C-LANDING-009` | Foreground resume must expire old values before starting its replacement request. | `apps/landing/test/market-data-client.test.mjs` — test title: foreground resume expires old values synchronously before starting its request (declaration line 86) |
| `UXP-C-LANDING-010` | The generated Telegram QR must encode the same validated launcher as the app actions. | `apps/landing/test/static.test.mjs` — test title: the Telegram QR encoder matches the app renderer module for module (declaration line 283) |

### Performance

| ID | Required behavior | Evidence |
| --- | --- | --- |
| `UXP-C-PERF-001` | The market publish cadence must remain capped at 250ms with a 20-second freshness boundary. | `docs/performance/market-render-updates.md` — Market quote render work |
| `UXP-C-PERF-002` | Ticks for one instrument must not rerender an unaffected instrument while both independently expire. | `apps/mini-app/e2e/overlay-specs/live-market-store.spec.ts` — test title: BTC-only ticks do not rerender ETH consumers, while each instrument still expires (declaration line 52) |
| `UXP-C-PERF-003` | Reviews may pause automatic block-triggered position refreshes while manual refresh, wallet changes and receipt reconciliation remain available. | `apps/mini-app/e2e/overlay-specs/position-provider-retry.spec.ts` — test title: review pauses coalesce block refreshes while manual refresh and wallet changes remain available (declaration line 84) |
| `UXP-C-PERF-004` | A failed initial position read must retry automatically with a bounded budget. | `apps/mini-app/e2e/overlay-specs/position-provider-retry.spec.ts` — test title: position retry budget stops after two retries (declaration line 158) |
| `UXP-C-PERF-005` | Reported form/quote/account timing must disclose fixture delays and must not claim production performance or an improvement without a comparable baseline. | `apps/mini-app/e2e/performance-evidence.md` — Performance evidence |

### Wallet picker and session UX

| ID | Atomic contract | Exact source evidence |
| --- | --- | --- |
| `UXP-C-MOBILE-001` | An explicitly selected legacy provider must remain the signing provider after aggregate window.ethereum replacement and late wallet discovery. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: selected legacy provider stays pinned after window.ethereum replacement and late discovery (declaration line 334) |
| `UXP-C-MOBILE-002` | A passively restored session must clear on a later duplicate wallet identity while an unrelated discovered wallet leaves it intact. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: a fully restored passive session ${duplicateIdentity ? 'clears on a late duplicate identity' : 'survives a late unrelated wallet'} (declaration line 409) |
| `UXP-C-MOBILE-003` | An explicit provider choice must remain pinned after a duplicate identity, while a subsequent ambiguous selection fails closed. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: an explicitly selected provider stays pinned after a duplicate identity but future selection fails closed (declaration line 435) |
| `UXP-C-MOBILE-004` | A saved wallet identity with missing, invalid or zero account data must confer no silent restore authority. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: a saved rdns with a ${savedAddress} address never silently restores but explicit selection still works (declaration line 464) |
| `UXP-C-MOBILE-005` | Account, chain or disconnect events received during account preflight must prevent a transaction request in that turn. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: ${event} during account preflight prevents a transaction in the same turn (declaration line 484) |
| `UXP-C-MOBILE-006` | A chain-change event during a held chain read must invalidate that snapshot before signing. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: chainChanged during a held chain read rejects its stale snapshot before signing (declaration line 519) |
| `UXP-C-MOBILE-007` | All connection consumers must join one visible approval attempt through rerenders. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: pending approval stays visible through rerender and repeated consumer connects are single-flight (declaration line 1045) |
| `UXP-C-MOBILE-008` | Back from a pending wallet approval must stop accepting that result while preserving the open picker and focused wallet row. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: Back stops waiting, keeps the picker open, and ignores a late approval before another choice (declaration line 1071) |
| `UXP-C-MOBILE-009` | Escape, browser Back, Close and backdrop dismissal must cancel the picker and prevent a late approval from replacing a newer accepted choice. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: ${dismissal} cancels pending approval and a late result cannot replace a reopened connection (declaration line 1092) |
| `UXP-C-MOBILE-010` | A rejected approval must remain an in-modal error whose retry prompts the same chosen provider only. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: a rejected approval leaves an in-modal error and Retry prompts only the same wallet (declaration line 1128) |
| `UXP-C-MOBILE-011` | Cancelling a failed reconnect attempt must preserve the already accepted wallet and its signing provider. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: cancelling a reconnect preserves the existing selected wallet and signing provider (declaration line 1151) |
| `UXP-C-MOBILE-012` | Reopening and explicitly reselecting a wallet with an outstanding approval must reuse that request. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: closing and reselecting the same wallet reuses its still-open approval without a duplicate request (declaration line 1427) |
| `UXP-C-MOBILE-013` | A previously selected provider reconnect event may restore only the pinned account after fresh account and chain validation. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: ${event} after a provider disconnect silently restores the pinned account and validated chain without window focus (declaration line 1449) |
| `UXP-C-MOBILE-014` | Manual disconnect or a new wallet choice must win over a stale held reconnect validation. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: ${event} reconnect validation cannot publish a stale held read after ${interruption} (declaration line 1483) |
| `UXP-C-MOBILE-015` | A chain change during reconnect validation must schedule a fresh validation while preserving newer user intent. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: chainChanged during a held reconnect read reschedules validation safely: ${outcome} (declaration line 1537) |
| `UXP-C-MOBILE-016` | Manual local disconnect must detach provider restore listeners and block later provider events or announcements from silently reconnecting. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: manual local disconnect blocks late connect and accountsChanged from silently restoring a wallet (declaration line 1597) |
| `UXP-C-MOBILE-017` | Cancelling the picker after an inactive-account or provider-disconnect event must detach the old provider and ignore a late account event. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: cancelling after ${event} leaves the inactive provider detached and ignores a late old account (declaration line 1626) |
| `UXP-C-MOBILE-018` | A delayed network-switch read must never overwrite a newer chainChanged event. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: a delayed network-switch read cannot overwrite a newer chainChanged event (declaration line 1653) |
| `UXP-C-MOBILE-019` | Each initial wallet choice must use one local logo-and-name row without asserting installation or connection. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: the picker has one logo-and-name row per wallet with no route categories or manual choices (declaration line 584); `apps/mini-app/public/wallets/README.md` — Wallet marks; opening paragraphs and final Base mark paragraph |
| `UXP-C-MOBILE-020` | Detected wallet rows must deduplicate exact providers, preserve focus, and require explicit selection. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: detected ${name} and unknown wallets appear first and stay deduplicated under Other (declaration line 604) |
| `UXP-C-MOBILE-021` | A mobile wallet handoff must use one user-activated safe destination without claiming a connection. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: ${name} mobile handoff selects one verified safe destination from ${path} without claiming a connection (declaration line 911) |
| `UXP-C-MOBILE-022` | An absent desktop wallet must open only its configured official installation destination without connecting. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: desktop absent-wallet selection opens only its official installation page and remains disconnected (declaration line 863) |
| `UXP-C-MOBILE-023` | Wallet link-copy recovery must preserve the safe product route while removing authentication and Telegram parameters. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: wallet guidance copies the safe current FxAeon route and shows a selectable URL when clipboard access fails (declaration line 974) |
| `UXP-C-MOBILE-024` | After handoff, fresh wallet discovery must wait for explicit retry and must not reopen a link or borrow another provider. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: handoff retry resolves fresh ${rdns} injection without automatically connecting or reopening a link (declaration line 1001) |
| `UXP-C-MOBILE-025` | Wallet help must remain within the single picker and return focus without initiating a connection. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: wallet help stays inside the picker and returns focus without starting a connection (declaration line 1251) |
| `UXP-C-MOBILE-026` | Wallet search and Back must preserve the entered query, route and relevant focus after an error. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: Other wallets searches all choices and Back preserves focus, search and route across an error (declaration line 1173) |
| `UXP-C-MOBILE-027` | The picker focus trap must wrap within available controls and omit closed recovery help controls. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: recovery focus trap excludes closed help controls and follows the disclosure when opened (declaration line 1220); `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: keyboard focus wraps and Escape quietly cancels the whole picker (declaration line 1292) |
| `UXP-C-MOBILE-028` | Wallet rows in the current dark theme must fit the viewport and retain at least 44-by-44-pixel targets. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: minimal wallet rows fit ${theme} at ${viewport.width}px with real local marks (declaration line 1314) |
| `UXP-C-MOBILE-029` | All wallet list, search, pending and error controls must remain reachable at 320-pixel width with short height or doubled text. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: ${view} keeps every control reachable with ${enlarged ? '200% text' : 'a short viewport'} (declaration line 1347) |
| `UXP-C-MOBILE-030` | Reduced motion must leave both wallet sheet and pending indicator still while retaining focus behavior. | `apps/mini-app/e2e/specs/mobile-wallet.spec.ts` — test title: reduced motion holds the sheet and pending indicator still (declaration line 1409) |

### Wallet read freshness and demand

| ID | Atomic contract | Exact source evidence |
| --- | --- | --- |
| `UXP-C-RPCB-001` | Concurrent form and portfolio balance observers must share exact wallet reads. | `apps/mini-app/e2e/overlay-specs/wallet-rpc-proof.spec.ts` — test title: cold form and portfolio observers share one exact read and display it sooner (declaration line 90) |
| `UXP-C-RPCB-002` | Manual wallet refresh must update all matching consumers without changing the entered amount. | `apps/mini-app/e2e/overlay-specs/wallet-rpc-proof.spec.ts` — test title: manual refresh, account changes and disconnect keep freshness and session isolation (declaration line 110) |
| `UXP-C-RPCB-003` | An account change or disconnect must not publish the prior session balance or restart reads after disconnect. | `apps/mini-app/e2e/overlay-specs/wallet-rpc-proof.spec.ts` — test title: manual refresh, account changes and disconnect keep freshness and session isolation (declaration line 110) |
| `UXP-C-RPCB-004` | Hidden or off-route wallet observers must stop periodic work and refresh when they return. | `apps/mini-app/e2e/overlay-specs/wallet-rpc-proof.spec.ts` — test title: hidden and off-route observers stop periodic work and resume with fresh balances (declaration line 138) |
| `UXP-C-RPCB-005` | Base wallet feeds must run only while a consumer requests Base data, and visibility or disconnect must stop feeds. | `apps/mini-app/e2e/overlay-specs/wallet-rpc-proof.spec.ts` — test title: Ethereum-only demand skips Base subscriptions and restores them for the portfolio profile (declaration line 166) |

### Query notification lifecycle

| ID | Atomic contract | Exact source evidence |
| --- | --- | --- |
| `UXP-C-QUERY-001` | Synchronous cache notifications must schedule React-store publication after the notification stack.  | `apps/mini-app/test/deferred-query-cache-notification.test.ts` — test title: defers synchronous query-cache notifications and ignores queued work after unsubscribe (declaration line 5) |
| `UXP-C-QUERY-002` | Unsubscribing must cancel the authority of already queued cache notifications. | `apps/mini-app/test/deferred-query-cache-notification.test.ts` — test title: defers synchronous query-cache notifications and ignores queued work after unsubscribe (declaration line 5) |

## Audit artifact checks

JSON syntax, unique IDs, schema keys, allowed status values and evidence-path existence are validated locally. Test-title evidence was extracted with the installed TypeScript parser, including nested template expressions. No product test results are claimed here. The coverage follow-up additionally validates the combined audit path union against every source-inventory test/document entry and distinguishes the mobile named-suite group from executable test declarations.
