# Actual local-fork proof

This directory keeps three kinds of evidence separate:

| Entry point | What it establishes | What it does not establish |
| --- | --- | --- |
| `safety.test.ts` | Deterministic endpoint, identity, signer and proof-file boundaries | EVM execution or an actual protocol fork |
| `scripts/fork-boundary.mjs` | An actual local Anvil on Ethereum chain ID 1 is rejected when it is not a fork | Successful protocol execution |
| `scripts/fork-run.mjs` | When its required case and proof both pass, actual native-ETH long execution on deployed f(x) contracts through the production SDK, protocol adapter, controller and browser-wallet adapter | Rendered-browser acceptance, all-market parity, native Telegram or a public-chain transaction |

The ordinary unit discovery intentionally excludes this directory. Missing RPC
access fails the dedicated launcher with exit code **2**, and an unsuccessful
execution fails with exit code **1**. There is no skip or mock fallback. A zero
test-process exit alone is insufficient: one named passing TAP case, no skipped
or cancelled cases, and a fresh validated proof bound to this fork instance and
run ID are all required.

## Commands

Run from `rebuild/` with the installed Node 22 runtime and frozen dependencies:

```sh
node --import tsx test/fork/safety.test.ts
FX_REBUILD_ANVIL_BIN=/path/to/anvil node --import tsx scripts/fork-boundary.mjs
FX_REBUILD_ANVIL_BIN=/path/to/anvil node --import tsx scripts/fork-run.mjs
```

For the actual fork launcher, set `ANVIL_FORK_URL` through the authorized runtime
configuration. The already documented `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` and
`ALCHEMY_RPC_URL` names are accepted as fallbacks. The launcher does not search
credential stores or read `.env` files. `ANVIL_FORK_BLOCK` optionally supplies a
positive decimal pinned block; otherwise the launcher chooses 64 blocks behind
the proved latest head. It verifies the pinned header, historical deployed
contract code, and a historical pool storage read before starting Anvil.

The explicit `--publicnode` diagnostic uses only the public endpoint documented
by the installed SDK. It cannot be combined with a configured upstream URL:

```sh
FX_REBUILD_ANVIL_BIN=/path/to/anvil node --use-env-proxy --import tsx scripts/fork-run.mjs --publicnode
```

`--use-env-proxy` honors an environment's existing proxy configuration; it does
not supply provider credentials or modify Origin headers. Access denial remains
blocking. Local process and network execution must follow the workspace's
execution permissions.

## Signer boundary

The launcher creates its own detached Anvil process on an available port bound
only to `127.0.0.1`, with no generated default accounts, no persistent fork cache,
and bounded upstream requests. Only its own process group is terminated. The
application-test process receives the local URL and exact proved block, block
hash and instance ID; it receives no upstream URL or application credentials.

The test guard rejects aliases, credentials, redirects, paths and query strings
in signing URLs. Ethereum chain ID, Anvil client identity, fork metadata, pinned
base header and unchanged instance ID are required before funding, signing and
sending. A new private key is generated in memory after proof. Only that account
is funded with two disposable local ETH. It is never persisted or displayed.
No real account is impersonated and no protocol bytecode or storage is replaced.
The raw transaction's recovered signer and chain are checked before submission.

The production browser-wallet adapter receives a provider with only the narrow
account/chain/transaction methods needed by this test. The transaction must match
the accepted review exactly. A consumed nonce cannot be replayed. Every public
network access from the application-test process is rejected, including the
SDK's optional remote index. Canonical local contract reads establish ownership
and accounting; no fake index response is supplied.

## Native-long acceptance

The case enters `0.100000000000000001 ETH`, prepares through the actual installed
SDK, checks decoded native amount and new-position ID, and sends once through
the actual controller and browser-wallet adapter. It independently compares
mined input, value and nonce with the review; checks canonical receipt, mint,
current owner and accounting; reconciles the exact ETH spend with actual gas;
and creates a fresh controller/wallet binding from stored recovery hints. The
fresh instance must repeat canonical reads without planning or sending again.

`results/last-run.json` records the actual launcher outcome and runtime versions.
A failed execution may have an unknown send count; it is never labeled zero
merely because a passing proof is absent. A successful case also writes
`native-long-proof.json`. The fixed proof schema rejects provider URLs, arbitrary
diagnostics and unknown fields. `local-boundary.json` is explicitly marked
`realProtocolVerified: false` even when that boundary check passes.

The available Anvil 1.7.1 differs from the retained CI pin of 1.8.1. The launcher
records that fact and does not treat a local result as version-aligned final
release evidence. Broader market and Earn/Borrow/Bridge lifecycle proof remains
separate work.
