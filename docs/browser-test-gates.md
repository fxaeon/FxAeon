# Browser test gates

The production mini-app suite and isolated component harnesses use separate Playwright configs. `pnpm test:e2e` runs only the production export suite; it does not collect the isolated harness specs.

| Gate | Fixture and config | Focused command |
| --- | --- | --- |
| Production routes and interactions | `apps/mini-app/e2e/specs`, default Playwright config | `pnpm test:e2e` |
| Borrow selection eligibility | `apps/mini-app/e2e/borrow-harness`, `e2e/borrow-harness.config.ts` | `pnpm test:e2e:borrow-harness` |
| Move review layout | `apps/mini-app/e2e/move-harness`, `e2e/move-harness.config.ts` | `pnpm test:e2e:move-harness` |
| Positions: action review layout, position rows and the list-to-position flow, and a new position carried from Trade's result to its page | `apps/mini-app/e2e/positions-harness`, `e2e/positions-harness.config.ts` | `pnpm test:e2e:positions-harness` |
| Privy embedded send adapter (its spec sits in `e2e/specs`, so `pnpm test:e2e` runs it too) | `apps/mini-app/e2e/specs/privy-send-adapter.spec.ts`, `e2e/privy-send-harness.config.ts` | `pnpm test:e2e:privy-send-harness` |
| Trade: split slider and outcome preview, native Max, review preparation and gas checks | `apps/mini-app/e2e/trade-harness`, `e2e/trade-harness.config.ts` | `pnpm test:e2e:trade-harness` |
| Overlay lifecycle, app shell, Portfolio first load, position brake, portfolio asset states, and wallet refresh | `apps/mini-app/e2e/overlay-specs`, `playwright.overlay.config.ts` | `pnpm test:e2e:overlay` |
| Product state catalog | `apps/mini-app/e2e/state-lab`, `playwright.state-lab.config.ts` | `pnpm test:e2e:state-lab` |

`pnpm verify` runs the isolated browser gates sequentially after the shared build checks. This keeps the fixtures out of normal product E2E and limits simultaneous browser memory use. A nonzero result from any focused suite makes `pnpm verify` fail and names the failing gate in its output.

The production suite includes route-specific metadata assertions before
hydration and compact form checks at 393×852. It checks review-action clearance,
44px amount shortcuts, and reachability at 200% text in Light (official) and
Dark themes. The overlay suite verifies portfolio asset loading, empty,
unavailable/retry, and refreshing-with-holdings states; its wallet refresh
harness covers fan-out, account changes, synchronous reader failures, and
retry. These suites do not establish live RPC health or protocol execution.

Protected fork coverage has separate commands and credentials; it is not part
of `pnpm verify`. See [testing](testing.md) for the Anvil scope and
[release validation](release-validation.md) for revision-specific results.

The UI state lab's fixture states, capture instructions, and visual-comparison policy are documented in [ui-state-lab.md](ui-state-lab.md).
