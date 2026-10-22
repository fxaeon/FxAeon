# FxAeon rebuild plan

## Contract and checkpoint

Requested 2026-10-22 (Asia/Karachi). Rebuild the Telegram Mini App, web app,
landing, brand, design system, docs, and tests from a behavioral specification.
The existing application is evidence, never source to copy into the rebuild.

Branch: `rebuild/fxaeon-foundation-20261022`.
Baseline: `b69d9ce1be59f982fca3ac43a8b037f7037269d4` (`origin/main` when cloned).

**The milestone-3 checkpoint was presented and the user authorized continuation
on 22 October 2026.** Continue milestones 4–6 autonomously, incorporating the
new Phantom/ChatGPT visual direction and supplied reference screenshots.
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
| 3 | `DECISIONS.md`; new implementation in isolated staging tree; long input → simulation → explicit review → wallet → verified receipt → history, including failures; tests and running preview | Complete for the native-ETH new-long scope: 164 named unit/integration cases and 30 browser cases pass; strict build, SDK/signing boundaries, budgets and current dependency audit pass. Actual native-long local-fork execution subsequently passed; broader lifecycle proof remains open. See `rebuild/docs/CHECKPOINT.md` |
| Checkpoint | Show user spec, decisions and slice; state exact verification limits | Completed at `6af7e95`; user explicitly authorized continuation |
| 4 | Bounded modules for remaining surfaces, each with acceptance and evidence | Active: shared product contracts, complete interface, selected-wallet/Telegram adapters and local-fork infrastructure |
| 5 | Complete behavior-to-new-test map; full verify and real protocol transactions on disposable local fork | Deferred; must pass before replacing old tree |
| 6 | Independent running-app review, repair blockers, final verification report | Deferred |

## Current work allocation

- Integrator: product controller/journal, shared contracts, Borrow/Bridge/Send,
  dependency isolation, runtime integration, gates, documentation and commits.
- Protocol specialist: four-market Trade/Positions, installed-SDK regressions,
  real local-fork runner and lifecycle evidence.
- Wallet/host specialist: selected-wallet and native Telegram/Privy adapters
  completed with 92 focused cases; now owns the seven-method Earn adapter.
- Interface specialist: all nine product routes, independent Privy review,
  separate product simulation build and running-browser acceptance.
- Subagents own independent files. The integrator reconciles shared changes.

## Resume instructions

1. Read this file, `ISSUES.md`, `docs/rebuild/BASELINE.md`, `BEHAVIOR_SPEC.md`,
   `DECISIONS.md`, and `rebuild/docs/CHECKPOINT.md` before making changes.
2. Inspect `git status` and latest milestone commits; preserve other workers'
   files. Do not replay completed milestones or recreate the branch.
3. Use Node 22.23.4 / pnpm 11.19.0 and the staged directory's own dependency lock.
   The reproducible commands are in `rebuild/README.md`; committed checkpoint
   evidence is in `rebuild/docs/evidence/`. Preserve the original baseline result.
4. No unrecorded waiver: a blocked check stays blocked; an existing bug is not
   silently promoted to intended behavior.
5. The user approved continuing after the checkpoint. Use the bounded acceptance
   plan in D-015 and track all IDs in `rebuild/docs/SLICE_ACCEPTANCE.json`.
   Obtain a working authorized archive RPC before claiming local-fork proof.
   Keep every original file intact until the full step-5 gate passes.

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
- 2026-10-22: recorded architecture/design decisions before implementation;
  built the new client only under `rebuild/`, preserving the original tree.
  Installed the exact reviewed SDK patch as a justified vendor-input exception.
  First complete native-ETH long composes real installed SDK, protocol adapter,
  controller and selected-wallet adapter against deterministic responses.
- 2026-10-22: independent domain review reproduced six timing/recovery defects;
  repaired final-dispatch expiry, pre-prompt durable recovery, untrusted terminal
  labels, hung read cancellation, stale receipt publication and stale proof flags.
  Added focused regressions and a real-component deterministic composition test.
  Current full candidate check reaches browser gate: 163 named cases pass,
  exact SDK hash/scope/production-isolation checks pass, production budgets pass;
  28/30 browser cases pass. Remaining 320px/200% ticket overflow is being repaired.
  New locked dependency graph separately audited with zero reported advisories.
- 2026-10-22: repaired the 320px/200% review-panel overflow and separately found
  and repaired enlarged-text landing overflow, without relaxing assertions.
  Fixed an additional synchronous-cancellation rejection observation issue.
  Final checkpoint `pnpm verify` exited 0 at 03:51:25 UTC: 164 named cases,
  30 browser cases, strict types/build, boundaries, budgets and audit all pass.
  Browser evidence is explicitly supplemental Chromium 153, not pinned 156.
  Independent production readiness measurement: median 768.6ms / max 828.6ms
  under its documented controlled setup; startup includes a 229ms long task.
  All 919 originally tracked files remain unchanged. No real funds, public
  financial transactions, deployment, cutover or full-product parity claim.
  Step-3 evidence and acceptance mapping are saved; stop at the user checkpoint.
- 2026-10-22: user authorized autonomous continuation to completion and supplied
  20 Phantom phone screenshots as visual references; ChatGPT cleanliness is an
  additional stated preference. All uploads are locally readable despite the
  attachment error text. Screenshot account data is not product fixture data.
  Assigned separate UI, wallet/host and fork work; root integrates shared
  product contracts and transaction execution. Original-tree cutover gate holds.

- 2026-10-22: archive access established using the existing authorized Node proxy
  and the SDK-documented public endpoint. The actual native-long fork case passed
  with exact amount/calldata, minted ownership/accounting, actual fee and no-resend
  recovery. A source-manifest digest binds its dirty-tree inputs; Anvil 1.7.1
  remains explicitly different from retained CI 1.8.1. This is one lifecycle case.
- 2026-10-22: selected-wallet/Telegram adapters pass 92 focused named cases and
  scoped strict types; independent Privy source review found no blocking issue.
  Pinned Privy/query-string reviewed patches are retained, WalletConnect disabled,
  optional native install scripts denied. Updated 607-dependency graph audit
  reports zero advisories at all levels. Native authentication remains untested
  without configured app IDs and an actual Telegram/device session.
