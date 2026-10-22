# Supplemental browser acceptance

This suite exercises the built, loopback-only **simulation** app. It is a step-3
checkpoint, not the final release gate, a live protocol execution, or proof of
native Telegram/MetaMask behavior. The test build cannot run on a public host.
Every test context blocks external requests and fails if any are attempted.

## Run

From `rebuild/`, use the pinned Node 22 and pnpm 11.19.0 toolchain:

```sh
pnpm build:fixture
pnpm test:browser
```

Playwright owns port 4173 for the duration of a run. The server must be absent
before starting: `reuseExistingServer` is false. `scripts/serve.mjs` serves
`dist-fixture` on loopback and applies the built `_headers`, including CSP. Tests
check that the actual app response contains the security policy.

The package pins `@playwright/test` 1.64.1 with its managed Chromium 156. In the
current workspace, that browser download was truncated. The supplemental run
uses `/tmp/fxaeon-chromium/chromium`, version 153.0.8010.0. An explicit executable
can be supplied through `FXAEON_CHROMIUM_EXECUTABLE`; the local fallback is used
automatically only outside CI when that path exists. Reports identify the
executable, expected pinned version, and actual observed browser version.
Passing on this fallback does not claim pinned Chromium 156 coverage.

## Acceptance scope

- Exact 18-decimal deposit through review, the exact transaction fields, one
  signing request, verified receipt, and history isolated to the selected account.
- No provider RPC on initial render; explicit connection and chain switching.
- Definite rejection and fresh-review retry; uncertain dispatch; pending receipt;
  revert; missing position identity; unavailable receipt; no automatic replay.
- Review expiry/refresh, account change, nonce drift, duplicate confirms,
  insufficient funds, simulation failure, and a cancelled late quote producer.
- Restored saved history cannot claim current confirmation without new evidence.
- Wallet focus trap, Escape, browser Back, nested disclosure dismissal, restored
  focus, and closing an issued request's view without losing its outcome.
- Dark/light themes at 1280, 393, and 320 CSS pixels; 320×568 with 200% root text;
  reduced motion; exact transaction disclosure readability; reachable footer;
  horizontal overflow; 44px review targets; WCAG A/AA axe checks.
- Theme changes preserve deposit, leverage, and explicit slippage preference.

## Evidence

The runner writes JSON/HTML results under `docs/evidence/`, retains failure
screenshots and traces, and captures selected trade/review/receipt/history views
with `checkpoint-` names. Overlay screenshots use the actual viewport, avoiding
full-page capture resizing of fixed dialogs. Test reports contain the actual
browser version and selected accessibility trees. The integrator may curate a
smaller final evidence set.

Set `FXAEON_BROWSER_REPORT_TAG` to a lowercase label for a targeted regression
rerun (for example `text200`) so its JSON/HTML/traces do not replace the full
checkpoint report. Omit the variable for the standard complete acceptance gate.

The source fixture intentionally resets provider/receipt state on reload. A
saved confirmed hint therefore may already have been rechecked into `Pending`
by the time the history page is opened. The acceptance invariant is no false
current confirmation and no replay; the test permits the documented intermediate
`Needs verification`, `Pending`, and `Unverified` states.
