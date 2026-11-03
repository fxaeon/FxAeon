# Browser gate map

Built-route tests and isolated harnesses solve different problems. `pnpm test:e2e` collects the production-export suite only; it does not collect all the isolated projects.

Run these commands from the repository root. All nine isolated gates are included in `pnpm verify`.

| Gate | Collection/config under `apps/mini-app` | Command |
| --- | --- | --- |
| Built routes and interactions | `e2e/specs`; `playwright.config.ts` | `pnpm test:e2e` |
| Borrow eligibility | `e2e/borrow-harness`; `e2e/borrow-harness.config.ts` | `pnpm test:e2e:borrow-harness` |
| Move review/session behavior | `e2e/move-harness`; `e2e/move-harness.config.ts` | `pnpm test:e2e:move-harness` |
| Positions, review layout, list/detail continuity | `e2e/positions-harness`; `e2e/positions-harness.config.ts` | `pnpm test:e2e:positions-harness` |
| Privy send adapter | `e2e/specs/privy-send-adapter.spec.ts`; `e2e/privy-send-harness.config.ts` | `pnpm test:e2e:privy-send-harness` |
| Trade, Max, outcome and review preparation | `e2e/trade-harness`; `e2e/trade-harness.config.ts` | `pnpm test:e2e:trade-harness` |
| Telegram-only provider routing | `e2e/wallet-provider-harness.config.ts` | `pnpm test:e2e:wallet-provider-harness` |
| Mobile wallet-browser handoff | `e2e/mobile-wallet-harness.config.ts` | `pnpm test:e2e:mobile-wallet-harness` |
| Overlays, amount entry, page and portfolio states | `e2e/overlay-specs`; `playwright.overlay.config.ts` | `pnpm test:e2e:overlay` |
| Deterministic state catalog | `e2e/state-lab`; `playwright.state-lab.config.ts` | `pnpm test:e2e:state-lab` |

The Privy send spec is also collected by the built-route suite. Its focused configuration is useful for iteration, but that overlap is not additional independent real-wallet coverage.

## Select a focused test

Pass the spec name or Playwright filter after its script:

~~~sh
pnpm test:e2e:overlay move-form
pnpm test:e2e:trade-harness --grep "review"
~~~

The relevant package script owns its config and collection. Inspect that config before assuming a test is covered by another gate.

Built-route checks exercise exported metadata, navigation, form reachability, overflow, amount controls, and review interactions. Isolated suites preserve real controllers/components and replace wallet, SDK, RPC, or market leaves as documented by their fixtures. They cover their assertions; none independently establishes live RPC health, real signing, or production account configuration.

The app-shell overlay suite checks the mobile More dialog, its accessible
visually-hidden heading, focus handling and resize dismissal. Desktop checks
cover the icon rail at 840px and 1024px, expansion at 1280px, collapse and
reexpansion, session preferences across routes and reload, accessible link
names and current destinations, and content clearance without overflow. The
visible sidebar toggle must retain a 44px target and uniquely control its own
visible navigation. Transient hover/focus expansion must not move the content or
overwrite the saved preference, and it must retract after pointer/focus exit.

Earn form gates cover the compact three-method withdrawal row at 320/390px,
Instant-only output selection, and absence of token-only outcome rows. Funding
gates switch 1Y/1M ranges and verify that the headline changes with the selected
history while current funding remains independent. Both chart modes retain
keyboard inspection and selected-series help. Wallet identity tests require
bounded EIP-6963 data-image icons for additional wallets, existing catalog mark precedence (including Base), safe image-error fallbacks, preserve unknown explicit providers, and
defer a distinct standalone global fallback to Other wallets after explicit provider discovery, retaining exact-provider selection.

## Run collection and artifacts correctly

Disconnected form checks enter amounts and require the available public outcome
without a zero-wallet-balance notice or extra preview banner. Connect wallet
remains the action. Trade public facts must stay outside the wallet route cache;
Earn public deposit estimates must survive only for the exact amount and token;
Move public estimates must use the selected canonical chain pair and recipient.
Connection retains the ticket and replaces public context with a fresh real
account review. Cancellation, expiry and late responses are separate unit gates.

Local built-route tests rebuild unless `E2E_BUILD=0` explicitly requests an existing artifact. Avoid stale-server reuse for release checks. The [E2E package guide](../apps/mini-app/e2e/README.md) explains setup and reports.

`pnpm verify` runs isolated projects with at most two concurrent browsers, or serially on constrained hosts. CI divides them into three bounded groups, separately from the four built-route shards. A nonzero focused suite fails the gate and identifies its name.

The [UI state lab](ui-state-lab.md) has a separate visual-baseline policy. Intentional snapshot updates require inspecting images and documenting why behavior or appearance changed; re-recording is not a remedy for an unexplained failure.

## Existing configured export: hydration and passkey startup

These opt-in scripts are separate from the default CI export and the isolated
overlay harnesses. They never build, install dependencies, sign, or deploy.
Run them after the normal CI-equivalent build and checks finish. Then make a
separate configured export in a disposable verification
checkout, using a fake public app ID (no provider credentials):

~~~powershell
# From the repository root, after the default export tests have finished.
$env:NEXT_PUBLIC_PRIVY_APP_ID = 'clabcdefghijklmnopqrstuv'
$env:NEXT_PUBLIC_TELEGRAM_WALLET_MODE = 'passkey'
pnpm --dir apps/mini-app build
node apps/mini-app/e2e/verify-configured-hydration.mjs
node apps/mini-app/e2e/verify-configured-passkey-startup.mjs
~~~

Do not use the default unconfigured CI artifact as evidence for the configured
passkey branch. The second script requires actual passkey status/recovery calls
and a genuine emitted Next chunk containing the passkey implementation. It
does not mock `next/dynamic`, React, route providers, or application modules.
The nonempty fake app ID in the build recipe exercises the configured
client-only wallet boundary; the script does not attest production credentials.

By default each script serves the existing `apps/mini-app/dist` on an ephemeral
loopback port and closes it afterward. A missing export fails instead of
building. `FXAEON_HYDRATION_DIST_DIR` selects another existing export;
`FXAEON_HYDRATION_BASE_URL` selects an already running loopback server instead.
Neither option accepts a deployed target. Each run has a four-minute browser
budget and bounded per-operation timeouts.

The ordinary-browser matrix checks `/`, `/trade`, and `/positions` with saved
`official`, `dark`, `light`, unset/invalid preferences, and denied storage. Every
paint must remain dark even when the OS prefers light; saved light is a migration
input, never the expected palette. Hydrated connect controls and the Trade asset
picker must work without hydration diagnostics or uncaught page errors.

The configured passkey matrix checks fast replies and delayed bridge/status/
recovery for every saved theme variant except denied storage. It proves signed
launch status starts before the bridge is available, keeps the unknown view
neutral through recovery, and requires a connected wallet before passing. A
denied storage case remains in the ordinary-browser matrix: passkey transaction
recovery legitimately requires usable durable storage. All network boundaries
are deterministic: the Telegram host API is supplied by the fixture, its vendor
script is intercepted, server `status`/`transaction/status` replies are synthetic,
and RPC/other backends are unavailable. Unexpected wallet actions, native Privy
requests, or WebAuthn credential calls fail. This proves real built chunk loading
and hydration, not Telegram signature verification, live authentication, or RPC
health.

`FXAEON_HYDRATION_THEME=light` narrows either run to one saved preference;
the default is `all`. `FXAEON_HYDRATION_OBSERVE_MS` selects 100–5000 ms of
post-ready observation (default 1000). JSON results and unmasked synthetic phone
screenshots go to ignored `output/configured-startup`; set
`FXAEON_HYDRATION_ARTIFACTS` to choose a different directory. Record the checkout
revision and build environment with those artifacts. Run the runner guard tests
without a build using `node --test scripts/verify_configured_startup.test.mjs`.

Each configured result and its `TRACE` log includes a navigation-relative browser
timeline. Native `fetch` invocation and Resource Timing `startTime`/`responseEnd`
measure the status and recovery request intervals. The first visible neutral,
authenticated wallet control, and connected-state frames are sampled with
`requestAnimationFrame`; native first-paint and first-contentful-paint entries
are reported separately. These frame samples describe the first visible DOM
observed before paint, not a hardware display timestamp. Missing events remain
`null`. The fast case adds no response hold. The delayed case labels its
intentional bridge/status/recovery holds, their measured release commands, and
the four-minute run bound; those holds are never substituted for request timing
or subtracted to invent an unobserved latency. Fixtures are visibly synthetic,
so screenshots retain the wallet control's actual pixels.

## What needs additional evidence

The short-phone receipt gate at 320 × 568 requires token movements, position
facts, network fee and the primary action to fit together without reducing the
action below 44px. Bridge review checks require visible separation between
amount and ticker. Move form tests delay a quote and compare the Receive panel,
quote summary and CTA rectangles before/after resolution (1px tolerance), while
requiring placeholders rather than false Unavailable values during the debounce.

Portfolio startup checks keep unresolved identity independent of connected
portfolio layout. Only resolved guests see public discovery; only a verified
connection may show a portfolio skeleton after a pending-read threshold. Fast
reads skip skeletons, app chrome stays stable, and account changes retire old
totals and late reads. Borrow checks cover ON/OFF, unavailable
data, neutral labels and state-only color at narrow phone widths.

Use [protected Ethereum fork tests](testing.md#protected-ethereum-fork-tests) for their supported protocol execution. Real native Telegram login/recovery, physical wallet handoff, live Base delivery, and emitted SDK chunk loading require their own appropriately scoped checks.

Do not describe a mocked provider run as live authentication or a rendered review as a signed transaction. Record the revision, fixture, environment, and limitations with each result.

The funding review gate covers separate long/short pools, exact market/pool
binding, negative net offsets, omission of unverified net rates, expired and malformed reads,
shared-request deduplication and late-response isolation. Browser fixtures require
a single cost-group row at 320px and desktop widths, no duplicate in execution
details, and removal when its 60-second freshness window expires.

An empty-wallet provider fixture emits consecutive blocks and requires no repeat
discovery within the 15-second window, while manual refresh and wallet changes
still read immediately. Unit boundaries include elapsed-window, occupied,
uncertain and backward-clock cases.
