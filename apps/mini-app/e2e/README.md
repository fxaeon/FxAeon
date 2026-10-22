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

## Failures and visual changes

Inspect the trace, screenshot, console, and relevant fixture before changing assertions. Keep meaningful checks for exact values, approval/fee evidence, quote expiry, cancellation, keyboard focus, long inputs, 44px targets, footer clearance, overflow, and enlarged text.

Use a suite's documented snapshot policy. The separate [state lab](../../../docs/ui-state-lab.md) has platform-specific approved references; its baseline procedure differs from generic Playwright snapshots. Re-recording an unexplained failure is not validation.

## Evidence scope

Built routes can contain real app components with synthetic protocol/wallet leaves. A screenshot proves the rendered fixture; a provider harness proves its mocked integration; an Ethereum fork proves only its covered local protocol behavior.

Real Privy/Telegram identity verification, physical wallet dispatch, and cross-chain settlement require separate checks. Lazy chunk changes should additionally load the emitted shared module through a real consumer dependency chain. Never submit credentials or funds to validate a display-only test.

See [testing](../../../docs/testing.md) for CI phases, protected fork commands, and reporting evidence.
