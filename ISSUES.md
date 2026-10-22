# FxAeon rebuild issue ledger

This ledger distinguishes defects, missing evidence and environment blockers.
An issue closes only with a specific fix or verified evidence. Counts and scope
are updated at each milestone; no passing claim is inferred from source alone.

| ID | Severity / type | Finding | Owner | State / evidence |
|---|---|---|---|---|
| ENV-001 | Environment | Default host differs from required toolchain | Integrator | Closed: isolated Node 22.23.4 / pnpm 11.19.0 used; frozen install and independent baseline build passed |
| ENV-002 | Verification prerequisite | Pinned browser download failed; fork tool version differs from CI | Integrator | Open: supplemental Chromium 153.0.8010.0 launches; Anvil 1.7.1 installed versus CI 1.8.1; no pinned-browser or fork-pass claim |
| ENV-003 | Baseline gate blocker | Dependency registry audit times out | Integrator | Open: original `pnpm verify` exit 1; bounded diagnostic returns code 23 timeout. Application tests 1,611 pass / four skips; independent build passed |
| ENV-004 | Fork verification blocker | No configured archive RPC; documented public read endpoints rejected or failed requests | Integrator | Open: no real protocol fork transactions verified; no public-chain transactions sent |
| AUD-001 | Evidence gap | README describes Next.js 15; installed app manifest pins Next.js 16.4.2 | Integrator | Open; classify documentation drift in behavior spec |
| AUD-002 | Evidence gap | DESIGN.md specifies a single dark appearance, while test docs describe Light and Dark theme checks | Product auditor | Open; reconcile intended contract vs legacy assertions before design decisions |
| AUD-003 | Evidence gap | Earlier SDK fix discussions include alternatives not necessarily merged | Security auditor | Current baseline patch and executable tests authoritative; memory is leads only |
| GATE-001 | Release blocker | Complete new behavior-to-test parity does not yet exist | Integrator | Expected until milestone 5; original application must remain intact |
| GATE-002 | Release blocker | Native Telegram authentication and real wallet handoff are not established by emulated browser tests | Integrator | Track separate evidence; no unsupported native-device claim |
| AUD-004 | Visual evidence gap | Current dark state-lab snapshot is absent from the older Windows reference set | Product auditor | Open baseline gap UXP-G-003; rebuilding requires a new reviewed reference set, not a copied green claim |
| AUD-005 | Financial disclosure | Stable fxSAVE deposit route has no enforced final fxSAVE-share minimum | Integrator | Preserved contract UXP-C-EARN-013; show the actual fxSP floor and explicit final-share limitation |
| AUD-006 | Evidence conflict | Dated docs conflict with current readiness, warm quote reuse, post-action risk and wallet-link tests | Integrator | Reconcile in BEHAVIOR_SPEC and DECISIONS; preserve safety semantics, do not restore obsolete UI accidentally |
| GATE-003 | Release blocker | Ethereum fork tests do not establish actual Base delivery or native-device execution | Integrator | Separate evidence required for those surfaces after the checkpoint |

## Resolved

- Repository read access: initial sandbox network connection failed; permitted
  network execution successfully cloned the repository. No application changes.
