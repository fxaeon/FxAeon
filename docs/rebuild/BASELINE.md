# Original application baseline

- Repository: https://github.com/fxaeon/FxAeon
- Revision: `b69d9ce1be59f982fca3ac43a8b037f7037269d4`
- Rebuild branch: `rebuild/fxaeon-foundation-20261022`
- Audit date: 2026-10-22 (Asia/Karachi)
- Original tree: retained unchanged during audit and staging implementation.
- Repository instructions: no `AGENTS.md` found in checkout or ancestor folders.

## Verification status

`pnpm verify`: **FAILED, exit 1**, run against the unchanged baseline application
on 2026-10-22. The dependency registry audit timed out. This is not a passing
aggregate verification result, even though the application tests passed.

Required toolchain provisioned outside the repository: **Node 22.23.4, pnpm
11.19.0**. `pnpm install --frozen-lockfile` succeeded without changing the lock.
Host defaults were Node 24.19.0 / pnpm 11.25.0 and were not used for this run.

Executed from the repository root, with the temporary toolchain prepended to
PATH and `PLAYWRIGHT_BROWSERS_PATH=/tmp/fxaeon-browsers`:

```sh
pnpm verify
pnpm verify --ci-build
```

| Gate | Current baseline evidence |
| --- | --- |
| Scope, architecture, lint, root contracts, landing contracts | Passed in the aggregate source phase |
| Frontend source secret scan | 413 files checked; zero findings |
| Dependency audit | Failed: registry response could not be obtained; local braces mitigation check passed |
| Application unit and chaos tests | 1,615 expanded cases: **1,611 pass, 0 fail, 4 skipped**; 119.164 seconds |
| Aggregate source phase | Failed after 394.1 seconds; later phases were not reached |
| Independent `--ci-build` run | **Passed, exit 0**, 136.4 seconds; does not repair the failed aggregate gate |
| Production build and strict app/fork/browser type checks | Passed in independent build phase |
| Built frontend secret scan | 460 files checked; zero findings |
| Bundle guardrails | Passed: 468 assets / 11.79 MiB; 240 JS assets / 7.82 MiB raw / 2.44 MiB gzip; largest JS asset 0.90 MiB |
| CSP export checks | 33 documents; one global header line 1,374 / 2,000 characters |
| Original production and isolated browser gates | Not run by either completed command |
| Real protocol local-fork tests | Four conditional tests skipped; no fork URL configured, no current fork-execution claim |

Raw command logs are `/tmp/fxaeon-baseline-verify.log` and
`/tmp/fxaeon-baseline-build.log` in this workspace. A separate diagnostic
`pnpm --fetch-retries=0 --fetch-timeout=15000 audit --json` also exited 1 with
`{"error":{"code":23,"message":"The operation was aborted due to timeout"}}`.
No source gate was removed or weakened to obtain the independent build result.

### Browser and fork prerequisites

- Pinned Playwright 1.64.1 Chromium 156.0.8078.4 download failed: the CDN returned
  an empty/truncated archive. This remains distinct from application behavior.
- Supplemental Chromium **153.0.8010.0** launches successfully through the
  runtime Playwright 1.62.1 with an explicit executable path. It is available for
  candidate review, but is not the pinned baseline browser and is never reported
  as such.
- Anvil **1.7.1** is installed outside the repository. Existing CI pins 1.8.1;
  version alignment remains a fork-gate prerequisite.
- Read-only requests to documented public Ethereum providers did not establish
  a usable fork source: PublicNode, Cloudflare and dRPC returned HTTP 403;
  Cloudflare's trial endpoint returned 503; 1RPC returned 405; Alchemy's public
  documentation endpoint rejected the origin. No access restriction was bypassed.
  No transaction was sent to a public chain. A user-provided or otherwise
  authorized working archive endpoint will be required if public access remains
  unavailable.

Historical test reports in the old tree refer to other revisions. They are
requirements/evidence leads, not passing results for this baseline or the rebuild.

## Initial source reconciliation

1. README's framework version differs from the package manifest.
2. DESIGN's single-dark contract differs from older theme-testing prose.
3. Local SDK patch includes more corrections than the three upstream PRs named
   in README. Each correction needs independent preservation in the new test map.

These discrepancies are audit findings, not authorization to weaken safety.
