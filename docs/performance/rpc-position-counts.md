# Batch the four initial position ownership counts

Every full position refresh checks the wallet's ERC-721 `balanceOf` in four
supported pools before consulting the SDK indexer. Those four independent
reads previously used four parallel `eth_call` requests, including for an
empty wallet. The same checks now use one `aggregate3` read on Ethereum's
configured Multicall3 contract, with the wallet address explicitly supplied to
each pool's `balanceOf`.

Only the initial counts are batched. The RPC chain proof still runs first.
Nonempty groups retain canonical position-state and owner checks, bounded
discovery when the index is incomplete, and the final direct `balanceOf`
recheck that detects ownership-count races. Counts are local to one refresh;
there is no new cache, changed polling interval or signing-path reuse.

## Failure behavior

Each slot has its own promise. A reverting or malformed slot retries only that
pool using the existing direct read, within the same refresh deadline. Healthy
groups can begin ownership verification while another slot falls back. A
malformed aggregate length or failed aggregate request falls back to direct
reads for all four pools. An exhausted deadline starts no new fallback work.

Failed reads remain failed groups and cannot become authoritative zero counts.
The tradeoff is one additional aggregate request when all slots require a
fallback: five initial `eth_call` requests instead of the previous four, still
bounded by the existing deadline. A healthy refresh uses one instead of four.
A slow aggregate also delays the start of every group; fallbacks receive only
the remaining deadline. These tests establish correct partial-failure results,
not unchanged latency or availability during a real provider failure.

## Reproduction and cost scope

The transport regression uses the installed viem client and the actual shared
HTTP transport against deterministic JSON-RPC responses. Its comparison path
is the previous sequence: chain guard followed by independently settled calls
to the unchanged single-group reader. It compares exact results as well as
wire request counts.

With the same fixtures, an empty wallet uses four `eth_call` requests before
and one after, with an explicit `eth_chainId` request in both paths. A wallet
holding four positions across three pools uses 15 `eth_call` requests before
and 12 after, with identical rows and all four canonical state/owner checks
plus three final direct count rechecks preserved. All 38 tests in the new
transport suite and existing direct-discovery suite passed on Node 22.23.3.

```sh
cd apps/mini-app
node --import tsx --test test/rpc-position-counts.test.ts test/direct-position-discovery.test.ts
```

As checked on 9 October 2026, [Alchemy's method table](https://www.alchemy.com/docs/reference/compute-unit-costs)
lists `eth_call` at 26 CU and `eth_chainId` at zero billed CU. The healthy
initial-count phase therefore goes from 104 to 26 CU, saving 78 CU per full
position refresh (75% of that phase). This is contract multicall inside one
`eth_call`, rather than a JSON-RPC batch of four separately billed methods.

The existing initial reads were already concurrent, so removing three requests
does not establish a three-round-trip latency gain. Real provider latency,
total application traffic and monthly billing have not been measured. The
per-refresh saving scales with how often this path is used; SDK hydration,
canonical ownership checks and all other RPC calls remain outside this count.
