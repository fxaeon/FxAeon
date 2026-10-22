# Independent checkpoint review

Date: 22 October 2026. Scope: step-3 native-ETH new-long checkpoint only.
This report records independent agent observations and their limits. It is not
the user's later step-6 full-product review or an external security audit.

## Separation of responsibilities

- The protocol specialist (`quality_review`) inspected and exercised the
  integrator's domain/controller/recovery implementation. It also authored the
  separate composition case using the installed SDK and actual adapters.
- The wallet/host specialist (`creative_review`) independently reviewed the
  running built UI and authored the browser acceptance/configuration. Final
  closure inspected the full 30-case JSON report and generated screenshots.
- The interface specialist (`orchestration_review`) independently reviewed the
  integrator's landing and measured built-production form readiness. Its own UI
  was reviewed by the wallet/host specialist, not accepted solely on self-report.
- The integrator owned shared interfaces, applied cross-cutting repairs and ran
  the final aggregate verification. Reviewers did not expand deferred modules.

## Domain findings and closure

| Issue | Reproduced defect | Closure |
| --- | --- | --- |
| REV-001 | Accepted review could expire during awaited wallet context reads | Required synchronous final dispatch guard now checks expiry/clock/session/intent/cancellation after all awaited reads; source and focused regressions independently reviewed |
| REV-002 | Failed pre-prompt storage left other tabs unaware of an unresolved attempt | Prospective journal record plus exact persistence read-back required before wallet prompt; denial fails closed; later storage loss retains in-memory hash |
| REV-003 | Imported no-hash terminal label was treated as sufficient resolution | Imported labels are always hints; only directly observed current-session definite no-send clears its own persisted hint |
| REV-004 | Hung read-only wallet check retained the lock after cancellation | Complete pre-dispatch phase is bounded/cancellable; an actually issued prompt retains a separate, observed lifetime |
| REV-005 | Late receipt work for an old attempt replaced a newer active review | Fresh draft/preparation retires the prior active-flow association; old work can still update its own history record |
| REV-006 | Failed re-verification retained current receipt/position proof | Failed recheck removes current proof; a fresh outer receipt without expected position proof is represented separately |
| REV-007 | Synchronous wallet retirement left an already-started rejected promise unobserved | Final focused reproduction independently passes as recorded below |

### REV-007 final reproduction

The reviewer inspected `bounded()` in `src/domain/controller.ts` and exercised
the real `TradeController` with `createBrowserWallet`. The injected provider
synchronously emitted `accountsChanged` during the first preparation
`eth_accounts` read. That retires the session before the controller registers
its cancellation boundary. The reproduction captured process
`unhandledRejection` events through two `setImmediate` turns after preparation.

| Observation | Result |
| --- | --- |
| Synchronous wallet retirement events | 1 |
| Final controller state | `editing` |
| Transaction sends | 0 |
| Protocol planner calls | 0 |
| Unhandled rejections | 0 |
| Process exit code | 0 |

`bounded()` now always observes the already-started work via `Promise.race`,
including when cancellation precedes listener registration. The previous early
throw is gone. The named regression is
`[SEC-REVIEW-003] synchronous wallet retirement observes the already-started preparation rejection`
in `test/controller.test.ts`. The reviewer made no product edits and did not
rerun the broader suite for this final closure.

## Running interface and landing

The final built-browser report contains **30 expected passes**, zero unexpected
failures, zero skips and zero flakes; retries are disabled. The reviewer checked
the actual report and screenshots after the enlarged-text repair. The strict
320px/200% panel-bounds checks remain unchanged. The environment is supplemental
Chromium 153.0.8010.0; its result is not represented as pinned Chromium 156 or a
physical Telegram/wallet result.

The landing review found header, headline and art-caption overflow with 200%
text. After wrapping repairs, independent built-page runs at both 320px and
393px found no horizontal overflow or axe violations, and keyboard navigation
to the app succeeded. Earlier failure evidence and fixed screenshots are
retained in `performance.json` and the corresponding PNGs.

The same independent report records three production readiness samples,
source/output hashes and declared emulation settings. Production RPC was
unconfigured. Input/review timing used a separate development fixture. One
229ms startup long task remains disclosed; no equivalent old-app performance
comparison was made.

## Review limits

No known blocking finding from these checkpoint reviews remains open. That
statement is limited to the inspected slice and tests. Real protocol fork
transactions, native Telegram/Privy, physical wallets, Base delivery, broader
product parity and the final step-6 review remain unverified or deferred.
The full original tree is retained until those required gates pass.
