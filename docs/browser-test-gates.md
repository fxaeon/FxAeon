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
bounded EIP-6963 data-image icons and safe image-error fallbacks, preserve unknown explicit providers, and
defer a distinct standalone global fallback to Other wallets after explicit provider discovery, retaining exact-provider selection.

## Run collection and artifacts correctly

Local built-route tests rebuild unless `E2E_BUILD=0` explicitly requests an existing artifact. Avoid stale-server reuse for release checks. The [E2E package guide](../apps/mini-app/e2e/README.md) explains setup and reports.

`pnpm verify` runs isolated projects with at most two concurrent browsers, or serially on constrained hosts. CI divides them into three bounded groups, separately from the four built-route shards. A nonzero focused suite fails the gate and identifies its name.

The [UI state lab](ui-state-lab.md) has a separate visual-baseline policy. Intentional snapshot updates require inspecting images and documenting why behavior or appearance changed; re-recording is not a remedy for an unexplained failure.

## What needs additional evidence

Use [protected Ethereum fork tests](testing.md#protected-ethereum-fork-tests) for their supported protocol execution. Real native Telegram login/recovery, physical wallet handoff, live Base delivery, and emitted SDK chunk loading require their own appropriately scoped checks.

Do not describe a mocked provider run as live authentication or a rendered review as a signed transaction. Record the revision, fixture, environment, and limitations with each result.
