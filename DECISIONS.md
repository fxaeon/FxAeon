# FxAeon rebuild decisions

Status: step-3 checkpoint complete and continuation authorized; step 4 active.
Date: 22 October 2026.
Baseline specification: [BEHAVIOR_SPEC.md](BEHAVIOR_SPEC.md).
Reference evidence: [REFERENCES.md](docs/rebuild/REFERENCES.md).

This log records choices and their consequences. It does not waive missing
verification. The user requested a checkpoint after the first complete long
slice; later modules and final release remain separate milestones.

## D-001 — Preserve both financial invariants

**Decision.** The selected user wallet remains the only application signer.
Protocol planning stays inside the pinned, reviewed SDK and its fifteen-method
facade. No private-key UI, key storage, server planner or delegated execution.
The browser owns reads, validation, preparation and execution coordination.

**Reason.** These are explicit user invariants and the common safety boundary
in `SEC-ARCH-*`. A rewrite is not permission to invent an alternative planner.
No invariant change is proposed.

## D-002 — Isolated replacement until parity

**Decision.** Build under `rebuild/` with its own package manifest, lock,
configuration, source, tests and output. Keep the old `apps/`, scripts, workflows,
patches and root toolchain untouched until step 5 passes. No imports from old
application modules, copied component bodies or rewritten-in-place tests.

**Reason.** A real baseline and an independently runnable replacement make
behavior loss visible and preserve a usable comparison. The baseline audit
milestone is `648f45ec92dc95ce3acd54bba99e06520c3bc778`.

**Cutover.** After complete parity and real local-fork proof, remove the old
application tree and promote the staged tree in one reviewed milestone. Retain
provenance documents. Do not merge or deploy before the requested gates.

## D-003 — Static React, strict TypeScript and Vite

**Decision.** React 19.3.1, React DOM 19.3.1, TypeScript 5.9.3, viem 2.57.7,
`@aladdindao/fx-sdk` 1.0.5, Node 22 and pnpm 11.19.0. Vite **8.3.4** builds the
static client. Exact versions and transitive integrity live in the new lock.
The current Vite registry metadata declares Node `^20.19.0 || >=22.12.0`, which
includes the provisioned 22.23.4 runtime.

The initially considered 8.3.5 release did not meet the retained 24-hour package
age policy at installation time. Select 8.3.4 instead of weakening that policy.

**Reason.** The application has no server-rendered financial authority. A small
static client removes framework runtime and export machinery unrelated to its
job. React/viem versions remain those already pinned by the audited baseline;
the application implementation is new. Vite is a build dependency only.

**Tradeoff.** Routing, security headers, accessible overlays and loading states
must be explicit. Static landing and app entry points remain independently
loadable. SDK/wallet code must not become a marketing-page prerequisite.

**Sources.** [Vite production build guide](https://vite.dev/guide/build), official
npm registry metadata inspected on 2026-10-22, baseline manifests. The Vite
selection is a technical choice. The original registry audit timed out; the
replacement's locked graph was separately audited successfully at the checkpoint.

## D-004 — Small transaction core with explicit ports

**Decision.** Pure domain amounts, intent, state transitions and review identity
sit below UI. Explicit wallet, protocol-read/plan and journal ports isolate
effects. One controller owns the transaction lifecycle. React observes state;
rendering cannot send a transaction. One integrator owns shared interfaces and
assembly. Feature modules may not call SDK planners or wallet sends directly.

**Reason.** The accepted route needs one identity across form, review, signing,
receipt and history. A global mutable UI store or many independent effects
would make stale results and double execution harder to constrain.

**Acceptance.** Tests exercise expiry, cancellation, superseded responses,
same-address provider replacement, wrong chain, nonce drift, duplicate confirm,
receipt identity, uncertain submission and storage failure using the same core
that the app renders. No source-regex-only substitute for those behaviors.

## D-005 — First slice: new ETH long funded with native ETH

**Decision.** The checkpoint supports a new Ethereum ETH long, native ETH input,
exact amount, selected leverage and slippage, SDK route, simulation, explicit
review, wallet request, receipt and scoped history. Native ETH avoids inventing
an approval that the route does not need. Other tokens, position modifications,
Borrow, Earn and Move remain later bounded modules; they are not fake working
tabs in the checkpoint.

**Reason.** This is a real end-to-end financial path with a finite policy surface.
The user explicitly requested one vertical slice before expansion. More assets
and approval routes add independent acceptance work, not quality by themselves.

**Limits.** Conservative product leverage choices must still intersect live
pool bounds. Unknown limits cannot authorize signing. The input remains
editable while disconnected. Native Max is available only with a sufficiently
fresh route fee estimate; a guessed reserve is not a valid Max.

**Evidence required.** Real SDK call and exact decoded policy; deterministic
failure/browser coverage; and separately identified actual f(x) local-fork
execution when an authorized working archive endpoint is available. A fixture
cannot be presented as the last item.

## D-006 — Reviewed terms and exact units remain visible

**Decision.** The review shows paid ETH, estimated resulting stETH collateral,
fxUSD debt, requested versus estimated leverage, execution price, enforced
wstETH converter minimum, fee provenance and exact transaction details.
Unavailable price impact/risk/fee facts remain unavailable. A fresh canonical
receipt and owner/accounting read establish the final position; the requested
leverage is never relabeled achieved.

**Reason.** `SEC-AMOUNT-*`, `SEC-ECON-*`, `SEC-RECEIPT-*` and the product audit
identify these unit/provenance boundaries as safety behavior. Rabby informs
effect presentation; Uniswap informs accepted terms. Their protocol mathematics
and implementation code are not reused.

**Timing.** Keep 30-second accepted expiry and one 45-second preparation budget.
The editor remains visible until required checks settle. Explicit refresh
reopens accepted terms; confirmation never substitutes an unseen plan.

## D-007 — Preserve reviewed vendor patches as vendor inputs

**Decision.** Application, UI, tests, configuration and product documentation
are authored afresh. The exact reviewed third-party patch files are retained as
versioned vendor inputs with provenance and hashes; the SDK pin is unchanged.
New tests exercise the installed patched ESM/CJS artifacts. Unused dependencies
may be excluded, but a dependency's reviewed fix must be applied if it returns.

**Written justification for the narrow file-rewrite exception.** Rewriting a
reviewed dependency correction merely to change every file's bytes adds risk
without improving behavior. Preserving those correction inputs is the strongest
interpretation of the user's explicit patch-preservation invariant. This is
not reuse of old application code and does not alter either financial invariant.
The exception is surfaced at the checkpoint for review.

**Acceptance.** Hash checks plus real installed-bundle regression tests for the
SDK. Privy fee-unit and query-string fixes remain required when its later
adapter is introduced. Braces mitigation/expiry applies if that affected
dependency exists in the new graph; an absent package needs evidence, not a
copied audit exception. The original deadline is 3 November 2026.

## D-008 — Wallet identity is a capability

**Decision.** Ordinary web uses explicitly selected EIP-6963/EIP-1193 providers.
The selected raw object, account, chain and generation bind every review and
send. No unsolicited account prompt. No signer fallback. Account/chain/provider
change invalidates unissued work. An already-issued request retains its original
outcome for recovery, without authorizing another send.

**Telegram.** Host adapters own safe-area/viewport, Back and foreground events.
Launch data is never stored or logged. The later Privy adapter remains lazy and
must preserve the audited semantic identity/dispatch boundary. The first slice
may offer an explicit external-wallet handoff; it does not claim native Privy
authentication is implemented or validated before that module is complete.

**Source.** `SEC-WALLET-*`, `SEC-TELEGRAM-*`, and the
[official Telegram Mini Apps API](https://core.telegram.org/bots/webapps).
Browser emulation cannot close physical-device evidence gaps.

## D-009 — Release signing and test isolation

**Decision.** Tests never sign through a public RPC or real user account. The
read-only local-fork transport accepts only loopback and proves Anvil plus its
Ethereum fork metadata. A future actual-fork wallet harness must use only its
disposable local account and remain outside the production application graph;
that execution harness is not completed at this checkpoint. Deterministic
fixtures have a separate build entry/runtime and a
persistent visible simulation label. Production cannot select a fixture by URL.

**Reason.** The user explicitly prohibits real funds. An Ethereum chain ID alone
cannot distinguish a local fork from mainnet. A test wallet shim must not turn
an accidental endpoint change into a live transaction.

**Current blocker.** No authorized working archive RPC is configured. Read-only
public probes failed or rejected access; no origin restriction is bypassed.
Finish useful implementation and deterministic checks, record fork tests as
blocked, and do not remove the old tree or claim parity. No public financial
transaction is part of this rebuild work.

## D-010 — One owned visual language

**Decision.** FxAeon's new direction uses graphite surfaces, warm-white type,
restrained green for primary action/selected intent, and semantic colors for
warnings and failures. One spacing/radius/type scale serves landing, app and
documentation. Create an original geometric FxAeon mark and local vector icons;
retain official protocol/token identity only where accurate.

**Reason.** The inspected baseline was charcoal/blue. The user explicitly gave
freedom to replace that styling. The reference repos inform review hierarchy,
responsive composition and feedback; combining their skins would dilute the
product's identity. Prior violet concepts are not a current requirement.

**Composition.** Make asset, direction, amount and action legible first. Desktop
uses deliberate whitespace and a focused ticket; phone uses its own stack and
reachable action. Use few containers, consistent dividers and exact-value
disclosure instead of decorative status clutter. No fabricated charts, APRs,
portfolio balances or price changes as decoration.

**Themes.** Dark is the default. Semantic tokens support an independently checked
light theme, with transaction preferences unchanged. This deliberately expands
the current dark-only baseline and replaces older contradictory theme prose.

**Motion.** Short opacity/translation transitions explain state changes; no
decorative continuous animation in financial flows. Honor reduced motion and
retain layout space during loading. A submitted trade cannot animate as success
before receipt proof.

## D-011 — Accessibility is acceptance, not decoration

**Decision.** Native inputs/buttons, explicit labels/errors, keyboard operation,
visible focus, live status announcements, 44px targets, 48px primary financial
actions, safe-area padding and one focus/scroll owner for review. Financial
details must survive 200% text and narrow widths. Native history/Telegram Back
dismiss the top overlay before leaving a form.

**Checks.** Running browser at 320, 393, 768 and 1440px; 200% text; both themes;
reduced motion; keyboard focus; scroll reachability; automated axe checks where
available. Native Telegram and physical wallets remain distinct external tests.
The old missing Windows reference set is not imported as approved imagery.

## D-012 — Performance budgets that measure the candidate

**Decision.** Initial candidate app critical JS gzip target ≤180 KiB, critical
CSS gzip ≤25 KiB, independently loaded landing JS gzip ≤40 KiB. Full app lazy
SDK graph gzip ceiling ≤1.5 MiB for this slice. Report emitted sizes and route
readiness under a declared browser/CPU/network setup. An imported SDK can load
on demand; it must not block the amount editor.

**Runtime targets.** No long task >200ms during ordinary input/review updates in
the deterministic browser journey; editable ticket within 2.5s under the stated
controlled test setup. Live quote latency is reported separately because chain
and provider latency vary. Targets are provisional until measured; a failed
budget is an issue, not an undocumented increase.

**Reason.** Original bundle ceilings were broad and near their limits; recorded
timings alone did not enforce responsiveness. Do not claim faster performance
without an equivalent measured comparison. Images/fonts are locally hosted,
layout-stable and optional for functional readiness.

## D-013 — New verification, preserved guarantees

**Decision.** Rebuild tests from the behavior contract. Domain tests cover exact
math and state; adapter tests cover real SDK decoding/patches and transport;
browser tests exercise the built app; a separate local-fork suite proves actual
protocol execution. Track individual behavior IDs to named tests and current
results. Deliberately changed markup/source-shape contracts map to stronger
behavioral checks and this log.

**Reason.** Copying old tests against copied implementation would violate the
clean rewrite and obscure changed assumptions. Conversely, replacing thousands
of contracts with one happy-path screenshot would erase the safety boundary.

**Baseline.** Original `pnpm verify` failed at registry audit; 1,611 application
tests passed and four fork cases skipped. An independent original build/type/
bundle phase passed. Supplemental browser version is recorded explicitly. No
historical release report substitutes for current candidate evidence.

## D-014 — Recovery is observation before action

**Decision.** Persist scoped intent and verify its read-back before wallet
dispatch, then persist the hash when returned. If storage is unavailable before
the prompt, stop before asking the wallet. This strengthens cross-tab recovery;
it is not acceptable to silently waive that guarantee in private-storage modes.
A later storage exception preserves the in-memory hash and the earlier durable
unresolved hint. Stored calldata is comparison evidence, never retry authority.
History displays attempted, pending, unverified, reverted and confirmed states
distinctly. Reopening only rechecks chain evidence; it cannot trigger a prompt.
Imported terminal labels, including a no-hash `declined`, are not proof. A
directly observed current-session rejection can remove its own persisted hint.

**Uncertain recovery.** A restored attempt with no hash remains blocked from
automatic resend. Resolving that uncertainty needs separately verified wallet/
chain evidence in the later recovery module, not a local “clear” switch.

**Reason.** Transaction uncertainty is not proof of failure. A polished Retry
button must never duplicate a spend. Source: `SEC-RECOVERY-*`, `SEC-LOCK-*` and
the Lido reference's preservation of partial completion.

## D-015 — Bounded modules after the checkpoint

| Module | Acceptance boundary and required evidence |
| --- | --- |
| Wallets / Telegram | Exact selected-provider authority, Privy dispatch, safe handoff, host constraints; deterministic race tests plus native-device evidence |
| Trade / Positions | All four markets, tokens, add/reduce/leverage/close, canonical ownership and accounting; policy tests, browser journeys and actual local-fork transactions |
| Borrow | Exact deposit/mint/repay/withdraw with ID/fee/risk limits; independent amount tests and real local-fork lifecycle |
| Earn | Correct shares/assets, no invented final-share guarantee, instant/direct/queue/claim; actual fork accounting/cooldown/dual-token receipt proof |
| Move | Exact OFT policy, source/destination split and recovery; deterministic message-proof tests plus separate cross-chain evidence |
| Portfolio / History / Send | Partial data honesty, scoped recovery and exact transfers; verified receipts, stale races, pagination, account isolation and responsive checks |
| Landing / docs / design system | Independent lightweight build, accurate copy/data, tokens/states/motion, accessibility and load budgets; actual renders and interaction |
| Delivery / final review | Full parity manifest, frozen dependency install/audit, CSP/secrets/budgets, production browser/fork gates, independent running-app review |

One integrator merges bounded work. Independent agents get non-overlapping files
and typed contracts. The reviewer inspects the running app and test evidence;
builder explanations do not constitute acceptance. The final report states
verified, blocked, unverified and deferred scopes without “should work”.

## D-016 — Dispatch authorization is checked after the last awaited read

**Decision.** The wallet port requires a synchronous `beforeDispatch` guard.
After its final bounded account/chain/provider reads, the selected-wallet adapter
calls that guard with no await before raw dispatch. The guard rechecks accepted
intent, session, generation, cancellation, clock rollback and expiry; persists
the prospective attempt; then transitions to signing. Both the controller's
preflight phase and the adapter's read-only phase are bounded and cancellable.

An already-issued wallet prompt has a different lifetime: it remains observed,
and cannot be abandoned or replayed just because the review clock later expires.
The external wallet remains the only signer and owns its fee selection.

**Reason.** Independent review reproduced expiry during final wallet reads and
a cancellation that left a read lock hanging. Checking only before entering the
wallet adapter was insufficient. The regression suite now exercises the actual
adapter's final guard and the controller's cancellation boundary. All started
promises remain observed even when a provider synchronously retires a session.

**Receipt publication.** A fresh draft retires the previous attempt's association
with the active review. Late receipt work can update History but cannot replace
the new review. Failed re-verification withdraws current proof. A fresh outer
receipt without a verified position is retained as receipt evidence only.

## D-017 — Apply the supplied mobile reference direction

**Decision.** Use the supplied Phantom phone screenshots as concrete visual
evidence: strong value/title hierarchy, quiet neutral surfaces, grouped settings
rows, restrained separators, compact navigation and one-purpose sheets. Retain
an original FxAeon identity and one owned mint accent. ChatGPT's cleanliness is
a stated preference; no ChatGPT screenshot was in the first twenty attachments.
Do not reproduce reference account data, personal identifiers or brand assets.

**Application.** All product screens share one shell and one transaction review
surface. Amounts, fees, chain, expected effects and unresolved outcomes remain
readable. Cleaner layout does not justify replacing missing evidence with zero
or hiding a required financial disclosure. Static screenshots establish no
motion timing or live-data correctness. The reference study is recorded in
`rebuild/docs/REFERENCE_DIRECTION.md`.

## D-018 — Generalize execution without adding protocol methods

**Decision.** The remaining products use a typed operation intent, immutable
ordered plan and per-step receipt state. Exactly the approved SDK facade plans
protocol writes. Read-only canonical verification, native/ERC-20 wallet sends
and the existing OFT approval behavior remain within the audited baseline.
Every action after an approval requires that approval's canonical receipt and
fresh context/simulation before a new prompt. Unknown submission never advances
or automatically repeats a step. The existing independently authored long slice
remains regression evidence during integration.

**Gate.** Expanded UI and deterministic evidence do not authorize production
release. The full behavior map and actual local-fork transactions remain
mandatory before removing the original tree. User continuation approval does
not waive those gates or authorize use of real funds.

## D-019 — Borrow withdrawal units and reviewable SDK limits

**Decision:** Repay-and-withdraw presents the canonical pool collateral token:
`wstETH` for ETH longs and wallet-unit `WBTC` for BTC longs. Deposits retain the
reviewed converter routes; Trade reductions retain their independently verified
output conversions. This does not change the 15-method surface or SDK patch.

**Reason:** In pinned SDK `Position.repayAndWithdraw`, cross-asset withdrawal
conversion divides the entered output amount by its decimal scale and the
collateral rate without an independent cross-asset price conversion. A nominal
USDC withdrawal can therefore imply unrelated collateral exposure. The adapter
must not silently reinterpret the user's amount or rewrite the SDK transaction.
The product rejects that ambiguity and states the supported collateral unit.
The explicit freedom to cut product options authorizes this narrower control;
it is not an invariant waiver or a claim of identical old UI behavior.

**Accounting source:** Official
[PositionOperateFacet.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/periphery/facets/PositionOperateFacet.sol)
and
[PoolManager.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/PoolManager.sol).
Supply/withdraw/borrow/repay fee ratios in these paths use 1e9. fxSP's separate
instant-redemption fee uses 1e18; an initial suspicion of a vendor defect was
rejected after primary-source verification. No SDK change was made.

**Acceptance:** Independently decode exact withdrawal token/amount, bind scaling
and current mint-router fee tuple, distinguish borrowed principal from fxUSD
received, preserve zero-leg operations, test both 18-decimal accounting and
8-decimal wallet WBTC, reject ambiguous output-token requests, and prove receipt
accounting on a local fork. Implementation is active; this decision alone does
not satisfy those checks.
