# FxAeon · Transaction journeys

An isolated interactive design reference for four connected product journeys. This is not a production patch. It never connects a wallet, constructs a real transaction, queries an RPC, or deploys an application.

## Open

Open `index.html` from a local server, or build the single-file reference:

```sh
cd design/transaction-journeys
python3 build.py
# Open FxAeon-journeys.html in a browser; it also works without a server.
```

Start on Trade, Earn, Borrow or Positions. Edit an amount, review the consequence, approve the sample allowance when needed, then confirm the sample action. The resulting position, loan or savings balance and its History entry share one sample account. Use **Sample controls** for changed fees, declined requests, unknown status, reverts and missing position observations.

Earn's withdrawal is queued. It does not pay the wallet when the request confirms. Use **Make queued withdrawal claimable**, then claim the separate fxUSD and USDC sample payouts.

## Scope

- **Trading:** open an ETH or BTC long; see contribution, exposure, debt and equity together.
- **Savings:** deposit fxUSD, receive estimated fxSAVE shares, request withdrawal, then claim.
- **Borrowing:** add debt, repay debt, add or remove collateral from an existing ETH-backed sample loan.
- **Position management:** add, proportionally reduce, close, or change leverage; compare current and expected position values.
- **History:** the token-led, rounded, graphite direction remains the baseline. New sample results reopen their own records. Search and action/status filters work.

These are four representative journeys with twelve action variants plus a claim, not every production route. Short positions, direct fxSP, instant withdrawals, bridges and live wallet integrations are outside this reference. Production navigation, History pagination, wallet scoping, actual network filters and data notices must not be replaced with the preview's navigation and arrays.

## Visual system

Graphite surfaces, blue actions, token pairs, aligned figures and restrained success color follow the existing product. Mobile places the relevant outcome before the review action; desktop pairs the form with a more detailed position or loan summary. The review, wallet request, pending state and receipt preserve the action's identity.

`assets/` reuses existing repository asset blobs. No font files are included. The typography stack uses an installed Inter when available, then system fonts. Use the production application's existing font loading when integrating the presentation.

## Execution boundary

`model.js` is a deterministic **presentation fixture**, not protocol math, a route planner, a gas estimator, a ledger, or a security boundary. Its simple dollar relationships, prices, share ratio, 65% input cap, costs and split claim are illustrative only. They must never be used to prepare a live transaction or imply protocol risk limits.

The interface deliberately does not invent live APY, borrowing rates, liquidation prices or verified on-chain receipts. The fxSAVE final-share minimum caveat remains visible. Returning collateral from a closed trade is not described as profit.

A production integration should retain the reviewed intent, executable payload, freshness and session guards, allowance check, wallet callbacks, transaction identity and existing receipt verification. Replace the fixture with adapters to those existing facts, not the other way around.

## State invariants

An approval does not execute the action. A declined action retains its confirmed sample approval. Its fee is charged once, separately from the action fee. An updated fee needs acceptance and another review action before the wallet opens.

An unknown submitted result offers a status check, not another submission. Approval recovery cannot complete the action. A confirmed action without a refreshed position does not replace the position with its preflight estimate. Only the sample observation step updates the account and final receipt. Completion while another record is open does not replace that record's dialog.

Unsubmitted reviews can be edited or closed. Closing a review is not allowance revocation. Submitted operations cannot be cancelled by closing the UI. Reverts retain observed sample gas costs but do not apply the intended payout or debt change.

Storage is namespaced to `fxaeon-design-v4`. It is optional: denied storage falls back to the in-memory session. Reset affects this preview only. Historical seed rows are independent illustrations, explicitly separate from the sample account's opening balance.

## Tests

```sh
node --check app.js
node --test tests/model.test.cjs
python3 build.py
python3 -m pip install playwright==1.57.0
python3 -m playwright install chromium
python3 tests/browser.py
# Set CHROMIUM=/path/to/chromium to use an existing browser.
```

The branch-only workflow builds and tests this directory and uploads the reference and rendered previews. It has read-only repository permissions and no production environment, secrets or deployment step.

Model tests cover input validation, distinct asset effects, allowance retention, fee accounting, queue/claim separation, idempotent settlement and state transitions. Browser checks cover five product surfaces and thirteen review/receipt examples at seven viewport sizes, followed by interaction and recovery checks. Selected screenshots are actual Chromium renders.

These checks do not establish WCAG conformance, security, real-device quality, live execution correctness or superiority over other products. Browser tests use an opaque-origin renderer. Persistence restoration uses an explicit storage test double; this is not proof of real localStorage or cross-tab recovery. No production application build or live wallet was run for this reference.

## Source mapping

Pinned reference: `e15d1da2ca6432702132265ee1a36a9d78c3c4a5` in `fxaeon/FxAeon`.

- `apps/mini-app/src/app/globals.css`: existing surface, type, spacing, motion and action-color roles.
- `apps/mini-app/src/components/review/actionReviewPresentation.ts`: intent-specific review facts, queued withdrawal semantics and final-share minimum caveat.
- Existing review summaries, reviewed-action model and risk-price components: preserve their validated units and unavailable/freshness states during integration.
- Existing `WalletActivity`: retain the real feed, filters, account scoping and record identity. This reference is not a replacement data source.

Review figures must come from the accepted executable route. Completed figures must come from actual receipts and the relevant refreshed position, loan, share or claim observations. ETH, stETH, wstETH and WBTC units must remain distinct. Do not carry this fixture's dollar math into the production adapters.
