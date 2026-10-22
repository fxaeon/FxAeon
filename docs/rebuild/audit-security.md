# Transaction, SDK and wallet behavior audit

Baseline: `b69d9ce1be59f982fca3ac43a8b037f7037269d4` on `rebuild/fxaeon-foundation-20261022`. Audit date: 22 October 2026. Scope: the original repository and its installed patched dependencies; no application code was changed by this audit.

## Outcome and evidence standard

The existing application has extensive safety behavior that must survive a rebuild: a locked fifteen-method SDK surface, exact reviewed transaction binding, identity-scoped wallet ownership, canonical receipt/recovery checks, bigint amount handling, bounded reads and independently checked economic exposure. The behavior ledger is `docs/rebuild/security-behaviors.json`. It is a preservation and gap map, not a security certification.

**Execution evidence is separate from source coverage.** The integration owner reported the original `pnpm verify` run on Node 22.23.4 / pnpm 11.19.0 as **1,611 application unit/chaos passes, zero failures and four fork skips**. The aggregate command exited **1** because the dependency registry audit timed out; its separate bounded registry request reported timeout code 23. Build and browser phases were not reached. This audit did not run duplicate tests, a production build, a protected fork campaign or a physical wallet test. Those execution details belong in the integration owner's baseline log; no missing phase is counted as passed here.

Ledger status has a precise meaning:

- **test-backed**: an exact named regression, parameterized source family, assertion, or executable gate covers the stated behavior. It does not mean that this audit executed it or that its mocks prove production conditions.
- **documented**: the capability matrix or a repository section states the contract, or installed-source/gate inspection establishes the local patch boundary without a dedicated named behavioral case. Any broader clauses than a cited scope test remain documented.
- **gap**: an explicit limitation, contradictory documentation, missing external validation, or a clearly labeled audit inference. A gap is not automatically an observed exploit or an authorization to expand product scope.

Curated IDs (`SEC-ARCH`, `METHOD`, `PATCH`, `REVIEW`, `POLICY`, `RUN`, `LOCK`, `AMOUNT`, `ECON`, `FEE`, `RPC`, `READ`, `THRESHOLD`, `RECOVERY`, `RECEIPT`, `MINT`, `BRIDGE`, `WALLET`, `HANDOFF`, `TELEGRAM`, `SEND`, `HISTORY`, `FORK`, `GAP`) make key contracts reviewable. `SEC-CASE-*` IDs are derived from the source path and exact literal title, so moving a test within its file does not change its ID. Template titles remain literal and cover all variants in their surrounding loops; declaration counts are not expanded runtime case counts. Four deliberately vulnerable `FAIL-BEFORE` controls are excluded from required product behavior. Their safe successor cases remain included.

## Locked capability surface

The complete input/output, order and refresh clauses are copied into `SEC-METHOD-01` through `SEC-METHOD-15` from **docs/sdk-scope.md → Capability matrix**. `scope-contract.test.ts` proves the exact method list and lock agreement, not every operational clause of each method.

| ID | Method | Financial boundary |
| --- | --- | --- |
| SEC-METHOD-01 | `getPositions` | Read wallet ETH/BTC long/short accounting; canonical ownership and bounded fallback still apply. |
| SEC-METHOD-02 | `increasePosition` | Exact open/add intent; ordered SDK approvals/actions; post-receipt readback. |
| SEC-METHOD-03 | `reducePosition` | Exact side/output/amount/full-close intent and minima; stop after any failed prerequisite. |
| SEC-METHOD-04 | `adjustPositionLeverage` | Existing-ID target and exact route; independent changed-exposure check. |
| SEC-METHOD-05 | `depositAndMint` | Exact deposit/mint, long pool and existing/new ID; FxMintRouter fee schedule. |
| SEC-METHOD-06 | `repayAndWithdraw` | Fee-adjusted decoded repayment approval; exact output token/withdrawal binding. |
| SEC-METHOD-07 | `getBridgeQuote` | Informational source-chain quote; changes require new terms. |
| SEC-METHOD-08 | `buildBridgeTx` | One source action and optional exact Ethereum approval; separate delivery proof. |
| SEC-METHOD-09 | `getFxSaveBalance` | fxSAVE shares and optional underlying fxSP assets, never assumed dollar parity. |
| SEC-METHOD-10 | `getFxSaveConfig` | Supply/assets/cooldown/fees/threshold from Ethereum. |
| SEC-METHOD-11 | `getFxSaveRedeemStatus` | Pending base-pool share units and canonical cooldown. |
| SEC-METHOD-12 | `getFxSaveClaimable` | Fresh matching-wallet cooldown/dual-token preview before enabling claim. |
| SEC-METHOD-13 | `getRedeemTx` | Bound receiver, completed canonical cooldown, explicit approval and readback. |
| SEC-METHOD-14 | `depositFxSave` | Supported USDC/fxUSD/fxSP, exact approval and SDK fixed stable-deposit floor. |
| SEC-METHOD-15 | `withdrawFxSave` | Direct fxSP, queued stable and instant stable routes have different semantics. |

Application-owned read-only position/brake enrichment and standard native/ERC20 wallet Send are distinct existing boundaries. They do not permit a sixteenth protocol planner or delegated signer. Default protocol financial state stays on Ethereum; Base supports the reviewed Move and wallet-asset paths. The advanced OFT configuration already has separate checksum, contract, token, peer and route-policy tests; preserving those checks does not authorize arbitrary bridge actions.

## Reviewed patch preservation map

The installed `@aladdindao/fx-sdk@1.0.5` ESM/CJS source and declaration additions were inspected against `patches/@aladdindao__fx-sdk@1.0.5.patch`. The baseline installed SHA-256 values observed were:

| Installed file under `apps/mini-app/node_modules/@aladdindao/fx-sdk/dist/` | SHA-256 |
| --- | --- |
| `index.js` | `f3a56ad062b35fa7274517e6cf7f57a1153f8c7cd5b9c71d7c24025b1991f08b` |
| `index.cjs` | `b4db0d546ceca0bd288368de43c3810c8fda168a423fe5c20222220a59593730` |
| `index.d.ts` | `3f5e641fc68b65354d4ce743f56cd736abd83587c689cc61cb3e423c575f6862` |

These hashes identify inspected local artifacts, not an upstream release or a claim that dependencies are uncompromised. No external PR status was rechecked during this source audit.

| Patch IDs | Preserved correction | Exact primary regression/gate |
| --- | --- | --- |
| 001 | Correct short tuple mapping and no missing-debt zero mask | `sdk-pool-read-concurrency.test.ts`; scope gate |
| 002 | Remove three reviewed production diagnostics | `scripts/verify_fx_scope.mjs`; SDK patch |
| 003–004 | Exact uint60 packing; input bounds; no Decimal global change | `sdk-debt-ratio-packing.test.ts` |
| 005, 021 | Chain-verified shared RPC and bridge-source transport; declaration config only | `sdk-rpc-fallback.test.ts`, `rpc-chain-proof.test.ts`, scope lock |
| 006–007 | 50-call chunks, 500 ms spacing including separate calls, no idle tail, ordered failure placeholders | `sdk-multicall-latency.test.ts` |
| 008–009 | Concurrent views, original failure priority, observed sibling errors; sequential converter contexts | `sdk-pool-read-concurrency.test.ts` |
| 010 | Preserve already-read fee ratios with correct pool/router binding and no extra RPC | `protocol-fee-review.test.ts` |
| 011–015 | Dust rejection; validated complete monotone/bracketed search; upper endpoint, one-wei progress, sufficient queried return, bounded exhaustion and WBTC fallback | `sdk-borrow-search.test.ts` |
| 016 | Accounting snapshot plus independent changed-exposure guard, including wrong debt-free adds | `sdk-position-economics.test.ts`, `position-economics.test.ts` |
| 017 | BTC leverage-down metadata scaling only | `position-economics.test.ts`; real SDK planner suite |
| 018–020 | Accepted fxSAVE output/fee metadata; optional preview reads; true share units; no calldata changes | `accepted-save-quote.test.ts` |
| 022 | Privy gas-units-to-fee-wei display/shortfall correction; unavailable missing inputs | `privy-fee-display.test.ts`; installed Privy patch |
| 023 | query-string CJS decoder unwrap compatible with overridden ESM dependency | `scripts/verify_fx_scope.mjs` actual Privy-to-WalletConnect dependency-tree parser checks |
| 024, 027–030 | braces parse/compile/expand/stringify depth cap, shared MAX_DEPTH 100, non-bypassable option, supplied AST defense | `scripts/audit_dependencies.mjs` five source hashes and attack/boundary checks |
| 025–026 | Exact braces 3.0.3 one-advisory exception, four dependency paths, other high/critical and registry errors block, expiry 3 November 2026 | `scripts/audit_dependencies.test.mjs`, `scripts/audit_dependencies.mjs` |

The fxSAVE preview patch **adds optional read calls**; the protocol-fee metadata patch does not. Do not merge those claims. Privy's corrected modal execution fee still does not include Base L1/operator components; app review accounts for them independently. Hono's exact 4.13.7 pin is documented as a separate dependency mitigation, not one of these patch files.

## Financial and signing requirements that must survive

### Accepted terms, policy and simulation

Keep one explicit review bound to the selected session and every signing-relevant input. Accepted terms live for up to **30 seconds**; quote/fee preparation shares one **45-second** wall-clock budget. An exact-input warm plan may survive a newer block only within its original **30-second** expiry and all current limits/wallet/input guards. Expired/changed intent requires a new acceptance; no confirm-time route substitution is allowed (`SEC-REVIEW-001`–`006`).

Policy is operation-specific, not merely a broad contract allowlist. Bind sender, chain, selector, pool, ID, token, raw input/output, close intent, converter path, minima, native value and full reviewed action. Reject arbitrary protocol tokens before the SDK. Approvals bind exact token/spender/amount; repay approval uses the decoded fee-adjusted action amount. Stable fxSAVE identity conversion has a narrow legitimate zero-converter-floor exception with a positive share floor; a blanket nonzero-floor rule would break supported behavior (`SEC-POLICY-001`–`011`).

Simulate the entire ordered approval/action route before prompting, including allowance-dependent actions. Immediately before each wallet prompt, check authority, chain, pending nonce, policy, funding and simulation. A missing simulation result is a failure. Every step requires visible wallet approval and the predecessor's canonical receipt. Preserve a completed approval when its action is rejected. A UI callback exception cannot break journaling. An unreadable balance remains unknown and does not by itself become a fabricated funding failure; a proven shortfall blocks signing (`SEC-RUN-001`–`015`).

### Economics, exact amounts and unknown state

Use integer units for inputs, percentages, approval values, fee amounts and receipt accounting. Reject scientific notation, excess token precision and ambiguous separators; round spendable presentation down and costs/minima up. Positive dust is labeled, not rounded to zero. fxSAVE shares, fxSP assets and queued redemption units remain distinct. Verified zero can be reported without a price, while positive unknown assets cannot become zero or one-dollar parity (`SEC-AMOUNT-001`–`007`).

The economics guard checks changed borrowing/repayment and positive resulting equity using bound pool execution-price samples, wrapping rates and exact fees. It does not trust an SDK target-leverage echo. Adds apply requested leverage to new capital. Solver/slippage compatibility applies to **changed exposure**, with separate native-unit rounding capped at ten percent of intended change; a huge existing position cannot conceal a bad tiny addition. Zero-debt 1x must actually remain zero debt. The known debt-free-add sentinel bug is rejected rather than reinterpreted (`SEC-ECON-001`–`006`).

Protocol fee rates use the actual action router/pool schedule and raw `1e9` ratios. A rate is not a fee amount: only independently bound chargeable amounts may be labeled exact, such as mint-only Borrow. Gas, native action value, DEX conversion and retained slippage stay separate. Base network totals are complete only when execution, L1 and operator components are present; bridge native fees are counted once (`SEC-FEE-001`–`008`).

### Canonical recovery, ownership and bridge evidence

A pre-prompt persisted intent is not proof of submission. A hash with missing/malformed receipt, wrong chain, RPC outage or reorg remains pending/unverified. Verify mined transaction identity and canonical receipt block/status. The default one canonical confirmation is not an irreversible-finality promise; configured deeper confirmation checks remain available. No uncertainty permits auto-resubmission (`SEC-RECOVERY-*`, `SEC-RUN-009`–`014`).

Do not age unresolved records out. Keep financial signing serialized per wallet, including cross-chain external flows; fail a lost lease. New-position hints contain identity only, require unambiguous reviewed mint/delivery events, and recheck current owner before and after delayed SDK hydration. A locally saved NFT ID cannot create financial balances. The bounded canonical fallback reads ownership counts, checks every index ID, scans at most 4,096 IDs with a 16-ID recent probe and retains only revalidated candidate IDs. Partial/outage state cannot become a complete empty portfolio (`SEC-LOCK-*`, `SEC-MINT-*`, `SEC-READ-*`).

Bridge source confirmation and remote delivery are separate. Exact route authority includes OFT fields, EIDs, recipient, amounts, options/compose/OFT command, native/LZ fees and refund address. Source proof requires one matching OFTSent; dust-adjusted actual debit and remote receive stay distinct from reviewed input. Remote proof requires the same GUID, exact destination OFT/source EID/receiver and event-derived receive amount. Removed logs, ambiguous events or cached delivery without revalidated source cannot count as success. Destination scanning is bounded/resumable (`SEC-BRIDGE-001`–`010`).

### Wallet ownership and dispatch

Browser signing belongs to one selected raw provider object. Self-attested rdns/names are display metadata, not authenticity; conflicting provider identities and duplicate objects with one claimed brand fail closed. Exact silent restoration may select a remembered second approved account but must not prompt or choose an alternative account. Cancellation, replacement, account/chain changes and foreground reconcile remain fenced by fresh reads and event guards. Manual disconnect cannot fall back to an older connector or auto-restore (`SEC-WALLET-001`–`016`).

Privy candidate availability is not acceptance. Preserve the accepted semantic wallet/user identity in document memory, with no stored provider object or credential authority. Hydration can temporarily withhold readiness; ready disappearance/logout/user change retires authority and requires explicit selection. One-use dispatch tickets must survive neither stale preflight nor address-identical wallet substitution. An intended embedded switch may adopt its fresh SDK provider within the accepted identity, while external replacement stays forbidden (`SEC-WALLET-017`–`024`).

For both adapters, retirement before dispatch prevents signing; retirement after an issued request must return its original outcome to the original runner without replay or replacing the new session. Wallet browser navigation is a handoff, not an approved connection. Preserve sanitized trusted-origin routes while removing Telegram/OAuth credentials. Telegram launch detection selects UX only; the authentication service verifies signed launch data. Start parameters can only open fixed same-origin screens (`SEC-HANDOFF-*`, `SEC-TELEGRAM-*`).

## Documentation conflicts and explicit limitations

| Finding | Current evidence and required treatment |
| --- | --- |
| Older handoff prose fixes fxaeon.com and strips all query/hash; older table says Base/OKX/Zerion download-only | Current `wallet-browser-links` and `wallet-connection-routes` cases preserve sanitized captured same-origin route state and include browser commands. Preserve trust/credential boundaries; rewrite stale prose deliberately. |
| Long-review performance note says 10-second warm TTL and current-block restrictions | Current `route-prefetch` code/tests use 30 seconds and permit guarded newer-block reuse without expiry extension. |
| Runtime-hardening says no post-action review thresholds | Current `liquidation-quote` tests cover **new Trade and new Borrow** from live bound pool data. Existing-position modifications need separate evidence; do not claim universal support. |
| SDK BTC reduce collateral quote has extra scaling | Leverage-down metadata is fixed; reduce remains a known omission. Do not alter signed amounts to make an invalid display quote look correct. |
| Privy-only wording in SECURITY.md is broader than current architecture | `docs/security.md`, wallet ownership docs and browser boundary tests explicitly support selected injected ordinary-web wallets and Telegram Privy. |
| Physical wallet / real Telegram authentication / live cross-chain delivery | Not established by mock browsers or the Ethereum-only fork. Preserve these as external validation gaps. |
| Historic position activity completeness | Current-owner index attribution can omit transferred-out positions; old ETH-short lacks real-owner association. Do not promise a complete historical wallet ledger. |
| Telegram admission cap | Proposal only; static UI counters are not trusted enforcement or a free-billing guarantee. |
| Dependency mitigation deadline and registry timeout | The braces exception expires at `2026-11-03T00:00:00Z`; other audit findings and registry errors still block. Current audit timeout is not a pass. |

These findings are recorded under `SEC-GAP-*`; inferred requirements are explicitly labeled in their notes. The preserved safety floor is compatible with redesigning layout and interaction, but there is no source basis for a zero-mistake or audited-software claim.

## Protected fork scope and honest stopping criteria

`anvil.integration.test.ts` declares local chain/snapshot and randomized runner smoke plus a real official-SDK four-position protocol proof. The protocol proof asserts coexisting ETH/BTC long/short ownership/accounting, exact debt-ratio packing, an existing-ID Borrow change and real partial reductions. `earn.anvil.test.ts` executes deposit, instant/direct/queued redemption, canonical cooldown, claim and redeposit with accounting conservation. They are opt-in protected tests, and the baseline run skipped their four cases.

`e2e/fork/positions.browser.ts` proves browser-reviewed bytes against actual local sends, sequential receipt-gated prompts, canonical discovery with the index withheld, ownership transfer isolation, SDK/canonical parity, existing Borrow changes and all four real full closes. Its real Earn deposit supplies shares for **read-only instant/queued withdrawal reviews**; those reviews are not browser execution proof for redemption/claim. The independent Earn unit fork covers that execution when explicitly run. `reviewedTransactions.ts` reads full exact-data dialogs; truncated UI previews are not adequate transaction binding evidence.

Preservation is complete only when the integrator maps a replacement behavior to the appropriate existing contract, resolves documented conflicts, passes applicable deterministic checks, and supplies missing browser/fork/device evidence where required. Bounded repairs should fix a specific remaining failure and rerun the affected gate; review votes and additional agent counts do not close an unexecuted gate. No deployment or funds-handling safety approval follows from this audit alone.

## Reviewed source coverage

Documents read: `SECURITY.md`; `docs/security.md`; `docs/sdk-scope.md`; `docs/architecture.md`; `docs/privy-wallet-ownership.md`; `docs/mobile-wallet-browser-handoff.md`; `docs/telegram-wallet-rollout.md`; `docs/testing.md`; `docs/runtime-hardening-2026-10.md`; performance notes `long-review-preparation.md`, `rpc-chain-proof.md`, `rpc-position-counts.md`, `sdk-pool-read-waterfall.md`; and `fx-scope.lock.json`.

Patch/source inspection included all four repository patch files, the installed SDK ESM/CJS/declaration boundaries, transaction normalization/policy/runner/economics, receipt/recovery/bridge authority, and wallet owner/dispatch boundaries. The coverage below is a **test-source audit**: named contracts and assertions were surveyed, with detailed reading of critical paths and fork semantics. It is not a claim that every line of every supporting harness received an independent full security review. Presentation-only overlap is also recorded by the product audit; these files are not mutually exclusive ownership domains.

Additional non-test gate/proof source inspected: `scripts/verify_fx_scope.mjs`, `scripts/audit_dependencies.mjs`, `apps/mini-app/e2e/fork/positions.browser.ts`, and `apps/mini-app/e2e/fork/reviewedTransactions.ts`. The browser proof is a procedural script and therefore has no ordinary literal `test(...)` inventory count. The registry gate's six data-table scenarios are counted explicitly.

Ledger totals: **1,271 behavior entries**, including **201 curated contracts/gaps** and **1,070 named regression families/scenarios**. The table below lists **115 test source files**; template families count once, not once per parameter combination. Four negative controls are excluded.

| Test source | Named families/scenarios | Lines |
| --- | ---: | ---: |
| `apps/mini-app/e2e/specs/csp-policy.spec.ts` | 1 | 91 |
| `apps/mini-app/e2e/specs/privy-send-adapter.spec.ts` | 20 | 523 |
| `apps/mini-app/e2e/specs/privy-wallet-bridge.spec.ts` | 23 | 550 |
| `apps/mini-app/e2e/specs/review-wallet-entry.spec.ts` | 4 | 190 |
| `apps/mini-app/e2e/specs/wallet-provider-boundary.spec.ts` | 18 | 526 |
| `apps/mini-app/e2e/specs/wallet-session.spec.ts` | 9 | 251 |
| `apps/mini-app/e2e/specs/wallet-wagmi-boundary.spec.ts` | 7 | 193 |
| `apps/mini-app/test/accepted-save-quote.test.ts` | 5 | 134 |
| `apps/mini-app/test/action-binding.test.ts` | 9 | 615 |
| `apps/mini-app/test/active-wallet-address.test.ts` | 1 | 12 |
| `apps/mini-app/test/activity-calls.test.ts` | 3 | 76 |
| `apps/mini-app/test/activity-classification.test.ts` | 22 | 502 |
| `apps/mini-app/test/activity-receipt.test.ts` | 3 | 28 |
| `apps/mini-app/test/advanced-bridge.test.ts` | 11 | 232 |
| `apps/mini-app/test/amount.test.ts` | 8 | 110 |
| `apps/mini-app/test/anvil.integration.test.ts` | 3 | 842 |
| `apps/mini-app/test/balances.test.ts` | 3 | 48 |
| `apps/mini-app/test/borrow-limits.test.ts` | 7 | 81 |
| `apps/mini-app/test/borrow-position-state.test.ts` | 2 | 56 |
| `apps/mini-app/test/bridge-delivery.test.ts` | 8 | 238 |
| `apps/mini-app/test/bridge-destination-label.test.ts` | 4 | 93 |
| `apps/mini-app/test/bridge-preview.test.ts` | 2 | 80 |
| `apps/mini-app/test/bridge-proof-journal.test.ts` | 8 | 196 |
| `apps/mini-app/test/bridge-result-card.test.ts` | 9 | 130 |
| `apps/mini-app/test/bridge-tracker-render.test.ts` | 4 | 43 |
| `apps/mini-app/test/browser-chain-switch.test.ts` | 12 | 196 |
| `apps/mini-app/test/browser-wagmi-reconnect-race.test.ts` | 2 | 36 |
| `apps/mini-app/test/browser-wagmi-session-owner.test.ts` | 54 | 362 |
| `apps/mini-app/test/chaos.test.ts` | 2 | 246 |
| `apps/mini-app/test/coalesced-read.test.ts` | 2 | 38 |
| `apps/mini-app/test/confirmed-position-storage.test.ts` | 9 | 146 |
| `apps/mini-app/test/confirmed-positions.test.ts` | 18 | 469 |
| `apps/mini-app/test/decimal-input.test.ts` | 6 | 63 |
| `apps/mini-app/test/direct-position-discovery.test.ts` | 24 | 448 |
| `apps/mini-app/test/earn-state.test.ts` | 4 | 51 |
| `apps/mini-app/test/earn.anvil.test.ts` | 1 | 596 |
| `apps/mini-app/test/etherscan-gas.test.ts` | 16 | 364 |
| `apps/mini-app/test/external-wallet-connection.test.ts` | 26 | 241 |
| `apps/mini-app/test/fxsave-units.test.ts` | 8 | 67 |
| `apps/mini-app/test/gas-cost.test.ts` | 28 | 617 |
| `apps/mini-app/test/gas-fee-policy.test.ts` | 4 | 91 |
| `apps/mini-app/test/gas-fee-source-latency.test.ts` | 13 | 208 |
| `apps/mini-app/test/gas-limit.test.ts` | 1 | 11 |
| `apps/mini-app/test/history-drafts.test.ts` | 6 | 139 |
| `apps/mini-app/test/journal-lock.test.ts` | 12 | 400 |
| `apps/mini-app/test/leverage.test.ts` | 7 | 141 |
| `apps/mini-app/test/liquidation-quote.test.ts` | 9 | 192 |
| `apps/mini-app/test/missing-value.test.ts` | 2 | 61 |
| `apps/mini-app/test/move-balances.test.ts` | 4 | 86 |
| `apps/mini-app/test/native-max.test.ts` | 11 | 152 |
| `apps/mini-app/test/plan-security.test.ts` | 11 | 408 |
| `apps/mini-app/test/position-brake-reader.test.ts` | 6 | 202 |
| `apps/mini-app/test/position-brake.test.ts` | 12 | 220 |
| `apps/mini-app/test/position-economics.test.ts` | 16 | 203 |
| `apps/mini-app/test/position-reader.test.ts` | 11 | 228 |
| `apps/mini-app/test/privy-connection-intent.test.ts` | 12 | 101 |
| `apps/mini-app/test/privy-dispatch-authority.test.ts` | 19 | 248 |
| `apps/mini-app/test/privy-fee-display.test.ts` | 3 | 42 |
| `apps/mini-app/test/privy-session-intent.test.ts` | 2 | 19 |
| `apps/mini-app/test/privy-wallet-preference.test.ts` | 16 | 182 |
| `apps/mini-app/test/protocol-fee-review.test.ts` | 7 | 139 |
| `apps/mini-app/test/protocol-position-history.test.ts` | 12 | 446 |
| `apps/mini-app/test/protocol-token-boundary.test.ts` | 3 | 98 |
| `apps/mini-app/test/realtime-chain.test.ts` | 5 | 108 |
| `apps/mini-app/test/receipt-presentation.test.ts` | 9 | 120 |
| `apps/mini-app/test/recovery.test.ts` | 19 | 350 |
| `apps/mini-app/test/reduction.test.ts` | 7 | 119 |
| `apps/mini-app/test/review-preparation-scope.test.ts` | 4 | 42 |
| `apps/mini-app/test/review-preparation.test.ts` | 2 | 80 |
| `apps/mini-app/test/route-prefetch.test.ts` | 14 | 197 |
| `apps/mini-app/test/rpc-chain-proof.test.ts` | 13 | 221 |
| `apps/mini-app/test/rpc-config.test.ts` | 11 | 276 |
| `apps/mini-app/test/rpc-position-counts.test.ts` | 11 | 264 |
| `apps/mini-app/test/runner.test.ts` | 31 | 1173 |
| `apps/mini-app/test/runtime-boundaries.test.ts` | 11 | 280 |
| `apps/mini-app/test/scope-contract.test.ts` | 2 | 43 |
| `apps/mini-app/test/sdk-borrow-search.test.ts` | 16 | 294 |
| `apps/mini-app/test/sdk-debt-ratio-packing.test.ts` | 4 | 101 |
| `apps/mini-app/test/sdk-fxsave-deposit-limits.test.ts` | 1 | 102 |
| `apps/mini-app/test/sdk-fxsave-route-settings.test.ts` | 1 | 123 |
| `apps/mini-app/test/sdk-multicall-latency.test.ts` | 5 | 109 |
| `apps/mini-app/test/sdk-pool-read-concurrency.test.ts` | 7 | 256 |
| `apps/mini-app/test/sdk-position-economics.test.ts` | 8 | 323 |
| `apps/mini-app/test/sdk-rpc-fallback.test.ts` | 2 | 115 |
| `apps/mini-app/test/settings.test.ts` | 8 | 95 |
| `apps/mini-app/test/task-state.test.ts` | 4 | 57 |
| `apps/mini-app/test/telegram-reconnect.test.ts` | 3 | 51 |
| `apps/mini-app/test/telegram-start-param.test.ts` | 10 | 184 |
| `apps/mini-app/test/telegram-wallet-host.test.ts` | 7 | 151 |
| `apps/mini-app/test/telegram.test.ts` | 10 | 169 |
| `apps/mini-app/test/transaction-progress.test.ts` | 8 | 97 |
| `apps/mini-app/test/transaction-state.test.ts` | 3 | 35 |
| `apps/mini-app/test/user-errors.test.ts` | 4 | 31 |
| `apps/mini-app/test/wagmi-wallet-queries.test.ts` | 18 | 494 |
| `apps/mini-app/test/wallet-activity.test.ts` | 11 | 121 |
| `apps/mini-app/test/wallet-assets.test.ts` | 18 | 257 |
| `apps/mini-app/test/wallet-balance-cache.test.ts` | 3 | 33 |
| `apps/mini-app/test/wallet-browser-links.test.ts` | 6 | 83 |
| `apps/mini-app/test/wallet-catalog.test.ts` | 26 | 313 |
| `apps/mini-app/test/wallet-connect-watch.test.ts` | 11 | 136 |
| `apps/mini-app/test/wallet-connection-routes.test.ts` | 27 | 363 |
| `apps/mini-app/test/wallet-data-refresh.test.ts` | 16 | 263 |
| `apps/mini-app/test/wallet-demand.test.ts` | 9 | 117 |
| `apps/mini-app/test/wallet-legacy-discovery.test.ts` | 5 | 74 |
| `apps/mini-app/test/wallet-picker-render.test.ts` | 8 | 130 |
| `apps/mini-app/test/wallet-provider-snapshot.test.ts` | 10 | 154 |
| `apps/mini-app/test/wallet-provider.test.ts` | 14 | 175 |
| `apps/mini-app/test/wallet-recovery-trigger.test.ts` | 7 | 144 |
| `apps/mini-app/test/wallet-send.test.ts` | 6 | 54 |
| `apps/mini-app/test/wallet-transfer-history.test.ts` | 11 | 298 |
| `apps/mini-app/test/wsteth-rate.test.ts` | 4 | 69 |
| `scripts/audit_dependencies.test.mjs` | 6 | 34 |
| `scripts/run_anvil_tests.contract.test.mjs` | 5 | 80 |
| `scripts/verify_architecture.contract.test.mjs` | 2 | 19 |
| `scripts/verify_frontend_secrets.test.mjs` | 2 | 16 |

## Ledger integrity check

Every evidence path and anchor is checked against the current original source; IDs are unique and all entries use the requested schema. This is a source-reference integrity check, not test execution. No app code, tests, dependencies or lockfiles were changed by this audit.
