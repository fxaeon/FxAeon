# Architecture

FxAeon ships two separate static sites. The Next.js app is used on the web and
as a Telegram Mini App. The independent landing site contains no wallet or
protocol integration.

```mermaid
flowchart LR
  B[Browser or Telegram] --> A[Static Next.js app]
  A --> S["Locked official f(x) SDK"]
  A --> R[Public Ethereum and Base RPC]
  A --> P[Display-only market data]
  A --> W[Selected user wallet]
  S --> E[Ethereum]
  W --> E
  W --> BASE[Base]
  E <--> L[LayerZero]
  BASE <--> L
```

## Boundaries

- `apps/mini-app/src/lib/fx/` adapts the official SDK, validates reviewed
  transaction policy, and executes ordered requests through the selected
  wallet. The immutable method list is in [`../fx-scope.lock.json`](../fx-scope.lock.json).
- `apps/mini-app/src/lib/wallet/` uses explicitly selected injected EVM wallets
  on the ordinary web app. The Privy adapter is loaded only for Telegram Mini
  App launch data in configured builds. The initial provider choice remains
  stable across route changes; host detection selects UX, not authentication
  authority. Privy verifies Telegram's signed launch payload. There is no
  server signer. See [wallet rollout notes](telegram-wallet-rollout.md).
- `apps/mini-app/src/lib/web3/` and `WalletDataProvider` share public native and
  token-balance reads. Alchemy Data API results can broaden display discovery;
  canonical RPC reads remain authoritative for supported assets.
- `portfolioValuation.ts` reconciles fresh canonical balances with expanded
  discovery and calculates a nonduplicated known-priced subtotal;
  `addressPresentation.ts` keeps compact wallet-address display consistent.
- Position presentation is display-only. `positionNaming.ts` gives a position
  one name in its row, Trade's result and History ("Opened ETH Long");
  `positionUnits.ts` names an ETH long's collateral stETH; `tradeOutcome.ts`
  keys Trade's outcome preview to the exact ticket, so its figures never
  describe a different ticket; `positionBorn.ts` carries the chosen split from
  Trade's result into the new position with a view transition, or a plain
  page change.
- The position brake is read-only. `app/trade/positionBrakeReader.ts` reads
  each position's debt ratio and its pool's rebalance and liquidation
  thresholds and oracle price; `PositionBrakeProvider` runs those reads while
  a position row is shown; `lib/positionBrake.ts` turns them into the row's
  marker and line. `lib/fx/ethLongAccounting.ts` reads the live wstETH rate
  (and an existing position's collateral) beside ETH long plans, so reviews
  can state collateral in stETH. None of these plans or signs a transaction.
- `apps/mini-app/src/lib/` price and chart modules validate third-party display
  data. USD estimates and charts are never transaction inputs.
- `apps/landing/` builds independently to a static `dist/` directory.

Protocol reads, planning, and transaction execution run in the client. The only
server endpoint is the optional Pages Function at `/api/gas`, a read-only
Ethereum gas-price fallback. It cannot plan a protocol action or establish
financial state. There is no account database, delegated signer, or background
executor.

## Transaction lifecycle

The action review builds and simulates a route for the current input. Product
actions open an explicit review before signing by default. A review is usable
for up to 30 seconds and is bound to the selected wallet session and
signing-relevant inputs. If it expires or the intent changes, the app refreshes
the review and asks the user to accept it again. The action executes that
displayed route; the runner rechecks policy and simulates immediately before
each wallet request. There is no hidden confirm-time route substitution.

Every step requires wallet approval. The next step waits for the prior
transaction's receipt and canonical check. Rejection, revert, timeout, reorg, or
nonce mismatch stops the route. The app stores a scoped resume hint just before
the wallet request; a hint is not proof of submission. Hashes, receipts,
position ownership, and protocol state are revalidated from the selected chain.
Bridge source confirmation and destination delivery are tracked separately by
matching LayerZero messages.

## Source of truth

| Data | Authority |
| --- | --- |
| Positions, collateral, debt, and leverage | Ethereum through the official SDK and required canonical reads |
| Distance to a position's rebalance point | Live, read-only pool views (debt ratio, thresholds, oracle price) and the live market quote; a display estimate, never a planning input |
| fxSAVE balance, vault state, cooldown, and claimability | Ethereum through the official SDK |
| Bridge source and destination status | Ethereum/Base receipts and matching LayerZero events |
| Sender and signing permission | The currently selected wallet |
| Standard wallet balances | Chain-probed public RPC reads |
| Expanded token discovery | Partial display metadata; never treated as proof of balance |
| USD prices and charts | Validated display feeds; never used to plan or sign |
| Theme, slippage, and recovery hints | Local device storage; reread or revalidated before use |

Wallet queries are scoped by wallet session, chain, and normalized address.
Standard balance queries have a 15-second freshness window. fxSAVE claimability
uses a 60-second window and active observers refresh every 45 seconds, before
that window expires. Claim reads verify the configured Ethereum chain before
calling the SDK; claim availability is actionable only while the matching
wallet query is fresh and not fetching or failed. Async provider reads use
session or generation guards so a response from an old wallet selection cannot
replace the current one. After an included transaction, the app cancels and
refetches active queries for that wallet and chain. Overlapping invalidations
coalesce, and a later receipt schedules a trailing refresh so an earlier RPC
response cannot win. A cache refresh is not evidence that an action succeeded;
only verified chain receipts establish transaction state.

Positions, Borrow, and Earn are Ethereum-based. Move supports the reviewed
`fxUSD` and `fxSAVE` routes between Ethereum and Base; Base is not a positions or
fxSAVE ledger.

Portfolio distinguishes unavailable data from zero. It shows a full USD total
only when all applicable values are available. Known individual holdings stay
visible during refresh; an incomplete subtotal never becomes the headline total. Estimated
position value is collateral value minus debt when validated inputs are
available; it is not P&L, ROI, health, or liquidation value.

Portfolio, Earn, and the wallet profile derive withdrawal and valuation
attention items through the shared wallet-task selector. They read claimability
from the same identity-scoped query, so a stale or unavailable claim read does
not create a claim action. Recent activity and transaction recovery use the
same selector for receipt-reconciled transaction tasks. A submitted transaction
task can direct the user to inspect progress, but is never marked retryable;
uncertain confirmation does not create a resubmit action. Receipt presentations
use verified receipt logs and transaction data for actual movements and
execution cost, while unavailable facts remain explicitly unavailable. Local
recovery records help find receipts and never establish financial truth.

Position activity loads automatically for the connected wallet from the same
four market indexes used by the pinned SDK. Orders are associated with their
position using the index entity ID, then matched to a successful Ethereum
receipt and router event. Reads are bounded and paginated; refreshing preserves
existing rows and wallet changes discard the previous wallet's view. Discovery
uses each index's current owner/real-owner association; orders have no independent
actor or recipient filter. Transferred-out positions can therefore be absent
from a prior owner's activity, and the older ETH-short index has no real-owner
field. Complete historical attribution requires a wallet-aware event index.
Indexed position events and local recovery records remain distinct sources.

## User data

There is no account database. Local records are scoped recovery hints, not
financial truth or cross-device history. Unsigned drafts contain form values,
not executable calldata; they are kept separate from submitted transaction
records. See [`security.md`](security.md) for trust assumptions and
[`sdk-scope.md`](sdk-scope.md) for the protocol boundary.

The deterministic UI state lab is a development and test fixture served only
on loopback by `pnpm --dir apps/mini-app dev:state-lab`; it is not part of the
production app. Browser-test isolation and commands are listed in
[`browser-test-gates.md`](browser-test-gates.md), and lab usage is in
[`ui-state-lab.md`](ui-state-lab.md).
