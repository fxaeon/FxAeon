# Testing and verification

Use the smallest relevant gate while developing, then verify the full release candidate. Commands run from the repository root unless specified. A passed fixture or old test record does not establish that a later deployed build passed.

## Complete verification

~~~sh
pnpm verify
~~~

The [verification runner](../scripts/verify.mjs) performs:

| Phase | Checks |
| --- | --- |
| Source | SDK scope, architecture, landing build/contracts, lint, unit/chaos tests, deployment and harness contracts, source secret scan, complete dependency audit |
| Build | Credential-free production export, built secret scan, app/fork/browser TypeScript, unchanged bundle/security-header budgets |
| Built browser | Real exported routes, accessibility, interaction, viewport and geometry contracts |
| Isolated browser | Nine separate product, wallet, overlay, and state-lab gates |
| Landing browser | Local network policy, data/fallback states, responsiveness, accessibility, motion and artwork behavior |

The runner clears production Privy/RPC settings for its test export using [E2E_BUILD_ENV](../scripts/e2e_build_env.mjs), including values inherited from local files. Missing credentials are intentional. A successful verification build is not a production-configured artifact.

Small local hosts with less than 12 GiB memory automatically use serial execution. To select it explicitly:

~~~sh
pnpm verify --serial
~~~

On other hosts lightweight work is bounded to four concurrent checks, build-dependent checks to three, and isolated browsers to two. Build and development servers must not share a checkout concurrently. Scheduling limits do not skip assertions.

## Focused commands

| Command | Use |
| --- | --- |
| `pnpm test` | Complete app unit/contract/seeded-chaos glob; fork-dependent cases can skip without a local fork |
| `pnpm test:chaos` | Focused deterministic lifecycle and recovery stress |
| `pnpm lint` | Source/test lint with content-based cache |
| `pnpm typecheck` | App, fork harness, and complete browser TypeScript |
| `pnpm typecheck:e2e` | Browser coverage contract and strict E2E compiler |
| `pnpm audit:all` | All dependency paths and the validated, expiring backport exception |
| `pnpm check:bundle` | Existing export size, maps, telemetry, and CSP/header checks |
| `pnpm test:landing` | Static landing, market-data validation, and build contracts |
| `pnpm test:landing:browser` | Rendered landing behavior and network checks |

To run a specific app test:

~~~sh
pnpm --dir apps/mini-app exec tsx --test test/review-hierarchy.test.ts
~~~

Use the [browser gate map](browser-test-gates.md) for component and wallet work. Root scripts are the maintained entry points; package scripts and configurations define exact file collection.

## Built-route browser tests

Install Chromium once, then run:

~~~sh
pnpm --dir apps/mini-app exec playwright install chromium
pnpm test:e2e
~~~

Local built-route startup builds a fresh export by default. Tests use a local static server and deterministic browser boundaries, not production accounts. External display data is blocked or explicitly stubbed by fixtures.

For deliberate reuse of a known current export:

~~~powershell
$env:E2E_BUILD = '0'
pnpm test:e2e
~~~

Do not reuse output after changing source or build configuration. `E2E_REUSE_SERVER=1` is for controlled local iteration only; release verification disables stale-server reuse. [run_built_e2e.mjs](../scripts/run_built_e2e.mjs) runs the just-built artifact with rebuilding and server reuse disabled.

Keep tests for exact amounts, disclosure access, quote expiry, approvals, wallet-session changes, footer clearance, 44px targets, long values, narrow screens, keyboard dismissal, and enlarged text. Synthetic provider tests do not validate real emitted lazy chunks; add an artifact/consumer smoke when changing module partitioning.

Reports and captures are generated evidence, not source. Inspect failure traces and screenshots before updating a baseline. Record browser, platform, revision, and fixture provenance.

## CI topology

[Client CI](../.github/workflows/ci.yml) distributes the same gate across independent runners:

| Job | Runner command |
| --- | --- |
| Source checks | `pnpm verify --ci-source` |
| Production build checks | `pnpm verify --ci-build` |
| Four built-route shards | Playwright `--shard=1/4` through `4/4`, reusing the uploaded export |
| Three isolated groups | `pnpm verify --ci-isolated-0`, `--ci-isolated-1`, `--ci-isolated-2` |
| Aggregate required check | Fails unless all source, build, built-browser and isolated jobs succeed |

The source phase includes landing browser checks. Built E2E jobs download the export produced by the build job; they do not independently rebuild it. The standalone [Mini App E2E workflow](../.github/workflows/e2e-mini-app.yml) is manually dispatched, while normal PR/main browser coverage runs through Client CI.

Lint, TypeScript, and Next caches speed repeated checks without replacing them. Browser TypeScript uses separate ignored incremental caches and a coverage contract that checks its input set against browser files/configs. A skipped or missing required job is not success.

## Protected Ethereum fork tests

These gates need Foundry/Anvil and an operator-provided restricted Ethereum RPC URL. Transactions use disposable local accounts on a local fork; they do not use production funds.

~~~powershell
$env:ANVIL_FORK_URL = '<restricted Ethereum RPC URL>'
pnpm test:anvil:all
pnpm test:anvil:browser
~~~

| Gate | Scope |
| --- | --- |
| `pnpm test:anvil` | Protocol integration suite through the protected launcher |
| `pnpm test:anvil:earn` | fxSAVE lifecycle execution |
| `pnpm test:anvil:stress` | Randomized runner/snapshot smoke |
| `pnpm test:anvil:all` | Protocol, Earn, and stress suites |
| `pnpm test:anvil:browser` | Browser-driven protocol flows and review/calldata evidence |

The protocol suite covers supported ETH/BTC long/short positions and a real 25% partial reduction using the SDK's market/side-specific units. Randomized runner checks are execution-harness stress, not randomized protocol-position coverage. Browser withdrawal reviews do not imply withdrawal/claim execution; the separate Earn suite proves its covered lifecycle.

The [protected manual workflow](../.github/workflows/anvil-fork.yml) runs these gates and uploads redacted proof manifests. Inspect the manifest and the named revision rather than inferring coverage from a command's name. Fork support existing in source does not mean it ran for the current candidate.

### Interactive disposable preview

~~~powershell
$env:ANVIL_FORK_URL = '<restricted Ethereum RPC URL>'
pnpm preview:funded-fork
~~~

The launcher opens a separate browser with 5 local ETH and 4,000 local USDC, app port 4326 and Ethereum fork port 8548. Automated browser tests use 4325/8547. The separate export prevents later test builds from overwriting the preview; run builds sequentially.

Use the opened browser because its local wallet belongs to that session. Close it or press Ctrl+C in the launcher to discard the owned session. This Ethereum-only preview does not prove Base delivery or native Telegram sign-in.

To attach without resetting an already running preview, set `FX_FORK_PREVIEW=1`, `FX_FORK_PREVIEW_ATTACH=1`, `ANVIL_RPC_URL=http://127.0.0.1:8548`, and `FX_FORK_BROWSER_PORT` to its app port, then run:

~~~sh
pnpm --dir apps/mini-app exec tsx e2e/fork/positions.browser.ts
~~~

`FX_FORK_PREVIEW_VERIFY=1` selects a headless connection/reload check without submitting transactions. Closing an attached browser leaves the original owner's fork/server running.

## Performance verification

Preserve the [performance boundaries](architecture.md#bounded-performance-work)
when changing scheduling, subscriptions, or read batching. Focused source checks
can run from the repository root:

~~~sh
pnpm --dir apps/mini-app exec tsx --test test/rpc-position-counts.test.ts test/direct-position-discovery.test.ts test/live-market-store.test.ts test/sdk-pool-read-concurrency.test.ts
pnpm test:e2e:overlay wallet-rpc-proof live-market-store
~~~

For controlled measurements of the installed code:

~~~sh
pnpm --dir apps/mini-app exec tsx test/benchmarks/rpc-chain-proof.ts
node scripts/measure_sdk_pool_reads.cjs
~~~

These use deterministic transport responses. Record the source revision,
dependency/patch versions, fixture delays, environment, samples, exact-result
equivalence, and wire counts. Report startup, first visible input, verified
review, fee readiness, submission, and receipt reconciliation as distinct
milestones. A harness timer is not a live quote latency, and fewer requests
are not automatically an equivalent reduction in provider billing.

## Evidence boundaries

Record the tested source revision, build configuration, toolchain/browser,
commands, outcomes, skips, and fixture or live-service boundaries in the pull
request or release evidence. Attach relevant generated manifests and captures.
Older reports remain in Git history; they do not establish current results.

`pnpm docs:screenshots` captures UI with external display data; `pnpm docs:screenshots:positions` and the fork browser fixture have separate manifests. Preserve routes, viewports, revision, data source, and hashes. See [capture provenance](position-screenshot-fixture.md).

A fixture, desktop browser, or Ethereum fork cannot establish physical phone dispatch, native Telegram authentication, live Privy recovery, or actual cross-chain settlement. Record those checks separately. The [release checklist](launch-readiness.md) keeps these limits visible.
