# Testing

Run commands from the repository root. The release gate is:

```powershell
pnpm verify
```

It checks SDK scope and architecture, builds/tests the landing site, runs lint
and source tests, audits production dependencies, builds the static app, then
checks types, bundle and secrets, built-browser behavior, and landing-browser
behavior. `.github/workflows/ci.yml` runs this gate on pushes and pull requests.

Useful focused checks:

| Command | Coverage |
| --- | --- |
| `pnpm test` | App unit, contract, and seeded chaos tests; fork-dependent cases skip without a fork |
| `pnpm test:chaos` | Deterministic lifecycle, ordering, and recovery stress |
| `pnpm test:e2e` | Playwright against the static app build |
| `pnpm test:landing` | Standalone landing static contracts |
| `pnpm test:landing:browser` | Landing behavior, theme, viewport, accessibility, and network checks |
| `pnpm typecheck` | App, fork-harness, and complete browser-suite TypeScript |
| `pnpm typecheck:e2e` | Strict browser specs, React harness entries, fixtures, capture scripts, and Playwright configs |
| `pnpm audit --prod --audit-level=high` | Runtime dependency audit |

The browser typecheck overrides the app's `e2e` exclusion, includes `.ts`,
`.tsx`, `.mts` and `.cts`, and inherits Next's CSS/image declarations. Its coverage contract
compares TypeScript's effective input set with every browser TypeScript file
and Playwright config, so a future include/exclude change cannot silently skip
those files. It uses no emit or incremental output. Root `pnpm typecheck` runs this gate,
so `pnpm verify`, which Client CI runs, includes it; browser execution remains a
separate check.

Browser checks have separate gates. `pnpm test:e2e` runs the production-export
routes and interactions. Seven isolated harnesses each use their own
Playwright config and focused command: Borrow selection
(`pnpm test:e2e:borrow-harness`), Move review layout
(`pnpm test:e2e:move-harness`), Positions (`pnpm test:e2e:positions-harness`),
the Privy send adapter (`pnpm test:e2e:privy-send-harness`), Trade
(`pnpm test:e2e:trade-harness`), overlays and page states
(`pnpm test:e2e:overlay`), and the UI state lab (`pnpm test:e2e:state-lab`).
`pnpm verify` runs them sequentially. The Trade harness covers the ticket's
split slider and outcome preview, native Max, and review preparation. The
Positions harness covers position rows, the list-to-position flow, and a new
position carried from Trade's result to its page. The overlay harness covers
the app shell, Portfolio's first load, position rows' rebalance markers, and
portfolio asset loading/empty/error/refresh states and wallet refresh fan-out,
including recovery after a synchronous reader failure. The state-lab gate
compares its approved screenshots on Windows; the current reference set
contains 17 images. Production E2E checks
server-rendered route metadata and form reachability with 200% text in Light
(official) and Dark themes. See
[`browser-test-gates.md`](browser-test-gates.md) for the exact suite map and
[`ui-state-lab.md`](ui-state-lab.md) for the development-only lab and its
fixture limits.

For local Playwright runs, Chromium may be installed with:

```powershell
pnpm --dir apps/mini-app exec playwright install chromium
```

## Protected Ethereum fork tests

Fork tests use disposable local Anvil nodes, test accounts, and an operator-
provided Ethereum RPC endpoint. They interact with protocol state on a local
fork; they do not send transactions using production funds. Keep the endpoint
restricted and out of source control.

```powershell
$env:ANVIL_FORK_URL = '<restricted Ethereum RPC URL>'
pnpm test:anvil:all
pnpm test:anvil:browser
```

`pnpm test:anvil:all` opens ETH/BTC long/short positions, performs a real 25%
partial reduction using the SDK's market- and side-specific amount units, runs
the fxSAVE lifecycle proof, and runs randomized transaction-runner/snapshot
smoke checks. The randomized runner checks exercise the execution harness on
Anvil; they are not randomized protocol-position stress tests.
`pnpm test:anvil:browser` exercises position actions through the browser,
including quote-expiry refresh without signing and reviews of fxSAVE deposit,
instant withdrawal, and queued withdrawal calldata. The protected manual
workflow `.github/workflows/anvil-fork.yml` runs these gates and uploads
redacted proof manifests; it requires the protected Ethereum RPC secret and
Foundry/Anvil. Current-candidate results are recorded in
[`release-validation.md`](release-validation.md); source coverage does not
mean the protected gates have passed.

For an interactive session, run `pnpm preview:funded-fork` with the same
`ANVIL_FORK_URL` and Anvil installation. It opens a separate Chrome/Chromium
window with a disposable account funded with 5 local ETH and 4,000 local USDC.
The app runs on port 4326 and its Ethereum fork on 8548; automated browser
tests retain ports 4325 and 8547. Its separate export directory keeps later
test builds from replacing the manual preview. Build these sequentially.

Use the opened browser window: the local wallet adapter belongs to that
session. The banner identifies disposable funds, and transactions are sent
only to the loopback fork. Close the window or press Ctrl+C in the launcher
to stop the session and discard its state. This Ethereum-only preview does
not simulate Base bridge delivery or native Telegram sign-in, and opening
it does not count as passing the automated browser proof.

To reopen a browser against an existing preview without resetting its funds,
set `FX_FORK_PREVIEW=1`, `FX_FORK_PREVIEW_ATTACH=1`,
`ANVIL_RPC_URL=http://127.0.0.1:8548`, and `FX_FORK_BROWSER_PORT` to the running
preview port, then run `pnpm --dir apps/mini-app exec tsx e2e/fork/positions.browser.ts`.
The attached wallet advertises a stable local-only EIP-6963 identity and checks
that its connection survives a page reload. Closing this attached window leaves
the original fork owner and server running. Add `FX_FORK_PREVIEW_VERIFY=1` for a
headless connection-and-reload check that exits without submitting transactions.

## Screenshot evidence

`pnpm docs:screenshots` refreshes standard UI captures using external display
data. The checked-in `docs/fixtures/standard-screenshot-manifest.json` records
the capture context, routes, viewports, and hashes. Those screenshots document
rendered states; they are not transaction evidence.

`pnpm docs:screenshots:positions` and the browser fork fixture have separate
manifests. The current populated-position screenshots were captured during the
browser fork proof at a pinned block; see
[`position-screenshot-fixture.md`](position-screenshot-fixture.md). Their
position state is fork-backed, while displayed prices and charts are visibly
labelled illustrative data. Neither screenshots nor manifests replace test
assertions.

No browser emulation establishes native Telegram authentication, wallet
handoff, or a real bridge transfer. Keep those claims separate from automated
browser and fork results.
