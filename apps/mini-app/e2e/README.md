# Built-route browser tests

The default Playwright project exercises the actual static export through a local Cloudflare-style file server. It covers public entry, routing, form/review behavior, accessibility, responsive geometry, Telegram viewport behavior, and honest unavailable states.

It does not perform live authentication or use a production wallet. [The browser gate map](../../../docs/browser-test-gates.md) lists the nine separate isolated projects; the default suite does not collect them all.

## Run

From the repository root:

~~~sh
pnpm --dir apps/mini-app exec playwright install chromium
pnpm test:e2e
~~~

For a focused built-route file:

~~~sh
pnpm --dir apps/mini-app exec playwright test form-help.spec.ts
~~~

Local startup builds a fresh export by default. The server fixture supplies empty Privy/RPC configuration, and external display calls are denied or explicitly stubbed. Focused fixtures can add deterministic browser/provider leaves without changing production code.

## Artifact reuse

| Setting | Meaning |
| --- | --- |
| `E2E_BUILD=0` | Reuse an existing export; only use when its revision/configuration is known |
| `E2E_REUSE_SERVER=1` | Explicit local reuse of a known server; keep disabled for release verification |
| `E2E_WORKERS=1` | Reduce concurrent browser workers on constrained hosts |
| `E2E_BROWSER_CHANNEL=chrome` or `msedge` | Intentionally use an installed supported browser channel |

CI builds once and downloads that artifact for four built-route shards. The complete local verification runner also tests its just-built export without server reuse. Do not let a stale process or old output stand in for current source.

CI browser jobs use a digest-pinned Playwright image matching the installed package version, with browsers and system dependencies already present. This changes setup only; it keeps every browser shard and isolated project. Local runs still use the installation command above. Run `pnpm typecheck:e2e` from the repository root to check browser-file coverage and strict E2E TypeScript through the shared Node/compiler runner.

## Failures and visual changes

Inspect the trace, screenshot, console, and relevant fixture before changing assertions. Keep meaningful checks for exact values, approval/fee evidence, quote expiry, cancellation, keyboard focus, long inputs, 44px targets, footer clearance, overflow, and enlarged text.

Use a suite's documented snapshot policy. The separate [state lab](../../../docs/ui-state-lab.md) has platform-specific approved references; its baseline procedure differs from generic Playwright snapshots. Re-recording an unexplained failure is not validation.

## Evidence scope

### Simulated scenario catalog

`capture_scenario_matrix.ts` creates a browsable HTML index and JSON report with viewport geometry, image hashes, fixture provenance, and every capture failure. It uses a fresh isolated browser, blocks unknown external requests, and never signs or broadcasts a transaction. Run it from `apps/mini-app`:

~~~sh
FX_SCENARIO_APP_URL=http://127.0.0.1:4347 \
FX_SCENARIO_LAB_URL=http://127.0.0.1:4348 \
pnpm exec tsx e2e/capture_scenario_matrix.ts
~~~

Start the current static export and state lab separately; this command does not build or start either server. The app export must configure deterministic Ethereum/Base URLs under `https://eth-mainnet.g.alchemy.com/v2/` and `https://base-mainnet.g.alchemy.com/v2/`, intercepted by the existing gallery fixture. A build with empty RPC configuration fails the balance-readiness check instead of producing misleading funded screenshots. Restart the static server after rebuilding so its cached CSP matches the current HTML.

The matrix covers funded, verified-zero, and unavailable Trade/Earn/Borrow/Move editors, Portfolio, and the wallet drawer at 390×770, 390×500, and 1280×900. It separately captures Borrow/Earn lifecycle presentation, approval-required ActionReview, and position card/details through existing isolated harnesses. All images retain a simulation label. These rendered lifecycle states do not prove a transaction completed from the built app. Unsupported quote/protocol reads remain unavailable; physical keyboard behavior and other browser engines require separate checks.

Set `FX_SCENARIO_SECTION=app`, `transactions`, or `positions` for a bounded rerun. `FX_SCENARIO_OUTPUT_DIR` selects the artifact directory; otherwise each run gets a timestamped directory under `artifacts/scenarios/`. A balance-readiness timeout, runtime error, overflow, or inaccessible primary action appears in the index and makes the command fail. Inspect the report before sharing the gallery as evidence.

Built routes can contain real app components with synthetic protocol/wallet leaves. A screenshot proves the rendered fixture; a provider harness proves its mocked integration; an Ethereum fork proves only its covered local protocol behavior.

Real Privy/Telegram identity verification, physical wallet dispatch, and cross-chain settlement require separate checks. Lazy chunk changes should additionally load the emitted shared module through a real consumer dependency chain. Never submit credentials or funds to validate a display-only test.

See [testing](../../../docs/testing.md) for CI phases, protected fork commands, and reporting evidence.
