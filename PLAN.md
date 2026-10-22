# FxAeon rebuild plan

## Contract and checkpoint

Requested 2026-10-22 (Asia/Karachi). Rebuild the Telegram Mini App, web app,
landing, brand, design system, docs, and tests from a behavioral specification.
The existing application is evidence, never source to copy into the rebuild.

Branch: `rebuild/fxaeon-foundation-20261022`.
Baseline: `b69d9ce1be59f982fca3ac43a8b037f7037269d4` (`origin/main` when cloned).

**Stop after milestone 3 and present the specification, decisions, and complete
leveraged-long vertical slice.** Continue milestones 4–6 after that checkpoint.
Do not replace the original application tree before the milestone 5 parity gate.
Do not merge, deploy, or submit transactions using production funds.

## Non-negotiable boundaries

- The selected user's wallet is the only application signer. No application
  private keys, server-side planning, signing service, or background executor.
- Exactly the 15 protocol methods and SDK pin recorded in `fx-scope.lock.json`.
- Preserve reviewed SDK correction semantics and their executable regression
  evidence. Record any proposed invariant change in `DECISIONS.md` first.
- Unknown data remains distinguishable from zero. Display prices cannot become
  transaction inputs. Receipt evidence, not a local cache, establishes execution.
- One integrator. Independent agents have explicit file ownership.

## Milestones

| # | Deliverable and exit evidence | Status |
|---|---|---|
| 0 | Isolated branch, baseline revision, resumable plan and issue ledger | Complete; local and remote milestone `247d9f3` |
| 1 | Read README, DESIGN, security, docs and tests; run original `pnpm verify`; produce `BEHAVIOR_SPEC.md` with source evidence and gaps | Complete with explicit evidence limits: 3,373 overlapping records, all 243 inventoried test files / 46 docs mapped; original aggregate failed on registry timeout; separate build passed |
| 2 | Purposeful reference map covering every supplied repository/organization; adopt/avoid findings with sources | Complete: 14 references, 38 inspected source files, commit-pinned adopt/avoid map; source study, not live app review |
| 3 | `DECISIONS.md`; new implementation in isolated staging tree; long input → simulation → explicit review → wallet → verified receipt → history, including failures; tests and running preview | Next: audit milestone committed before application code; define architecture and bounded ownership |
| Checkpoint | Show user spec, decisions and slice; state exact verification limits | Required stop |
| 4 | Bounded modules for remaining surfaces, each with acceptance and evidence | Deferred until checkpoint |
| 5 | Complete behavior-to-new-test map; full verify and real protocol transactions on disposable local fork | Deferred; must pass before replacing old tree |
| 6 | Independent running-app review, repair blockers, final verification report | Deferred |

## Current work allocation

- Integrator: repository/toolchain setup, original verification, deployment/CI
  audit, evidence reconciliation, architecture and final integration.
- Product auditor: docs and tests for product behavior, UI, states and layout;
  owns `docs/rebuild/audit-product.md` and `product-behaviors.json` only.
- Security auditor: SDK, transaction, wallet, precision, recovery, fork evidence;
  owns `docs/rebuild/audit-security.md` and `security-behaviors.json` only.
- Reference researcher: purposefully inspect all user-supplied references;
  implementation remains blocked until the audit is recorded.

## Resume instructions

1. Read this file, `ISSUES.md`, `docs/rebuild/BASELINE.md`, and later
   `BEHAVIOR_SPEC.md` / `DECISIONS.md` before making changes.
2. Inspect `git status` and latest milestone commits; preserve other workers'
   files. Do not replay completed milestones or recreate the branch.
3. Use the pinned toolchain and dependency lock. Retain raw verification evidence
   outside tracked source and summarize exit status, commit, environment and
   skipped scopes in `docs/rebuild/BASELINE.md`.
4. No unrecorded waiver: a blocked check stays blocked; an existing bug is not
   silently promoted to intended behavior.

## Activity

- 2026-10-22: cloned repository, confirmed clean baseline, created rebuild branch.
  Read README, DESIGN, SECURITY, architecture, SDK scope, test gate definitions.
  Found runtime mismatch (host Node 24 / pnpm 11.25 vs required Node 22 /
  pnpm 11.19); provisioning an isolated matching toolchain.
- 2026-10-22: pinned toolchain installed; frozen dependency installation passed.
  Original `pnpm verify` failed on a dependency registry timeout; application
  tests were 1,611 pass / four fork skips / zero failures. Independent
  `pnpm verify --ci-build` passed. Browser/fork limitations are recorded in
  `docs/rebuild/BASELINE.md`. Audit ledgers and reference research are being
  reconciled before application implementation begins.
- 2026-10-22: completed behavior specification with three normative ledgers.
  Verified all 243 inventoried test files and 46 documents have evidence entries,
  all IDs are unique and all inventoried baseline hashes are unchanged.
  File coverage is not a claim of complete manual assertion review or execution.
  Reference map covers every requested organization/repository.
