# FxAeon rebuild issue ledger

This ledger distinguishes defects, missing evidence and environment blockers.
An issue closes only with a specific fix or verified evidence. Counts and scope
are updated at each milestone; no passing claim is inferred from source alone.

| ID | Severity / type | Finding | Owner | State / evidence |
|---|---|---|---|---|
| ENV-001 | Blocking environment | Default host is Node 24.19.0 / pnpm 11.25.0; baseline requires Node 22 / pnpm 11.19.0 | Integrator | Installing temporary matching toolchain; baseline verify not yet run |
| ENV-002 | Verification prerequisite | Anvil/Forge and browser binaries are not on PATH | Integrator | Assess/install only necessary tools; no fork claim yet |
| AUD-001 | Evidence gap | README describes Next.js 15; installed app manifest pins Next.js 16.4.2 | Integrator | Open; classify documentation drift in behavior spec |
| AUD-002 | Evidence gap | DESIGN.md specifies a single dark appearance, while test docs describe Light and Dark theme checks | Product auditor | Open; reconcile intended contract vs legacy assertions before design decisions |
| AUD-003 | Evidence gap | Earlier SDK fix discussions include alternatives not necessarily merged | Security auditor | Current baseline patch and executable tests authoritative; memory is leads only |
| GATE-001 | Release blocker | Complete new behavior-to-test parity does not yet exist | Integrator | Expected until milestone 5; original application must remain intact |
| GATE-002 | Release blocker | Native Telegram authentication and real wallet handoff are not established by emulated browser tests | Integrator | Track separate evidence; no unsupported native-device claim |

## Resolved

- Repository read access: initial sandbox network connection failed; permitted
  network execution successfully cloned the repository. No application changes.
