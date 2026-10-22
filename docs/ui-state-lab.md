# UI state lab

The state lab is a deterministic local component catalog under `apps/mini-app/e2e/`. It bundles its entry in memory and uses a loopback fixture server, not the Next.js export or a production wallet/chain.

## Run

From the repository root:

~~~sh
pnpm test:e2e:state-lab
~~~

For interactive inspection without running tests:

~~~sh
pnpm --dir apps/mini-app dev:state-lab
~~~

Visit [127.0.0.1:4322](http://127.0.0.1:4322), or the configured `UI_STATE_LAB_PORT`. Stop the server with Ctrl+C. The dedicated [Playwright config](../apps/mini-app/playwright.state-lab.config.ts) starts only this fixture server.

## What is real

The lab uses real global/product-shell styling, CSS modules, icons/token artwork and licensed Inter font. Amount entry uses `AmountFieldView`. Transaction status, result notices, receipt facts and consequence summaries use production models/components.

Fixtures supply deterministic values and synthetic service leaves. No signing or protocol network path is connected. The catalog covers loading, zero, positive, partial, stale and unavailable data; transaction stages; long values; keyboard focus; reduced motion; and phone/desktop sizes.

Legacy theme inputs can remain as migration/compatibility fixtures. They do not establish current public appearance choices. The maintained product/design contract is dark-only.

The separate built `action-review-harness.spec.ts` exercises the actual review controller through planning, review, wallet request, submission, confirmation and interruption/failure paths. A state-card screenshot is narrower evidence.

## Captures and approved references

Runs attach focused images to the Playwright report. Set `UI_STATE_CAPTURE=1` to additionally save review images under `apps/mini-app/e2e/state-lab/captures/`.

On Windows, normal runs compare the committed approved references in `state-lab-snapshots/`. Other platforms run behavior and attach images without asserting Windows pixels. A missing/incomplete required set fails.

Intentional baseline updates require visual review on the pinned Windows Playwright environment:

~~~powershell
$env:UI_STATE_APPROVE_BASELINES = '1'
pnpm --dir apps/mini-app exec playwright test --config playwright.state-lab.config.ts --update-snapshots
~~~

The approval command fails on other platforms. Use pinned Chromium, device scale 1, `en-US`, UTC, and the configured viewports. Do not update a baseline to conceal an unexplained failure.

## Evidence limits

Record the source revision, fixture state, platform/browser and intentional visual change. The lab validates its rendered and interactive states, not live balances, native Telegram identity, physical wallet dispatch, protocol execution or cross-chain settlement.

Use the [browser gate map](browser-test-gates.md), [testing guide](testing.md), and [capture provenance](position-screenshot-fixture.md) for the wider verification path.
