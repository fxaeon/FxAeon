# Runtime hardening changes — 3 October 2026

This note describes the runtime changes and their validation limits. PR #221 shipped at `7eef5f8dc4770ecfbc6cdc03183af404cb6b8c99`; all seven main-branch workflows, including deployment and live revision/configuration checks, passed. The final Ethereum fork browser replay at block 26,109,104 opened and fully closed ETH/BTC long and short positions. This is not proof of native Telegram/Privy behavior or cross-chain bridge execution. Later refinements require their own PR and deployment checks.

## Wallet review and transaction history

The review flow labels approvals separately from protocol actions. Approval rows identify the token/position approval, spender, and amount; the action uses its own confirmation label. The distinction is carried into Privy's send-request UI, the pending-transaction journal, recovery messages, and receipt presentation. Approval receipts do not imply that the following action was submitted or completed.

Receipt summaries now distinguish token-approval fees from action fees, report native transaction value separately from gas, and label bridge fees explicitly. On Base, the UI adds execution, L1 data, and operator-fee components when all are present; if receipt data is incomplete, it states that the fee total is partial.

The approval-history classification fix is included in PR #221. The reported historical close-route simulation fault has not been reproduced. Current fork close flows passed, but this does not establish the cause of that historical failure.

Prepared transaction details now have one home in the Steps disclosure. Exact contract, native value in wei, approval spender/amount, nonce, and calldata remain inspectable there. Advanced details contains quote and protocol metadata rather than a second copy of every transaction. The Anvil review extractor and browser regression share the same DOM reader, so moving a disclosure cannot silently remove transaction-binding evidence from the proof.

### Remaining action-specific review gaps

Source inspection on 3 October confirmed that rebalance/liquidation prices were not displayed. Since 9 October, position rows show each position's distance to its pool's rebalance point from live pool reads (see [Position brake](sdk-scope.md#position-brake)); reviews still show no post-action thresholds. `routeFacts` accepts an optional `executionCost.protocolFee`, but no action page supplies that prop, so this is not an implemented protocol-fee disclosure. These remain open product requirements, not verified features. Since then, reviews show the protocol fee rate from the quoted pool's own fee read (see [Protocol fee review data](sdk-scope.md#protocol-fee-review-data)), and Trade's ticket previews it; post-action thresholds are still not shown.

The pinned SDK exposes `openFeeRatio`, `closeFeeRatio`, and `repayFeeRatio` in pool information. Its bundled pool ABI contains `getRebalanceRatios` and `getLiquidateRatios`, but the supported position request types expose no user rebalancing enable/disable option. The [official mechanism](https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake) is automatic; [liquidation](https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake/liquidation-process) can follow failed rebalancing. Do not introduce a cosmetic opt-out or imply liquidation occurs only when rebalancing is disabled.

The next implementation must bind action-specific review facts to the accepted quote: post-action thresholds and leverage for open/add/reduce/adjust/borrow changes; received assets and fees for full closes; shares, minimum output, withdrawal method and redemption fee for fxSAVE; and delivery amount, destination, gas and bridge fees for Move. A full close has no post-action position threshold. Protocol fees must use the matching action's current pool parameters and correct amount basis; [documented fee percentages](https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fees) are governance-adjustable, so hardcoded percentages or reuse of a single opening fee across actions are insufficient. Unknown financial facts must remain unavailable, not become zero or fabricated precision.

The fork browser replay exposed a review timing defect: an initial gas request
could display “Unavailable” while still in flight. The hook now starts the
shared request before reading its cache state, so the existing loading view
is used. Fork assertions wait for a numeric gas estimate before signing and
retain the unavailable-estimate failure; they also use the current numbered
Confirm/Approve labels in expanded transaction details.

Three focused real-hook browser cases pass: initial loading, StrictMode request
deduplication with a resolved numeric fee, and an actual failed estimate. A
negative-control run with the old hook ordering failed the initial-loading
case as expected; the fixed source was restored and all three passed. Full
typechecking also passed after this correction.

## Portfolio and protocol reads

Wallet discovery is filtered to FxAeon's configured supported assets before it affects the asset list or completeness calculation. The headline portfolio total can retain a recent, complete value for the same wallet while a refresh is in flight; incomplete or stale reads are not converted into zero.

Ethereum portfolio and form consumers now share one canonical balance cache. Instrumented tests record one chain identity read, one native balance read, and one token multicall for concurrent consumers, and no additional reads for fresh navigation reuse. These are logical client calls in the test, not a measured production HTTP total: the production transport also performs a coalesced endpoint-chain proof on cold use and after its 60-second verification window. Wallet, session, and chain changes remain isolated. An optional indexed-data outage no longer blocks a total when the canonical supported-token balances and current prices are complete; missing prices and failed canonical reads still prevent a complete total.

Block-driven wallet refresh now refetches only stale active queries. A fresh balance or claimability query is not invalidated just because a block arrived. Manual refresh, wallet transfer events, and receipt-bound refresh retain their immediate path and cancellation of pre-receipt work.

The separate position-discovery fallback skips enumeration for empty pools and revalidates cached candidate ownership before reuse. Cold discovery now checks the newest 16 IDs first, then advances through older IDs in pairs of at most 128-call multicalls, without overlap. A wallet whose entire ownership is in the recent tail needs 16 owner checks rather than the previous 256. This is an owner-subcall comparison, not a claim of equivalent HTTP or provider-credit savings. Older holdings may require one extra sequential round because of the small first probe.

The 4,096-ID limit now bounds work per refresh rather than the lifetime number of NFTs minted by a pool. Recent positions remain discoverable after a pool exceeds that size. An incomplete window, changed wallet count, malformed response, or 12-second deadline still fails closed; holdings outside the window require complete indexer or cached-candidate coverage. The worst-case cold path remains expensive. Position state continues to refresh on new blocks; its live-state policy was not relaxed to produce a lower request count.

The targeted source comparisons are recorded in [Jumper and Curve](frontend-research-jumper-curve.md) and [Uniswap and Balancer](frontend-research-uniswap-balancer.md), with pinned upstream commits. These are bounded implementation studies, not exhaustive audits of those repositories.

The f(x) SDK and app read clients can use a bounded ordered RPC list for Ethereum and Base. Each provider URL is validated against its reviewed host and chain, chain identity is checked before use, and transient transport/upstream failures can fail over. Reverts, user rejection, and other request-level errors remain terminal. The production Content Security Policy allows the required Alchemy and Infura Ethereum/Base RPC hosts; provider keys are configured for the `fxaeon.com` browser origin.

HTTP requests prefer primary Alchemy, then Infura, then Alchemy2 on both chains.
The shared app transport, Ethereum SDK client and request-local SDK bridge
transport all consume this order. Missing optional providers are skipped;
adding or changing these build-time variables requires rebuilding the app.
WebSocket subscriptions retain their separate primary Alchemy → Alchemy2
order. No Infura WebSocket URL is inferred from its HTTP endpoint.

Maintainers verified that these four GitHub deployment secrets were added on 3 October 2026 (values intentionally omitted):

- `NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL`
- `NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL`
- `NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL`
- `NEXT_PUBLIC_INFURA_BASE_RPC_URL`

These `NEXT_PUBLIC_*` values are embedded in the static browser application at build time. GitHub Secrets protect them during deployment configuration, but the resulting RPC credentials are browser-visible and must remain restricted to the intended origin and chains.

## Gas limits, Max, and leverage

The pinned Privy React SDK 3.45.0 has a confirmation-screen unit error:
`totalGasEstimate` is assigned viem's `gas` count and then formatted as wei.
The version-scoped pnpm patch multiplies the prepared gas count by its
`maxFeePerGas` (or legacy `gasPrice`) before formatting. Missing estimates
remain unavailable. This changes the displayed execution-fee cap and funding
shortfall calculation, not the prepared transaction or signing fields. It
does not add Base L1 data/operator fees to Privy's own modal; FxAeon's route
review accounts for those separately. Tests execute the installed ESM and
CommonJS helpers against varying gas demand/prices, missing values, and a
historical receipt. No historical fee is used as a production default.

Wallet profile now provides direct export for the selected embedded wallet.
It closes the profile before opening Privy's secure export UI, releases the
profile focus trap, and does not reconnect or switch accounts. External
wallets do not receive an embedded-wallet export action.

Portfolio token discovery no longer calls Alchemy's all-token endpoint.
The portfolio and forms share canonical balance queries, including FXN;
legacy snapshots are filtered by chain and contract address. A recent complete
portfolio total survives transient read failures for at most two minutes,
without extending its original timestamp or carrying it across wallets.

Review internals are under one animated Details disclosure. Reduced-motion
preferences suppress the animation, and the 393×852 viewport check verifies
the collapsed review fits within half the screen and keeps Confirm above
navigation. Abort errors receive readable copy; the reported long planning
delay still needs request-level reproduction and is not claimed resolved.

Follow-up: rejected background route warm-ups now fall back to the normal fresh
planner. A warm route that expired or was invalidated while planning skips its
extra block read. Exact wallet/form/block and expiry checks still gate reuse;
an unavailable current snapshot cannot be used. Nine prefetch tests cover this
recovery and stale-session boundaries. This fixes a demonstrated failure path,
not a guarantee of fast upstream RPC responses.

Surface, disclosure, and transaction-stage motion now share the 180ms ease-out
tokens; control feedback uses 120ms. The wallet profile's actual sheet and
backdrop animate together. Transaction status entrance follows label/state
changes, without replaying on same-stage polling; balance values stay still.
Reduced motion disables those effects. All 30 ActionReview browser cases and
typecheck passed locally after these changes.

The advisory warm-up lookup now has a deadline at the original quote expiry,
including its final block read. A stalled warm-up releases the explicit Review
to fresh planning; a late result cannot replace a newer quote. Live leverage
corrections no longer wait for an unusable quote to settle. This does not bound
the fresh SDK planner or claim that upstream response times are resolved.
The 22 focused prefetch, leverage, and fee-presentation cases, the mobile fee
loading/failure browser case, and typecheck passed locally. Failed estimates
say Unavailable without promising that a wallet can show a final charge.

The Base Gas fee row now includes execution, L1 data, and operator fees; its
amount stays unavailable if either Base component is missing. Native value
and bridge protocol value remain separate from network gas. A fee-only total
is omitted when it would repeat the same aggregate. Fees below 0.000001 ETH
use Gwei so distinct small estimates remain distinguishable in compact rows.
All 24 focused fee, presentation, and review-summary cases passed after this
change. Privy's own Base fee row still lacks the additional fee components;
the complete estimate is available in the FxAeon review.

Standard, Fast, and Rapid fee controls and reviewed fee caps apply to the Privy send path. There, the wallet request uses the RPC gas estimate with 20% headroom, bounded against an invalid or excessive estimate. If an approval outlives its quote, the runner refreshes the selected tier but refuses to exceed the reviewed fee ceiling. The trade Max calculation reserves the estimated gas cost at the selected maximum fee, uses a bounded iteration count and deadline, and returns concise failure messages instead of treating arbitrary route failures as underfunded estimates. With an external wallet, that wallet owns fee selection and pricing; FxAeon does not impose the Privy fee caps on external sends.

Leverage bounds now reserve margin for the SDK's debt-ratio guard and selected slippage. The displayed maximum is an input guard, not a guarantee that every route at that value will plan; the SDK and current pool state still determine route validity.

## Focused validation reported

The following focused checks were reported as passing during development:

| Area | Passing cases |
| --- | ---: |
| Gas policy, native Max, and runner | 53 |
| Trade page Strict Mode plus repeated View Max interaction on the actual AmountField | 4 |
| Privy adapter Chrome harness | 12/12 (covers all fee tiers, approval/action sends, modal preflight, and external sends without app fee caps) |
| Sequential runner | 26/26 (includes modal preflight before fresh simulation and fee estimation) |
| Review and positions layout harness | 31/31 (embedded/external fees, approval recovery, mobile CTA and expanded details) |
| Actual ActionReview approval-draft harness | 3/3 |
| State-lab browser and reviewed snapshots | 5/5 |
| SDK/RPC fallback | 13 |
| Receipt presentation | 8 |
| Portfolio | 24 |
| Realtime chain reads | 5 |
| Leverage bounds | 6 |
| Browser chain switching | 9 |

The latest consolidated `pnpm verify` run reported 543 passed and 4 skipped unit cases, then passed the production build, bundle and built-secret checks. All 193 main browser cases, 56 isolated browser cases, and 14 landing theme/viewport states passed. That command exited nonzero because its concurrent typecheck caught an optional environment-variable narrowing error in temporary fork-replay setup. The temporary setup was removed, and the full `pnpm typecheck` then passed. The unchanged browser stages were not rerun. Local execution used Node 24 and installed Chrome; repository CI uses the required Node 22 and pinned Playwright browser and remains a separate release gate.

The Anvil all-suite run passed four cases, with protocol and fxSAVE manifests verified. An earlier cold-fork SDK multicall exceeded the hosted 5-second deadline; a 60-second deadline now applies only to loopback endpoints in explicit local-fork mode. Hosted endpoints retain the 5-second limit. The final browser manifest records four successful opens and full closes, canonical zero accounting after closure, positive USDC close proceeds, approval/action binding, account/ownership isolation, and successful existing-position borrowing and fxSAVE deposit. Withdrawal coverage verifies reviews and calldata; cross-chain execution was not tested. Historical close and bridge replay did not establish the cause of the reported live failures, so those symptoms are not claimed as conclusively resolved.

## Review priority and visual hierarchy follow-up

A live external-wallet review observation captured 143 eth_call requests over
about 50 seconds, including background reads after the review became ready.
Repeated position-group reads followed Ethereum blocks. This is evidence of
competing work, not a measurement that all 143 calls belong to the planner.

ActionReview now holds a reference-counted pause while planning, reviewing,
refreshing, or executing. Only automatic block-triggered full-position reads
pause; initial wallet reads, manual refresh, bounded failure recovery, and
receipt-bound reconciliation retain their existing behavior. The provider and
its verified snapshot remain mounted. Releasing the last review catches up to
the latest block once. Already in-flight RPCs are not cancelled by this change.

Review facts use one label/value column at every viewport width. The primary
input amount has stronger emphasis, and standalone review cards are limited
to 480px. No transaction fact or signing guard is removed.

Validation: seven position-provider browser cases passed, with the new
concurrent-pause case rerun after tightening same-render pause acquisition.
The actual ActionReview source harness passes mobile CTA visibility, half-screen
collapsed height, keyboard disclosure, reduced motion, and wide-viewport row
alignment. Typecheck, focused ESLint, and diff checks pass locally. These checks
use Node 24 and installed Chrome; CI remains the release gate. Live timing after
deployment and broader action-specific review redesign remain unverified.
