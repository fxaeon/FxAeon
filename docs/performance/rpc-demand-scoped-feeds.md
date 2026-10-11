# Subscribe to Base only while its data is displayed

The Trade, Borrow and Positions routes request live Ethereum position data but
do not request expanded wallet assets. `WalletAssetLayer` previously opened
both Ethereum and Base sockets anyway. Each socket subscribed to new heads,
outgoing wallet transfers and incoming wallet transfers. Base events updated
React state without an active Base query or position consumer on those routes.

The provider now opens Base only while expanded assets are requested. The
portfolio, home and open wallet profile retain both chains; Send's explicit
expanded-asset demand also retains both. Closing the profile on an
Ethereum-only route closes Base and resets its chain state. Move continues to
use its existing exact source-balance query and HTTP block fallback.

Ethereum subscriptions, polling intervals, cache freshness, manual refresh,
receipt invalidation, transaction planning and signing guards are unchanged.
Both chains still pause when the tab is hidden or offline. Opening a profile
activates its canonical queries immediately; it does not wait for a socket.

## Reproducible comparison

The existing browser harness uses the real WalletDataProvider, Wagmi/Query
observers and HTTP transport, with local fixtures for wallet identity, prices,
HTTP responses and websocket delivery. The test drives one minute with an
Ethereum head every 12 seconds and a Base head every 2 seconds. These cadences
are fixture inputs, not a measurement of current provider traffic.

| Ethereum-only route, one simulated minute | Before | After |
| --- | ---: | ---: |
| Open sockets | 2 | 1 |
| Active subscriptions | 6 | 3 |
| Ethereum head deliveries | 5 | 5 |
| Base head deliveries | 30 | 0 |
| Base balance HTTP reads | 0 | 0 |

The unused feed is eliminated, with 85.7% fewer total head deliveries in this
fixture. This is not an 85.7% reduction in all RPC calls or the total bill.
The test also changes the Ethereum balance before a stale head, changes the
Base balance while the profile is closed, and checks refreshed amounts after
reopening. Both chains return when the profile is open; hidden-tab work and
disconnected sockets stop.

Run the full wallet harness from `apps/mini-app`:

```sh
pnpm test:e2e:overlay wallet-rpc-proof
```

For the same fixture against the previous production component:

```sh
RPC_DEMAND_BASELINE_REF=0c3ae24 pnpm test:e2e:overlay wallet-rpc-proof --grep Ethereum-only
```

The baseline override replaces only WalletDataProvider. Both runs attach the
subscription and notification counts as `demand-scoped-websocket-proof`.

## Billing interpretation

As checked on 9 October 2026, [Alchemy's method table](https://www.alchemy.com/docs/reference/compute-unit-costs)
prices `eth_subscribe` at 10 CU and ordinary websocket notifications at 0.04 CU
per delivered byte. Removing the unused Base feed therefore avoids its setup
calls, head bytes and any matching transfer bytes. The existing Ethereum feed
and both feeds on portfolio surfaces remain billable.

No production dashboard, real header payload sizes, session mix or monthly
usage was measured here. Estimate the saved notification CUs from actual
avoided Base bytes multiplied by 0.04, then apply the account's marginal CU
rate. Do not price the tiny synthetic header payloads as production traffic.
Frontend parsing and provider state updates for the removed notifications
also disappear; render-time and battery savings have not been measured.
