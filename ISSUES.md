# FxAeon rebuild issue ledger

This ledger distinguishes defects, missing evidence and environment blockers.
An issue closes only with a specific fix or verified evidence. Counts and scope
are updated at each milestone; no passing claim is inferred from source alone.

| ID | Severity / type | Finding | Owner | State / evidence |
|---|---|---|---|---|
| ENV-001 | Environment | Default host differs from required toolchain | Integrator | Closed: isolated Node 22.23.4 / pnpm 11.19.0 used; frozen install and independent baseline build passed |
| ENV-002 | Verification prerequisite | Pinned browser download failed; fork tool version differs from CI | Integrator | Open: supplemental Chromium 153.0.8010.0 launches; Anvil 1.7.1 installed versus CI 1.8.1; no pinned-browser or fork-pass claim |
| ENV-003 | Baseline gate blocker | Dependency registry audit times out | Integrator | Original baseline aggregate remains failed: timeout, 1,611 application cases pass / four skips; separate build passed. New isolated 129-dependency graph separately audited successfully with zero advisories; this does not rewrite the old result |
| ENV-004 | Fork verification blocker | No configured archive RPC; documented public read endpoints rejected or failed requests | Integrator | Open: no real protocol fork transactions verified; no public-chain transactions sent |
| AUD-001 | Evidence gap | README describes Next.js 15; installed app manifest pins Next.js 16.4.2 | Integrator | Baseline documentation drift recorded; replacement stack and exact pin are explicit in D-003 |
| AUD-002 | Evidence gap | DESIGN.md specifies a single dark appearance, while test docs describe Light and Dark theme checks | Product auditor | Resolved for checkpoint by D-010: both themes are intentional and pass the same browser acceptance |
| AUD-003 | Evidence gap | Earlier SDK fix discussions include alternatives not necessarily merged | Security auditor | Current baseline patch and executable tests authoritative; memory is leads only |
| GATE-001 | Release blocker | Complete new behavior-to-test parity does not yet exist | Integrator | Expected until milestone 5; original application must remain intact |
| GATE-002 | Release blocker | Native Telegram authentication and real wallet handoff are not established by emulated browser tests | Integrator | Track separate evidence; no unsupported native-device claim |
| AUD-004 | Visual evidence gap | Current dark state-lab snapshot is absent from the older Windows reference set | Product auditor | Open baseline gap UXP-G-003; rebuilding requires a new reviewed reference set, not a copied green claim |
| AUD-005 | Financial disclosure | Stable fxSAVE deposit route has no enforced final fxSAVE-share minimum | Integrator | Preserved contract UXP-C-EARN-013; show the actual fxSP floor and explicit final-share limitation |
| AUD-006 | Evidence conflict | Dated docs conflict with current readiness, warm quote reuse, post-action risk and wallet-link tests | Integrator | Reconcile in BEHAVIOR_SPEC and DECISIONS; preserve safety semantics, do not restore obsolete UI accidentally |
| GATE-003 | Release blocker | Ethereum fork tests do not establish actual Base delivery or native-device execution | Integrator | Separate evidence required for those surfaces after the checkpoint |
| TEST-001 | Evidence defect | Sandbox child-process denial allowed a file-only Node test report without named cases | Integrator | Closed: direct isolated module harness requires named TAP totals and proves failure propagation with a deliberate failing typed test; subprocess permission is explicit. 164 actual named cases pass |
| REV-001 | High / dispatch | Review could expire during wallet adapter's final awaited reads | Integrator | Closed by independent review: synchronous authorization guard immediately before raw dispatch, rollback/expiry checks; named controller/wallet regressions pass |
| REV-002 | High / recovery | Failed pre-prompt persistence let another tab miss an unresolved attempt | Integrator | Closed by independent review: durable prospective record plus exact read-back required before wallet prompt; later storage errors preserve memory |
| REV-003 | High / recovery | Imported no-hash `declined` label could clear uncertainty | Integrator | Closed by independent review: no imported terminal label is proof; directly observed current-session definite no-send removes its own persisted hint |
| REV-004 | Medium / cancellation | Hung read-only wallet checks retained the confirmation lock after cancellation | Integrator | Closed by independent review: complete pre-dispatch read phase bounded/cancellable; an already-issued prompt remains observed |
| REV-005 | Medium / state | Late old receipt could replace a newer review | Integrator | Closed by independent review: fresh draft/preparation retires the previous active-flow association; old history can still update |
| REV-006 | Medium / receipt | Failed re-verification retained current proof/position output | Integrator | Closed by independent review: failed recheck withdraws proof; fresh outer receipt without position remains separately proven |
| REV-007 | Medium / cancellation | A started wallet-read promise could reject without an observer when cancellation happened synchronously | Integrator | Closed by independent real-controller/real-wallet repro: one synchronous retirement, final editing state, zero sends/planner calls/unhandled rejections, exit 0; focused 31st controller case and full gate pass |
| UI-001 | Checkpoint blocker | At 320px and 200% text, ticket content overflowed its panel by 13px | Interface / integrator | Closed: wrapping repaired; unchanged strict panel bounds pass in both themes; final built-browser report is 30/30 |
| UI-002 | Checkpoint blocker | Landing headline/header/art caption overflowed narrow screens at 200% text | Integrator | Closed: text and flex wrapping repaired; independent built-page recheck at 320px and 393px passes bounds, axe and keyboard navigation; before/after evidence retained |
| PERF-001 | Performance limit | Controlled production startup included a 229ms long task | Integrator | Open optimization: form-ready max 828.6ms passes the 2.5s target. Ordinary input/review max 110ms passes its separate 200ms target in a development fixture; no production transaction-latency claim |
| REC-001 | Recovery limit | Reloaded attempt without a hash remains uncertain and cannot auto-clear from local metadata | Integrator | Deliberate conservative checkpoint behavior; later recovery module must offer independently proved resolution, never blind resend |

## Resolved

- Repository read access: initial sandbox network connection failed; permitted
  network execution successfully cloned the repository. No application changes.
