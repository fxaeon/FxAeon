# FxAeon reference research

Research date: 22 October 2026.

## Scope and evidence limits

This is a targeted, read-only source review of all 14 requested repository or organization references. The sources below were fetched from primary GitHub repository APIs and files at the recorded commits. Thirty-eight source files were inspected, with relevant ranges read for long files. Reference applications were not installed or run. Their live UIs were not inspected. This report does not establish the current production deployment of any project.

No reference source code was copied into the rebuild. Observations describe what the inspected source expresses. Adopt and avoid entries are recommendations for an original FxAeon implementation.

Jumper, the selected Synthetix loan UI, and the selected Maker/Sky SDK are archived. The requested Maker repository has moved to the sky-ecosystem organization. A search for Jupiter Terminal resolves to jup-ag/plugin. These facts affect how the references should be used: historical patterns can inform design, but cannot establish current supported integrations.

The reference projects do not define f(x) Protocol economics. Contract addresses, leverage limits, risk thresholds, fees, withdrawal assets, settlement behavior, quote validity and transaction construction must be established separately from authoritative f(x) sources and the old application's extracted specification. Do not transplant another protocol's liquidation model.

## Recommended decisions for the first leveraged-long slice

1. **One accepted transaction intent.** Represent account, chain, asset, amount in raw units, direction, leverage, slippage and prepared transaction identity together. A review must correspond to that intent. Input, wallet or chain changes invalidate acceptance. A replacement quote that changes what the user is accepting requires a refreshed review. This applies the source patterns from Uniswap and Balancer; the exact intent representation is a new FxAeon design.
2. **Separate observable transaction stages.** Distinguish entering input, quoting, review, allowance check, approval awaiting wallet, approval submitted, approval confirmed, opening awaiting wallet, opening submitted, opening confirmed, rejection and failure. A timeout after a hash is available is an unresolved receipt lookup, not proof that the transaction failed.
3. **An explicit action plan.** Plan approval only when the current token, owner, spender and chain allowance require it. Native asset transfers do not need ERC20 approval. Let the single primary action read Approve [token] and then Open long as appropriate. Approval success must never be presented as position success.
4. **Stable review and valid execution.** Freeze the displayed accepted values during wallet handoff and chain confirmation. Separately verify expiry, account, chain, balance, allowance and the prepared call before sending. Quote freezing must not allow stale submission. Simulate and estimate the same calldata, destination and native value that will be sent.
5. **Preserve partial progress.** A successful approval remains successful if the opening transaction is rejected. A retry rechecks allowance and resumes the uncompleted action; it must not replay completed writes or assume that a rejected signature removed an allowance.
6. **Keep money calculations outside React views.** Use integer token units and explicit decimal conversion boundaries. Keep derived collateral, debt, user equity, exposure, fees and protocol-specific risk calculations in pure, separately testable functions or a typed protocol adapter. Never use floating point display values to construct transactions.
7. **Honest result and history states.** Keep account, chain, intent ID, transaction hashes and receipt status. Show a confirmed position only from evidence of the opening transaction and parsed/read position data. Keep failed history loading separate from empty history.
8. **A small complete surface.** Finish Trade input, review, approval, open, confirmation, the resulting position and a matching History record before expanding other feature pages. Build the shared action model and visual primitives so Earn, Borrow and Move can use them later.

### Verification that resolves concrete risks

- Domain checks: raw-unit parsing, rounding, fee units, zero/invalid/oversized input, and the leverage/risk calculations supported by authoritative f(x) mechanics.
- State checks: old quote resolves late; amount changes during quoting; account or chain changes during review; allowance changes; rejection after successful approval; duplicate clicks; expired quote; failed simulation; transaction replacement; receipt lookup interruption.
- Browser journey: choose asset and amount, configure long, review, approve when required, open, inspect confirmation and position/history. Use a deterministic adapter for reproducible UI state coverage and, when available, a separately identified fork/RPC test for real contract behavior. Passing the former does not establish the latter.
- Render checks: narrow Android-sized viewport, desktop viewport, long amounts, missing fiat price, pending data, keyboard focus, reduced motion and dialog scrolling. Capture the rendered result, not only component source.
- CI: build, type checking, relevant domain/state tests and the complete browser journey. A fixed-block fork test is useful when it verifies actual contract interaction; do not copy a large reference project's entire CI matrix merely to increase test count.

## Coherent art direction

The references should supply interaction and engineering lessons. FxAeon needs one owned visual language.

- The inspected baseline DESIGN specifies neutral charcoal and blue. The user has authorized a new art direction; the baseline palette is context, not a restriction on that decision. Propose one owned FxAeon direction with a coherent type scale, surface hierarchy, accent system and motion language, then record the selected direction in DECISIONS. Do not combine Aave typography, Curve tables, Jupiter controls and Jumper cards as four visible design systems.
- Use one surface scale, one spacing scale, one radius family, one type hierarchy and consistent semantic states. Violet marks the active action and selected intent; status colors retain their own meaning. Use official token and protocol assets.
- Make the action and the money immediately legible. In a compact review, pair the position identity with the paid amount in the top row when space permits, then group the key resulting position values. Keep execution price, protocol fee and slippage/price impact visible according to the agreed FxAeon review specification. Unknown data must remain visibly unknown.
- Use the same economic record across input preview, accepted review, confirmation, position and history. Each surface may emphasize different fields, but amounts and labels must not contradict one another.
- Keep one primary transaction action. Secondary details should answer a real question such as exact token amount, spender, minimum outcome or explorer record. Avoid repeated headings, marketing text, decorative status chips and nested card borders that add height without meaning.
- Mobile needs its own composition: readable paired values, adequate touch controls, a review that can scroll, and stable placement of the primary action. Do not shrink a desktop table into a phone.
- Motion should explain changes of state and preserve continuity. Use short opacity/position transitions, reserve layout space while data loads, and honor reduced motion. Never animate a balance toward an unconfirmed outcome or make a risky action look complete before receipt evidence exists.
- Judge craft against rendered screenshots and actual interaction. Source files and familiar brand names cannot establish that the resulting FxAeon UI is clean, accessible or polished.

## Cross-feature application

| FxAeon area | Primary references | Decision |
| --- | --- | --- |
| Trade | Uniswap, Balancer, Jupiter, Rabby | Accepted quote identity, explicit action stages, validated external data, simulation outcomes |
| Positions | Curve, Aave, Synthetix, Maker/Sky | Separate equity/collateral/debt, before/after changes, stable position identity, domain calculations |
| Earn | Lido, Aave, Balancer, DefiLlama | Deposit/withdraw/claim states, partial completion, yield composition and provenance |
| Borrow | Aave, Curve, Maker/Sky, Synthetix | Clear collateral and debt effects with protocol-specific risk, never transplanted formulas |
| Move | Jumper, Jupiter, Lido | Source/destination clarity, pending progress, complete versus partial outcomes |
| History | Jumper, Aave, Curve, Synthetix | Shared transaction semantics, mobile cards, explicit empty/error states, explorer evidence |
| Design system | Decentraland UI2, Aave, Jumper | Centralized semantic tokens and inspectable states, implemented in FxAeon's identity |
| Transaction architecture | Balancer, Uniswap, Lido, OpenSea, Zora, Rabby | Planning separate from execution, dependency-aware approval steps, immutable review, guarded retries |
| CI and performance | Balancer, Curve, Jumper, Lido, Zora, Jupiter | Layered relevant checks, test production build, reproducible fork where useful, cancel superseded reads |

## Repository and organization map

| Requested reference | Selected repository | Commit | Archived | Primary relevance |
| --- | --- | --- | --- | --- |
| jumperexchange/jumper-exchange | [jumperexchange/jumper-exchange](https://github.com/jumperexchange/jumper-exchange) | [eee099c8](https://github.com/jumperexchange/jumper-exchange/commit/eee099c8390dc8841179f80eaed027756a447e66) | Yes | Move, History, design system, CI |
| aave/interface | [aave/interface](https://github.com/aave/interface) | [10ee9371](https://github.com/aave/interface/commit/10ee93718548922a87324d9861cb90dcda70415b) | No | Borrow, Earn, Positions, History, design system, performance |
| balancer/frontend-monorepo | [balancer/frontend-monorepo](https://github.com/balancer/frontend-monorepo) | [dd7d76a0](https://github.com/balancer/frontend-monorepo/commit/dd7d76a0f9c0ec07c40a9f800165a12ee90b33ce) | No | Trade, Earn, transaction system, CI, performance |
| curvefi/curve-frontend | [curvefi/curve-frontend](https://github.com/curvefi/curve-frontend) | [641769e4](https://github.com/curvefi/curve-frontend/commit/641769e455027718a7bc666230b982356308528f) | No | Trade, Borrow, Positions, History, CI, performance |
| Uniswap/interface | [Uniswap/interface](https://github.com/Uniswap/interface) | [c76a14a0](https://github.com/Uniswap/interface/commit/c76a14a089f9a25c3a65da8490efdc37bfe3587d) | No | Trade, Move, transaction system, design system, performance |
| RabbyHub/Rabby | [RabbyHub/Rabby](https://github.com/RabbyHub/Rabby) | [c3aed73f](https://github.com/RabbyHub/Rabby/commit/c3aed73f4c5f1e7c88c31331b0b0b72c6e8f2f4a) | No | wallet integration, Trade, Borrow, transaction system, History |
| Synthetixio organization | [Synthetixio/snx-loan-ui](https://github.com/Synthetixio/snx-loan-ui) | [516baf06](https://github.com/Synthetixio/snx-loan-ui/commit/516baf06ba0fb6f1bd99194c1993cf330be02151) | Yes | Borrow, Positions, History, performance |
| makerdao organization | [sky-ecosystem/dai.js](https://github.com/sky-ecosystem/dai.js) | [6e9de6c4](https://github.com/sky-ecosystem/dai.js/commit/6e9de6c44d7334d0bbd073a2f26d5751fe834f50) | Yes | Borrow, Positions, transaction system |
| lidofinance organization | [lidofinance/ethereum-staking-widget](https://github.com/lidofinance/ethereum-staking-widget) | [35aaa541](https://github.com/lidofinance/ethereum-staking-widget/commit/35aaa541e98f8a9336e1acfa8463a80f8b9f8382) | No | Earn, Move, transaction system, CI |
| jup-ag organization | [jup-ag/plugin](https://github.com/jup-ag/plugin) | [0bf757d9](https://github.com/jup-ag/plugin/commit/0bf757d986cdd1937afc49bfabba28c56d52ba47) | No | Trade, Move, quote system, performance |
| DefiLlama organization | [DefiLlama/yield-server](https://github.com/DefiLlama/yield-server) | [40307814](https://github.com/DefiLlama/yield-server/commit/40307814aebd5f567963a57698e9fbf777389219) | No | Earn, Borrow, analytics, data system |
| ourzora organization | [ourzora/zora-protocol](https://github.com/ourzora/zora-protocol) | [32c2931a](https://github.com/ourzora/zora-protocol/commit/32c2931a444b4405b107a49016dff0059b05b06f) | No | transaction system, Trade, CI |
| decentraland organization | [decentraland/ui2](https://github.com/decentraland/ui2) | [f9d85aa3](https://github.com/decentraland/ui2/commit/f9d85aa368a482f1ffe281c4dced9814625cde51) | No | design system, UI states, CI |
| ProjectOpenSea organization | [ProjectOpenSea/seaport-js](https://github.com/ProjectOpenSea/seaport-js) | [b0cda767](https://github.com/ProjectOpenSea/seaport-js/commit/b0cda76744adac17efb32bc6defdc9b157a834cd) | No | transaction system, Trade, Earn, CI |

## 1. jumperexchange/jumper-exchange

Selected repository: [jumperexchange/jumper-exchange](https://github.com/jumperexchange/jumper-exchange). Commit: `eee099c8390dc8841179f80eaed027756a447e66`. Archived at inspection: yes.

FxAeon relevance: Move, History, design system, CI.

### Inspected evidence

- [src/components/composite/JumperWidget/components/Summary.tsx](https://github.com/jumperexchange/jumper-exchange/blob/eee099c8390dc8841179f80eaed027756a447e66/src/components/composite/JumperWidget/components/Summary.tsx)
- [src/components/composite/cards/ProcessingTransactionCard/ProcessingTransactionCard.tsx](https://github.com/jumperexchange/jumper-exchange/blob/eee099c8390dc8841179f80eaed027756a447e66/src/components/composite/cards/ProcessingTransactionCard/ProcessingTransactionCard.tsx)
- [src/components/composite/TransactionTable/components/TransactionSummaryRowMobile.tsx](https://github.com/jumperexchange/jumper-exchange/blob/eee099c8390dc8841179f80eaed027756a447e66/src/components/composite/TransactionTable/components/TransactionSummaryRowMobile.tsx)
- [.github/workflows/playwright.yml](https://github.com/jumperexchange/jumper-exchange/blob/eee099c8390dc8841179f80eaed027756a447e66/.github/workflows/playwright.yml)

### What the source shows

- Source and destination token amounts use the same display field primitive.
- Processing cards preserve token and chain identities, status, description and an optional timer.
- Mobile history reuses column definitions while composing stacked sections.
- CI builds once, shares the production build across Playwright shards, and merges reports.

### Adopt in the original implementation

- Give Move an explicit from/to summary and a persistent progress record.
- Use the same semantic transaction record in responsive desktop rows and mobile cards.
- Test the same production build that reviewers inspect.

### Avoid or qualify

- Repository is archived; source patterns are not evidence of the current deployed Jumper experience.
- Do not copy its widget dependency stack, partner themes or cross-chain routing mechanics into f(x).
- Do not show timer precision without a reliable estimate.

## 2. aave/interface

Selected repository: [aave/interface](https://github.com/aave/interface). Commit: `10ee93718548922a87324d9861cb90dcda70415b`. Archived at inspection: no.

FxAeon relevance: Borrow, Earn, Positions, History, design system, performance.

### Inspected evidence

- [src/components/transactions/FlowCommons/TxModalDetails.tsx](https://github.com/aave/interface/blob/10ee93718548922a87324d9861cb90dcda70415b/src/components/transactions/FlowCommons/TxModalDetails.tsx)
- [src/components/transactions/TxActionsWrapper.tsx](https://github.com/aave/interface/blob/10ee93718548922a87324d9861cb90dcda70415b/src/components/transactions/TxActionsWrapper.tsx)
- [src/modules/history/TransactionRowItem.tsx](https://github.com/aave/interface/blob/10ee93718548922a87324d9861cb90dcda70415b/src/modules/history/TransactionRowItem.tsx)

### What the source shows

- Overview fields support before/after values, token/USD amounts and per-field loading placeholders.
- The action wrapper distinguishes approval and main-action state and blocks on wrong network, missing amount, pending data and action-blocking errors.
- History adapts into stacked cards and memoizes stable transaction rows.

### Adopt in the original implementation

- Use common amount, cost and before/after primitives across transaction reviews.
- Drive the action button from transaction state and verified prerequisites.
- Keep one normalized history entry with responsive presentation.

### Avoid or qualify

- Do not import Aave health-factor math or liquidation thresholds into f(x).
- Do not reproduce a pair of stacked approval/action buttons if FxAeon's agreed design calls for a single changing primary button.
- Do not turn unknown fee data into a displayed zero.

## 3. balancer/frontend-monorepo

Selected repository: [balancer/frontend-monorepo](https://github.com/balancer/frontend-monorepo). Commit: `dd7d76a0f9c0ec07c40a9f800165a12ee90b33ce`. Archived at inspection: no.

FxAeon relevance: Trade, Earn, transaction system, CI, performance.

### Inspected evidence

- [packages/lib/modules/transactions/transaction-steps/lib.tsx](https://github.com/balancer/frontend-monorepo/blob/dd7d76a0f9c0ec07c40a9f800165a12ee90b33ce/packages/lib/modules/transactions/transaction-steps/lib.tsx)
- [packages/lib/modules/transactions/transaction-steps/useShouldFreezeQuote.ts](https://github.com/balancer/frontend-monorepo/blob/dd7d76a0f9c0ec07c40a9f800165a12ee90b33ce/packages/lib/modules/transactions/transaction-steps/useShouldFreezeQuote.ts)
- [packages/lib/modules/tokens/approvals/approval-rules.ts](https://github.com/balancer/frontend-monorepo/blob/dd7d76a0f9c0ec07c40a9f800165a12ee90b33ce/packages/lib/modules/tokens/approvals/approval-rules.ts)
- [.github/workflows/checks.yml](https://github.com/balancer/frontend-monorepo/blob/dd7d76a0f9c0ec07c40a9f800165a12ee90b33ce/.github/workflows/checks.yml)

### What the source shows

- Transaction state separates preparing/simulation, waiting for wallet, confirming, completed and errors.
- Quote refetches are frozen during wallet confirmation, chain confirmation, completion and error.
- Approval logic distinguishes native assets, required amount, requested amount and reset-to-zero tokens.
- CI separates lint, types/unit, integration, production smoke and fixed-block Anvil-backed browser tests.

### Adopt in the original implementation

- Use an explicit transaction state machine shared across features.
- Keep the accepted review snapshot stable while signing and confirming; separately enforce freshness before sending.
- Derive the exact approval steps from on-chain allowance and token behavior.
- Use reproducible fork tests for the leveraged-long path when RPC access is available.

### Avoid or qualify

- Do not copy the very broad monorepo or every transaction type.
- The source defaults to maximum approvals; FxAeon's allowance policy must be explicit rather than inherited.
- A frozen quote is not permission to submit an expired or changed transaction.

## 4. curvefi/curve-frontend

Selected repository: [curvefi/curve-frontend](https://github.com/curvefi/curve-frontend). Commit: `641769e455027718a7bc666230b982356308528f`. Archived at inspection: no.

FxAeon relevance: Trade, Borrow, Positions, History, CI, performance.

### Inspected evidence

- [apps/main/src/llamalend/features/borrow/components/CreateLoanInfoList.tsx](https://github.com/curvefi/curve-frontend/blob/641769e455027718a7bc666230b982356308528f/apps/main/src/llamalend/features/borrow/components/CreateLoanInfoList.tsx)
- [apps/main/src/llamalend/widgets/action-card/LoanActionInfoList.tsx](https://github.com/curvefi/curve-frontend/blob/641769e455027718a7bc666230b982356308528f/apps/main/src/llamalend/widgets/action-card/LoanActionInfoList.tsx)
- [apps/main/src/llamalend/features/user-position-history/UserEventsTable.tsx](https://github.com/curvefi/curve-frontend/blob/641769e455027718a7bc666230b982356308528f/apps/main/src/llamalend/features/user-position-history/UserEventsTable.tsx)
- [.github/workflows/ci.yaml](https://github.com/curvefi/curve-frontend/blob/641769e455027718a7bc666230b982356308528f/.github/workflows/ci.yaml)

### What the source shows

- Loan summaries assemble independent queries for collateral, debt, leverage, LTV, gas and risk data.
- Action information supports current and future values rather than replacing existing position data silently.
- History defines explicit empty and error states, sortable data and expanded transaction actions.
- CI separates unit/build/type checks and browser component checks; RPC checks are a distinct, more expensive job.

### Adopt in the original implementation

- Present borrowed versus user-funded amounts and the resulting exposure together.
- Use typed per-field pending/error/value states and gate expensive preview queries to active input.
- Keep no-history and failed-history-load states distinct.
- Separate inexpensive deterministic checks from network/fork checks.

### Avoid or qualify

- Do not copy LLAMMA liquidation ranges or loan-health formulas into f(x).
- Do not expose every advanced loan metric by default.
- Do not inherit abbreviated financial labels without clear product wording.

## 5. Uniswap/interface

Selected repository: [Uniswap/interface](https://github.com/Uniswap/interface). Commit: `c76a14a089f9a25c3a65da8490efdc37bfe3587d`. Archived at inspection: no.

FxAeon relevance: Trade, Move, transaction system, design system, performance.

### Inspected evidence

- [packages/uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewScreen.tsx](https://github.com/Uniswap/interface/blob/c76a14a089f9a25c3a65da8490efdc37bfe3587d/packages/uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewScreen.tsx)
- [packages/uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewFooter/SwapReviewFooter.tsx](https://github.com/Uniswap/interface/blob/c76a14a089f9a25c3a65da8490efdc37bfe3587d/packages/uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewFooter/SwapReviewFooter.tsx)
- [apps/web/src/pages/CreatePosition/CreatePositionTxContext.quoteGuard.test.tsx](https://github.com/Uniswap/interface/blob/c76a14a089f9a25c3a65da8490efdc37bfe3587d/apps/web/src/pages/CreatePosition/CreatePositionTxContext.quoteGuard.test.tsx)

### What the source shows

- Review renders acceptedDerivedSwapInfo and tracks whether a new trade requires acceptance.
- Submit disabling includes new-trade acceptance, invalid transaction context, blocking warnings and submitting state.
- Resetting gas overrides returns to the form to avoid submitting calldata prepared with obsolete gas parameters.
- A quote guard test asserts invalid oversized quote values produce no transaction request.

### Adopt in the original implementation

- Bind the review to the exact accepted intent and prepared call.
- Invalidate acceptance after changes to account, chain, amount, leverage, slippage or material quote data.
- Validate external quote amounts before constructing calldata; reject invalid values.
- Protect against double submission and state changes during wallet handoff.

### Avoid or qualify

- Do not reproduce its cross-platform provider/store hierarchy for a small initial slice.
- Do not treat its swap math or routing as a model for f(x) leverage.
- Do not use render animations to hide incomplete state management.

## 6. RabbyHub/Rabby

Selected repository: [RabbyHub/Rabby](https://github.com/RabbyHub/Rabby). Commit: `c3aed73f4c5f1e7c88c31331b0b0b72c6e8f2f4a`. Archived at inspection: no.

FxAeon relevance: wallet integration, Trade, Borrow, transaction system, History.

### Inspected evidence

- [src/ui/views/Approval/components/TxComponents/BalanceChangeWrapper.tsx](https://github.com/RabbyHub/Rabby/blob/c3aed73f4c5f1e7c88c31331b0b0b72c6e8f2f4a/src/ui/views/Approval/components/TxComponents/BalanceChangeWrapper.tsx)
- [__tests__/ui/approvalRootFailClosed.test.ts](https://github.com/RabbyHub/Rabby/blob/c3aed73f4c5f1e7c88c31331b0b0b72c6e8f2f4a/__tests__/ui/approvalRootFailClosed.test.ts)
- [__tests__/ui/approvalFooterSecurityGate.test.ts](https://github.com/RabbyHub/Rabby/blob/c3aed73f4c5f1e7c88c31331b0b0b72c6e8f2f4a/__tests__/ui/approvalFooterSecurityGate.test.ts)

### What the source shows

- Approval UI handles parsed actions and simulated balance changes separately.
- Tests require an undispatchable approval kind to fail closed rather than crash or execute.
- Security-gate tests preserve pending/error/risk blocks across fee-payment options.

### Adopt in the original implementation

- Show the expected token outflow/inflow and position effect of a prepared transaction.
- Treat missing or failed simulation as its own state; do not render a success check.
- Verify account/chain/intent identity again at wallet handoff and reject stale requests.
- Test action gating independently from cosmetic button labels.

### Avoid or qualify

- Rabby is a wallet extension, not a dapp architecture template.
- Do not imply FxAeon supplies Rabby's full security engine or account protection.
- Do not add unnecessary wallet-provider labels, QR flows or extra categories.

## 7. Synthetixio organization

Selected repository: [Synthetixio/snx-loan-ui](https://github.com/Synthetixio/snx-loan-ui). Commit: `516baf06ba0fb6f1bd99194c1993cf330be02151`. Archived at inspection: yes.

FxAeon relevance: Borrow, Positions, History, performance.

### Inspected evidence

- [src/containers/Loans/getLoan.ts](https://github.com/Synthetixio/snx-loan-ui/blob/516baf06ba0fb6f1bd99194c1993cf330be02151/src/containers/Loans/getLoan.ts)
- [src/section/Positions/LoanHistory.tsx](https://github.com/Synthetixio/snx-loan-ui/blob/516baf06ba0fb6f1bd99194c1993cf330be02151/src/section/Positions/LoanHistory.tsx)

### What the source shows

- Loan reads separate collateral, debt and collateralization parameters and fetch independent contract values concurrently.
- Closed-loan history keeps loan identity, amount/collateral and close time together.
- The history source contains a literal 0.25% interest display.

### Adopt in the original implementation

- Preserve stable position identity through open, modify and close journeys.
- Fetch independent read-only contract values concurrently where consistent state can be maintained.
- Use action history rather than relying only on the current balance.

### Avoid or qualify

- Archived historical reference; not current Synthetix production behavior.
- Do not inherit its literal interest rate, old contract adapters, collateral-ratio math or desktop-heavy table layout.

## 8. makerdao organization

Selected repository: [sky-ecosystem/dai.js](https://github.com/sky-ecosystem/dai.js). Commit: `6e9de6c44d7334d0bbd073a2f26d5751fe834f50`. Archived at inspection: yes.

FxAeon relevance: Borrow, Positions, transaction system.

### Inspected evidence

- [packages/dai/src/eth/TransactionTransitions.js](https://github.com/sky-ecosystem/dai.js/blob/6e9de6c44d7334d0bbd073a2f26d5751fe834f50/packages/dai/src/eth/TransactionTransitions.js)
- [packages/dai-plugin-mcd/src/ManagedCdp.ts](https://github.com/sky-ecosystem/dai.js/blob/6e9de6c44d7334d0bbd073a2f26d5751fe834f50/packages/dai-plugin-mcd/src/ManagedCdp.ts)

### What the source shows

- The requested makerdao/dai.js API returns a move response; the repository is available under sky-ecosystem/dai.js and archived.
- Transaction transitions distinguish initialized, pending, mined and finalized.
- ManagedCdp centralizes collateral amount/value, debt value, collateralization and liquidation-price derivation outside view components.

### Adopt in the original implementation

- Keep financial position calculations in a pure, testable domain boundary.
- Separate transaction broadcast/receipt/finality status.
- Represent borrowing and collateral changes as explicit commands.

### Avoid or qualify

- Do not copy archived Dai.js dependencies or cache behavior.
- Do not transplant Maker collateralization, liquidation or stability-fee math into f(x).
- Do not infer current Sky UI from this SDK.

## 9. lidofinance organization

Selected repository: [lidofinance/ethereum-staking-widget](https://github.com/lidofinance/ethereum-staking-widget). Commit: `35aaa541e98f8a9336e1acfa8463a80f8b9f8382`. Archived at inspection: no.

FxAeon relevance: Earn, Move, transaction system, CI.

### Inspected evidence

- [features/stake/stake-form/use-stake.ts](https://github.com/lidofinance/ethereum-staking-widget/blob/35aaa541e98f8a9336e1acfa8463a80f8b9f8382/features/stake/stake-form/use-stake.ts)
- [features/withdrawals/claim/form/requests-list/request-item-status.tsx](https://github.com/lidofinance/ethereum-staking-widget/blob/35aaa541e98f8a9336e1acfa8463a80f8b9f8382/features/withdrawals/claim/form/requests-list/request-item-status.tsx)
- [.github/workflows/checks.yml](https://github.com/lidofinance/ethereum-staking-widget/blob/35aaa541e98f8a9336e1acfa8463a80f8b9f8382/.github/workflows/checks.yml)

### What the source shows

- Stake execution separates preparation, calls, signature, receipt, success and failure callbacks.
- It handles a completed unwrap followed by a failed stake explicitly, refreshing balances and preserving the changed asset state.
- Withdrawal items distinguish pending from ready and use finalization timing only when available.
- Lint, type and unit checks are distinct CI jobs.

### Adopt in the original implementation

- Preserve completed steps when a later step fails; retry only the incomplete step.
- Keep requested withdrawal, pending withdrawal and claimable payout as different product states.
- Retain transaction hashes and refresh relevant balances after confirmed partial progress.

### Avoid or qualify

- Do not promise instant fxSAVE withdrawal or copy stETH queue guarantees.
- Do not auto-retry wallet writes.
- Do not adopt holiday effects or unrelated feature flags in a transaction flow.

## 10. jup-ag organization

Selected repository: [jup-ag/plugin](https://github.com/jup-ag/plugin). Commit: `0bf757d986cdd1937afc49bfabba28c56d52ba47`. Archived at inspection: no.

FxAeon relevance: Trade, Move, quote system, performance.

### Inspected evidence

- [src/queries/useQuoteQuery.ts](https://github.com/jup-ag/plugin/blob/0bf757d986cdd1937afc49bfabba28c56d52ba47/src/queries/useQuoteQuery.ts)
- [src/entity/FormattedUltraQuoteResponse.ts](https://github.com/jup-ag/plugin/blob/0bf757d986cdd1937afc49bfabba28c56d52ba47/src/entity/FormattedUltraQuoteResponse.ts)

### What the source shows

- Searching terminal resolves to the plugin repository.
- Quote queries key all initial parameters, pass AbortSignal to the request, disable empty input, and conditionally poll.
- External quote fields are runtime-validated and raw amounts are converted to bigint.

### Adopt in the original implementation

- Use a complete quote key that includes all intent-changing parameters.
- Abort superseded requests and discard responses that no longer match the input.
- Validate provider responses at the boundary and retain integer token units.

### Avoid or qualify

- Do not import Solana transaction models or Ultra routing assumptions.
- Do not adopt its polling interval or retry policy without FxAeon data-source measurements.
- A cancelled old request alone is insufficient; late responses still need identity checks.

## 11. DefiLlama organization

Selected repository: [DefiLlama/yield-server](https://github.com/DefiLlama/yield-server). Commit: `40307814aebd5f567963a57698e9fbf777389219`. Archived at inspection: no.

FxAeon relevance: Earn, Borrow, analytics, data system.

### Inspected evidence

- [src/types/Pool.d.ts](https://github.com/DefiLlama/yield-server/blob/40307814aebd5f567963a57698e9fbf777389219/src/types/Pool.d.ts)
- [src/adaptors/fx-protocol/index.js](https://github.com/DefiLlama/yield-server/blob/40307814aebd5f567963a57698e9fbf777389219/src/adaptors/fx-protocol/index.js)

### What the source shows

- Pool data separates base and reward yield, underlying/reward tokens, supply, borrow, price-per-share and LTV fields.
- An f(x) adapter reads Aladdin TVL/APY endpoints, enriches underlying assets and Merkl rewards, and filters finite numeric output.

### Adopt in the original implementation

- Give APY figures provenance, timestamp, composition and explicit unavailable states.
- Treat pool identity, token identity and chain identity as separate fields.
- Use external yield aggregators for comparison/context, with protocol sources governing executable quotes.

### Avoid or qualify

- Do not treat aggregator APY as guaranteed or as transaction simulation data.
- Do not combine differently defined yield figures without an explicit methodology.
- Do not import the entire analytics pipeline into the long slice.

## 12. ourzora organization

Selected repository: [ourzora/zora-protocol](https://github.com/ourzora/zora-protocol). Commit: `32c2931a444b4405b107a49016dff0059b05b06f`. Archived at inspection: no.

FxAeon relevance: transaction system, Trade, CI.

### Inspected evidence

- [packages/coins-sdk/src/actions/tradeCoin.ts](https://github.com/ourzora/zora-protocol/blob/32c2931a444b4405b107a49016dff0059b05b06f/packages/coins-sdk/src/actions/tradeCoin.ts)
- [.github/workflows/js.yml](https://github.com/ourzora/zora-protocol/blob/32c2931a444b4405b107a49016dff0059b05b06f/.github/workflows/js.yml)

### What the source shows

- The SDK distinguishes native ETH from ERC20 trade currency and keeps amountIn as bigint.
- Permit resolution collects approval calls separately so execution may be sequential for an EOA or batched for a smart wallet.
- JS CI builds and tests packages with pinned workflow actions.

### Adopt in the original implementation

- Separate transaction planning from wallet-specific execution.
- Use discriminated asset types rather than address heuristics scattered through UI.
- Keep EOA and smart-account capability handling explicit and opt-in.

### Avoid or qualify

- Do not infer Zora's live visual design from a protocol SDK.
- Do not reuse its Base-specific addresses, Permit2 signing sequence or maximum approval policy.
- Smart-account batching should not be required for the first leveraged-long slice.

## 13. decentraland organization

Selected repository: [decentraland/ui2](https://github.com/decentraland/ui2). Commit: `f9d85aa368a482f1ffe281c4dced9814625cde51`. Archived at inspection: no.

FxAeon relevance: design system, UI states, CI.

### Inspected evidence

- [src/theme/index.ts](https://github.com/decentraland/ui2/blob/f9d85aa368a482f1ffe281c4dced9814625cde51/src/theme/index.ts)
- [src/components/Button/Button.stories.tsx](https://github.com/decentraland/ui2/blob/f9d85aa368a482f1ffe281c4dced9814625cde51/src/components/Button/Button.stories.tsx)

### What the source shows

- Theme code centralizes palettes, typography, shape, breakpoints and component variants.
- Button stories cover variant, semantic color, size, disabled and loading controls.

### Adopt in the original implementation

- Define a compact FxAeon token and component-state system before page expansion.
- Create inspectable states for primary action, input, dialog, tabs, table/card and notices.
- Keep loading/disabled behavior consistent across WebApp and MiniApp presentation.

### Avoid or qualify

- Do not reuse its brand fonts, palettes or desktop-biased breakpoints.
- Do not import its metaverse/media components.
- A Storybook inventory is not evidence of accessibility or mobile usability; verify those directly.

## 14. ProjectOpenSea organization

Selected repository: [ProjectOpenSea/seaport-js](https://github.com/ProjectOpenSea/seaport-js). Commit: `b0cda76744adac17efb32bc6defdc9b157a834cd`. Archived at inspection: no.

FxAeon relevance: transaction system, Trade, Earn, CI.

### Inspected evidence

- [src/utils/usecase.ts](https://github.com/ProjectOpenSea/seaport-js/blob/b0cda76744adac17efb32bc6defdc9b157a834cd/src/utils/usecase.ts)
- [test/execute-approvals.spec.ts](https://github.com/ProjectOpenSea/seaport-js/blob/b0cda76744adac17efb32bc6defdc9b157a834cd/test/execute-approvals.spec.ts)

### What the source shows

- Use cases expose ordered approval actions and a separate final action.
- Approval execution waits for receipts and can complete without triggering the final action.
- Transaction helpers expose build, static call, estimate gas and transact; estimation uses the actual built calldata when it includes an appended tag.
- Tests cover executing approvals without performing the final action.

### Adopt in the original implementation

- Prepare an explicit ordered action plan rather than burying wallet calls in UI handlers.
- Show Approve token only when required, then Open long after verified allowance.
- Simulate and estimate the exact call that will be sent.
- Keep approval success and trade success distinct in history and retry behavior.

### Avoid or qualify

- Do not copy NFT approval/order semantics or collection-wide allowance rules.
- Do not call execute-all style helpers automatically when the product requires separate user approval.
- Do not claim a finished position because an approval receipt succeeded.


