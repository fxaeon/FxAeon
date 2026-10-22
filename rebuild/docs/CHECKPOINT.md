# FxAeon — step 3 checkpoint

Date: 22 October 2026. Branch: `rebuild/fxaeon-foundation-20261022`.
Original baseline: `b69d9ce1be59f982fca3ac43a8b037f7037269d4`.
Audit milestone: `648f45ec92dc95ce3acd54bba99e06520c3bc778`.

**The specification, decisions and first native-ETH leveraged-long slice are
ready for the requested review. Work stops here before expanding the remaining
modules.** The checkpoint verification passed. The complete product, full
behavior parity, actual local-fork transactions and native-device execution
have not passed their later gates.

All **919 files tracked at the original baseline remain unchanged**. The new
application is isolated under `rebuild/`; no old application module is imported.
No real funds, public-chain financial transactions, deployment or cutover were
used to produce this checkpoint.

## What to review

| Deliverable | Location and scope |
| --- | --- |
| Behavior contract | [BEHAVIOR_SPEC.md](../../BEHAVIOR_SPEC.md), with three normative JSON evidence ledgers |
| Baseline evidence | [BASELINE.md](../../docs/rebuild/BASELINE.md), including the original aggregate failure |
| Reference study | [REFERENCES.md](../../docs/rebuild/REFERENCES.md): 14 requested repositories/organizations, 38 inspected source files, pinned links and adopt/avoid decisions |
| Architecture and product decisions | [DECISIONS.md](../../DECISIONS.md), D-001 through D-016 |
| Runnable client | [README.md](../README.md), production and clearly labeled simulation commands |
| Visual language | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), original mark, both themes, typography, spacing, controls, states and motion |
| Acceptance tracking | [SLICE_ACCEPTANCE.json](SLICE_ACCEPTANCE.json), scoped new checks against every old ledger ID |
| Current work and unresolved issues | [PLAN.md](../../PLAN.md) and [ISSUES.md](../../ISSUES.md) |

The audit contains **3,373 overlapping evidence records** tied to all 243
inventoried old test files and 46 documents. These are not 3,373 distinct user
features or passing tests. File/evidence coverage does not imply every old
assertion was manually reviewed or executed. The reference work inspected
primary source code; it does not claim a live usability review of those apps.

The acceptance map has 16 scoped checks, 57 partially covered behavior IDs and
3,316 deferred IDs. No broad, multi-product behavior is marked fully complete
merely because its new-long subset passes. `fullParityPassed` is explicitly false.

## The implemented slice

The current product surface is **Trade and History for a new ETH long on
Ethereum, funded with native ETH**. Other products are deferred and do not
appear as pretend working screens.

1. Enter an exact ETH amount, requested leverage and slippage. Integer unit
   conversion preserves all 18 decimal places; display rounding never becomes
   the financial input. Product leverage is constrained to 1.1–5× and must also
   satisfy independently read live pool limits.
2. Explicitly select a wallet. Its raw provider object, request capability,
   account, chain and generation bind the accepted intent. The app does not
   prompt for connection on load or silently fall back to another signer.
3. Call the installed, patched SDK planner. Independently decode and validate
   its destination, value, nested actions, pool, position identity, converter
   paths, minima and debt packing. Reconstruct economic terms from fresh reads.
4. Simulate and obtain fee/nonce/balance evidence. Unknown facts remain unknown;
   missing required facts block preparation. A complete preparation has a
   45-second budget and accepted terms expire after 30 seconds.
5. Review input, estimated collateral and debt, requested versus estimated
   leverage, enforced converter minimum, fees, risk limits and exact calldata.
   Confirmation uses the reviewed transaction bytes; it cannot replan unseen
   terms. Current risk/accounting gaps are disclosed instead of invented.
6. Recheck account, chain, nonce and accepted identity. After the wallet's last
   awaited read, a synchronous guard rechecks validity and persists the attempt
   with exact read-back immediately before the one wallet request site. The
   user's wallet remains the only signer and controls its fees.
7. Observe the submitted hash without authorizing a second spend. Establish
   canonical transaction/receipt/block identity and the expected position mint,
   then current ownership. A receipt without position proof cannot be presented
   as a verified opened position. Reorg and failed recheck paths withdraw proof.
8. Keep account-scoped history. Stored labels and indexer data remain hints.
   Unknown submission does not expose a blind retry. A restored no-hash attempt
   stays conservatively unresolved until independent recovery evidence exists.

The native-ETH route requires no ERC-20 approval, so the slice does not invent
one. Approval-dependent routes are separate acceptance work. The production app
has no configured RPC in this workspace and honestly refuses live preparation;
it does not populate the live UI with synthetic market values.

### What the different executions establish

The real-component integration case composes the **actual installed SDK, public
protocol adapter, real controller and selected-wallet adapter**. External RPC
and index responses are deterministic. This proves the components agree on
exact bytes, units, dispatch and recovery under those responses.

The browser suite renders a separate **built simulation runtime** with the real
UI/controller/wallet adapter and synthetic protocol responses. It has persistent
Simulation labels, permits only loopback, and makes no external requests.
Production checks prove those scenario switches and fixture markers are absent
from the production build.

Neither execution establishes that a real transaction succeeds against current
f(x) contracts. That requires the explicitly deferred local-fork gate.

## Design and architecture decisions

The new stack is a static React 19.3.1 / TypeScript 5.9.3 client built with
Vite 8.3.4, viem 2.57.7 and the exact SDK 1.0.5 pin. Node 22.23.4 and pnpm 11.19.0
were used for verification. The lock retains a 24-hour new-package age policy.
There is no financial backend, server-side planner or signing service.

One controller owns intent and transaction state. Domain amounts, protocol
reads/planning, the selected-wallet capability, recovery journal, host adapter
and rendered UI have explicit boundaries. The SDK is lazy loaded, while the
amount editor and independently loaded static landing do not depend on it.

The brand uses an original cut-plane mark, graphite/green dark appearance and
a warm light appearance. Local system typography, restrained motion, visible
focus and clear financial hierarchy carry the design. The landing's vector
exposure artwork is explicitly labeled illustration rather than market data.

**Written exception:** D-007 preserves reviewed third-party patch inputs
byte-for-byte. Application/UI/tests/configuration are newly authored. Rewriting
a reviewed vendor correction just to change its bytes would undermine the
explicit patch-preservation requirement. Both financial invariants remain
unchanged. The exact 15-method facade is preserved; this slice uses only
`increasePosition` and `getPositions`. The other thirteen methods are not
presented as implemented screens.

## Verification results

The final checkpoint `pnpm verify` **exited 0 at 2026-10-22T03:51:25.106Z**.
The command is intentionally scoped to step 3; it is not the eventual
full-product release command. [Aggregate report](evidence/checkpoint-verify.json)
and [full output](evidence/checkpoint-verify.log) are retained.

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Named unit and integration cases | **164 passed; zero failed/skipped/cancelled/todo** | [Counts](evidence/unit-results.json), individual TAP under `evidence/unit/`; 3 amount, 31 controller, 16 host, 1 complete composition, 18 installed-vendor, 62 protocol, 33 wallet |
| Test harness validity | Passed deliberate failing typed canary | File-only subprocess success cannot count as executed tests |
| Strict types and production build | Passed | Aggregate output; static production and separate simulation entries |
| Running built-browser acceptance | **30 passed; zero failures/skips/flakes; no retries** | [Full report](evidence/browser-results.json); 42.921s recorded browser duration |
| Installed SDK / patch / scope | Exact pin, all reviewed artifact hashes and 15-method contract passed | [Boundary report](evidence/boundaries.json); installed ESM/CJS regressions separately execute |
| Signing and production isolation | Passed | Sole wallet-request site, no imports of old app code, fixture excluded, security headers checked; static checks supplement behavior tests |
| Dependency audit | **Zero reported advisories at every severity** | [Audit](evidence/dependency-audit.json), 129 dependencies in this locked graph, not a claim of universal vulnerability freedom |
| Production build budgets | All passed | [Measured gzip budgets](evidence/build-budgets.json) |
| Original tree integrity | 919/919 baseline files unchanged | [Baseline integrity](evidence/baseline-integrity.json) |

The browser environment was **supplemental Chromium 153.0.8010.0** with
Playwright 1.64.1. Its requested Chromium 156 download was invalid in this
environment. The result is explicitly not a pinned-browser pass. Tests exercise
desktop/393px/320px, both themes, 200% text at 320px, strict panel overflow,
keyboard focus and Escape/Back behavior, minimum targets, reduced motion, axe,
actual response CSP, exact input and one wallet request, rejection, uncertainty,
expiry, account/nonce drift, pending/reverted/missing-position outcomes and
receipt failure. No physical-device accessibility audit is claimed.

**Original baseline result remains distinct:** original `pnpm verify` exited 1
on a dependency registry timeout, after 1,611 application cases passed with four
fork skips and zero failures. Its independent `pnpm verify --ci-build` exited 0.
The new successful audit does not retroactively turn that aggregate green.

## Independent review and repairs

The protocol specialist reviewed the integrator's domain/controller and composed
the installed-SDK integration case. The wallet/host specialist reviewed the
running built UI; the interface specialist independently reviewed the
integrator's landing and measured production load. Reviewers inspected actual
execution and failures, not only builder descriptions.

The review found and reproduced expiry during final wallet reads, a missing
durable pre-prompt attempt, trusted imported terminal labels, hung pre-dispatch
cancellation, an old receipt overwriting a new review, and stale proof retained
after failed re-verification. All six were repaired and independently closed.
An additional started-promise cancellation issue was repaired with a focused
regression and independently closed with the real controller/wallet adapter:
one synchronous retirement, zero sends, zero planner calls and zero unhandled
rejections. Details are in the [independent review](evidence/independent-review.md).
This is evidence of a repair process, not an
assertion that no other defect exists.

Running-app checks also found a 13px enlarged-text ticket overflow and separate
landing headline/header/caption overflow. Wrapping was repaired without changing
the bounds assertions. Both app themes now pass the complete 30-case browser
run; independent landing rechecks at 320px and 393px with 200% text pass overflow,
axe and keyboard navigation. The performance report retains earlier failures
and the fixed screenshots so their status is not obscured.

## Measured performance

| Production asset budget | Observed | Ceiling |
| --- | --- | --- |
| Critical app JavaScript, gzip level 9 | **90,616 bytes / 88.49 KiB** | 180 KiB |
| Critical app CSS, gzip level 9 | **8,541 bytes / 8.34 KiB** | 25 KiB |
| Landing JavaScript | **0 bytes** | 40 KiB |
| All application JavaScript, including lazy SDK, gzip level 9 | **242,928 bytes / 237.23 KiB** | 1,536 KiB |

The SDK chunk still triggers Vite's generic 500kB raw-chunk warning; its load is
deferred and the declared gzip budgets pass. The warning remains in the output.

Independent production form-readiness observations were **768.6ms median and
828.6ms maximum across three samples**, against a 2.5s target. Setup: fresh
393×852 Chromium contexts, cache disabled, CPU slowed 4×, 10Mbps/100ms network,
reduced motion, no compression on the local server, RPC unconfigured and all
external origins blocked. Readiness means the enabled amount editor is mounted
and survives two animation frames, with actual controlled input then checked.
These figures do not measure live quotes, wallet prompts or actual execution.

One production startup task lasted **229ms**, retained as an optimization issue.
A separate development-fixture input/review journey observed a maximum task of
110ms across three runs, below its 200ms ordinary-interaction budget. That is
not a production transaction-flow benchmark. No equivalent original-app timing
was measured, so no speed-improvement claim is made. All setup, samples, hashes,
prior runs and caveats are in [performance.json](evidence/performance.json).

## Visual evidence

Screenshots show synthetic funds and synthetic position evidence, with visible
Simulation labeling. They are not evidence of real protocol execution.

- [Trade, dark desktop](evidence/checkpoint-trade-dark-desktop.png)
- [Exact transaction review](evidence/checkpoint-exact-review-dark.png)
- [Receipt with verified synthetic position](evidence/checkpoint-verified-receipt-dark.png)
- [Account-scoped history](evidence/checkpoint-account-history-dark.png)
- [Light review at 393px](evidence/checkpoint-review-light-393.png)
- [Dark review at 320px and 200% text](evidence/checkpoint-review-dark-320-text200.png)
- [Landing desktop](evidence/checkpoint-landing-desktop.png)
- [Landing at 320px and 200% text after repair](evidence/checkpoint-landing-phone-320-text200-fixed.png)

## Open gates and next work

**Real local-fork execution is blocked and unverified.** No working authorized
archive RPC is configured. Documented public read probes failed or rejected
access; no origin restrictions were bypassed. Anvil 1.7.1 is available, while
the original CI pin is 1.8.1. The transport verifies loopback/Anvil/fork metadata,
but the actual-fork wallet execution harness is not finished at this checkpoint.
The old tree remains until that harness, actual protocol transactions and the
complete behavior parity gate pass.

**Native Telegram/Privy and physical wallet execution remain unverified.** Host
safe-area, viewport, theme, Back and explicit sanitized handoff have deterministic
coverage. Browser emulation does not establish device behavior or authentication.
The later Privy adapter must preserve its reviewed fee-unit/query-string fixes.

**Other products remain deferred.** Additional markets/token inputs, existing
position actions, Borrow, Earn queue/claim, Move, broader portfolio/history,
transfers, native authentication, complete vendor regression breadth, final
marketing content and CI/cutover are bounded modules in D-015. Ethereum fork
proof alone will not establish actual Base delivery.

**Recovery has a deliberate checkpoint limit.** A restored no-hash attempt
cannot be cleared automatically from untrusted local labels. A later module
must resolve it using independent wallet/chain evidence. Storage denied before
the prompt blocks signing; that is the current fail-closed behavior.

Resume from the committed plan after this review. Each subsequent module needs
its behavior IDs, named acceptance checks and required execution evidence.
Complete the full parity/fork gate before replacing the original tree, then
perform the user's independent final running-app review. This checkpoint is
the requested stopping point, not a release approval request.
