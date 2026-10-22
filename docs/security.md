# Security model

FxAeon is unaudited application software for financial transactions. The delivered browser code, protocol contracts, wallet display, and external services are part of its trust boundary. A static client cannot protect a person from a compromised release. These controls describe implemented boundaries, not a safety certification.

Report vulnerabilities privately through [SECURITY.md](../SECURITY.md). Do not publish credentials, Telegram launch payloads, authentication tokens, private keys, or unnecessary wallet history in reports or artifacts.

## Authority boundaries

| Boundary | Authority and limitation |
| --- | --- |
| Signing | Current accepted Privy or injected wallet; no FxAeon delegated/server signer or private-key input |
| Protocol planning | Pinned official SDK within [the locked surface](../fx-scope.lock.json), followed by application policy checks and simulation |
| Financial state | Canonical chain/SDK reads and verified matching transactions/receipts |
| Supported networks | Ethereum (1) for positions/borrowing/fxSAVE; Ethereum and Base (8453) for specified Move routes |
| Discovery and display | Indexers, token discovery, prices, charts, and valuation can be partial or unavailable; they do not authorize signing |
| Local persistence | Scoped drafts/recovery hints; never authoritative confirmation or automatic retry permission |

Hosting, RPC providers, wallets, the SDK, token/protocol contracts, LayerZero, price feeds, and chains remain dependencies outside this application's control.

## Before and after a wallet request

The app binds a review to wallet session and signing-relevant inputs. It validates destination, selector, value, approvals, transaction order and nonce, and simulates before requesting approval. Expired or changed intent requires a new accepted review.

Private wallet dispatch checks fence owner, provider, account and chain changes through asynchronous preflight. Every transaction receives explicit wallet approval. The runner verifies the returned transaction and canonical receipt before sending a dependent step.

Rejection, revert, timeout, reorg, nonce drift or receipt mismatch stops progression. Once dispatch occurred, a later session/UI change must not discard its original result or cause a replay. Uncertain state remains recoverable and inspectable without automatic resubmission.

Bridge source confirmation and destination delivery are different states. Matching LayerZero evidence is required for delivery; source inclusion alone is insufficient.

See [architecture](architecture.md#transaction-lifecycle), [wallet ownership](privy-wallet-ownership.md), and [SDK scope](sdk-scope.md) for detailed invariants.

## Wallet and Telegram identity

Ordinary web selects an explicitly accepted injected provider. Provider announcements and brand metadata are availability hints, not proof of identity. Ambiguity fails closed; an unrelated global provider cannot replace the selected one.

Only configured Telegram launches with nonempty data choose Privy. Host detection is a UX decision; Privy verifies signed identity. Connection events do not silently accept another wallet, sign, or resume a prior form action.

Wallet-browser links strip query/fragment/launch data and carry only reviewed public routes. Opening another app or download page is not a completed connection. There is no admission/waitlist backend or account database; client-side host detection does not enforce a provider billing cap.

## Public inputs and server functions

All `NEXT_PUBLIC_*` values are public build inputs. Browser credentials need origin and quota restrictions. Bot tokens, Privy secrets, signing material and server-only gas keys must remain out of client configuration.

Reviewed HTTPS Alchemy/Infura endpoints and chain probes protect selected read boundaries. Explicit local-fork builds have separate loopback rules and are rejected by production environment validation.

The root optional `/api/gas` Function reads a fixed Ethereum gas oracle. The separate landing `/api/market-data` Function reads fixed public display feeds. Neither accepts protocol plans, signs transactions, or acts as a general RPC proxy.

Local storage, cached/indexed data and display quotes remain untrusted inputs to financial decisions. Missing/stale reads are not zero. Position valuation and rebalance-distance displays are not P&L, ROI, health or liquidation guarantees.

## Release and dependency controls

The repository checks scope/import architecture, dependency patches/audits, source/built secrets, CSP and headers, bundle budgets, types, unit behavior, browser interaction and selected fork behavior. Security workflows also include CodeQL and supply-chain checks. Passing them does not prove that a release or dependency is uncompromised.

Version-bound policies and patches are declared in [pnpm-workspace.yaml](../pnpm-workspace.yaml). Use frozen installs. [audit_dependencies.mjs](../scripts/audit_dependencies.mjs) verifies the temporary exception below before allowing that specific registry advisory; new findings, registry failures, expired review or tampered patches still fail.

Production uses a separate validated configured artifact after credential-free verification. Revision stamping and deployment probes prevent confusing an old, placeholder or preview build with the intended release. See [deployment](deployment.md).

## Temporary dependency backport (3 October 2026)

`braces@3.0.3` is used by Tailwind, Chokidar, and Next's ESLint tooling.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
describes stack exhaustion from deeply nested input. There is no published
3.0.4 in npm at this review date, even though npm's audit response names that
version. We backport only the five `lib/` changes from
[upstream PR 72, commit d0d575e](https://github.com/micromatch/braces/commit/d0d575e55e74a4e0218e5248fafb79efc3e54ebb)
to the exact installed version via `patches/braces@3.0.3.patch`. This is an
unreleased upstream contribution, not an official patched release.

`pnpm run audit:all` checks all four affected dependency paths, installed
source hashes, string/AST attack inputs, the allowed boundary, and ordinary
glob expansion before ignoring **only that advisory** in the registry audit.
The raw `pnpm audit` command still reports it because the package version
remains 3.0.3. Every other high/critical finding and registry failure blocks
CI. Version changes, missing/tampered patches, or a failing regression also
block the gate. The mitigation expires on 3 November 2026; replace it with
the official release and remove the patch, exception, and gate helper when
one becomes available. Hono is pinned to 4.13.7 for GHSA-hxh3-vqpv-xpqv.
