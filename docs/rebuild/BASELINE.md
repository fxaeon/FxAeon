# Original application baseline

- Repository: https://github.com/fxaeon/FxAeon
- Revision: `b69d9ce1be59f982fca3ac43a8b037f7037269d4`
- Rebuild branch: `rebuild/fxaeon-foundation-20261022`
- Audit date: 2026-10-22 (Asia/Karachi)
- Original tree: retained unchanged during audit and staging implementation.
- Repository instructions: no `AGENTS.md` found in checkout or ancestor folders.

## Verification status

`pnpm verify`: **not run yet**. Required pinned toolchain is being provisioned.

Required: Node 22, pnpm 11.19.0, frozen `pnpm-lock.yaml`.
Host defaults observed: Node 24.19.0, pnpm 11.25.0.

Record complete command, environment, start/end, exit status, all failed/skipped
gates and evidence path here when the baseline run completes. A source-covered
fork test does not establish actual protocol execution.

## Initial source reconciliation

1. README's framework version differs from the package manifest.
2. DESIGN's single-dark contract differs from older theme-testing prose.
3. Local SDK patch includes more corrections than the three upstream PRs named
   in README. Each correction needs independent preservation in the new test map.

These discrepancies are audit findings, not authorization to weaken safety.
