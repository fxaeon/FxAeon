# Security model

FxAeon is unaudited application software for financial transactions. The delivered browser code, protocol contracts, wallet display, and external services are part of its trust boundary. A static client cannot protect a person from a compromised release. These controls describe implemented boundaries, not a safety certification.

Report vulnerabilities privately through [SECURITY.md](../SECURITY.md). Do not publish credentials, Telegram launch payloads, authentication tokens, private keys, or unnecessary wallet history in reports or artifacts.

## Authority boundaries

| Boundary | Authority and limitation |
| --- | --- |
| Signing | Current accepted Privy or injected wallet; Telegram passkey requests are verified and relayed by the access service, with no FxAeon delegated signer or private-key input |
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

Only configured Telegram launches with nonempty data choose the Telegram wallet. Host detection is a UX decision. In passkey mode, the server verifies Telegram's Ed25519 launch signature and the user's passkey authorizes each wallet request. Connection events do not silently accept another wallet, sign, or resume a prior form action.

Ordinary wallet-browser links strip launch data and carry only public routes. The dedicated passkey handoff uses a short-lived, single-use random capability in the URL fragment; its hash is stored server-side. It carries no Telegram launch data. Opening another app is not a completed approval.

Passkey mode replaces native Privy signup with server-verified Telegram identity and user-owned Privy wallets. Approval reserves a permanent seat before wallet creation. Database constraints cap approved reservations plus the explicit legacy baseline at 480; seats, owner keys and wallet identities cannot be recycled. Provisioning retries are bounded, reuse the same external ID, and must match the persisted wallet binding. This bound requires all provider public signup paths to be closed and provider inventory to be reconciled before activation. It does not limit other Privy apps, administrator-created wallets, monthly signatures or transaction volume.

Passkeys must verify user presence, user verification, exact RP/origin/challenge, ES256 and backup state before enrollment. Approvals require the enrolled credential's immutable backup eligibility to match; mutable current backup state does not invalidate its ownership. Privy receives only the corresponding public key as sole owner, with no additional signer. The application secret transports requests; it is not a wallet authorization key. A passkey authorizes the canonical request containing the exact reviewed transaction, wallet, expiry and idempotency key. The browser independently checks that request. Synced passkeys support using the same credential on another device; losing every copy or the Telegram account is not an implemented recovery path. Physical-device and live-provider verification remain release requirements.

The old `/api/telegram-admission` gate remains a legacy compatibility endpoint. Its browser gate cannot enforce a Privy signup cap and must not be used as a substitute for the passkey rollout.

## Public inputs and server functions

All `NEXT_PUBLIC_*` values are public build inputs. Browser credentials need origin and quota restrictions. Bot tokens, Privy secrets, signing material and server-only gas keys must remain out of client configuration.

Reviewed HTTPS Alchemy/Infura endpoints and chain probes protect selected read boundaries. Explicit local-fork builds have separate loopback rules and are rejected by production environment validation.

The root optional `/api/gas` Function reads a fixed Ethereum gas oracle. The separate landing `/api/market-data` Function reads fixed public display feeds. `/api/telegram-wallet` accepts only explicit enrollment, notification, handoff and Ethereum transaction actions; its outbound providers are fixed. It verifies a passkey before forwarding a signed authorization to Privy and cannot plan trades or act as a general RPC proxy. `/api/miniapp-operator` requires a separate server bearer credential and handles approval and notification dispatch. No server holds a user wallet private key.

The `/api/telegram-bot` webhook authenticates Telegram with a domain-separated secret derived from the bot token. It accepts only bounded private-chat commands, deduplicates updates, and limits replies. It has no enrollment or wallet authority.

Notification email addresses require explicit single-use confirmation before invitations. Mail delivery is budgeted and deduplicated; ambiguous Telegram sends are not blindly retried. Provider errors and credentials must never appear in responses or logs. Support receives replies at `support@fxaeon.com`; mail is limited to requested verification and admission notices.

Local storage, cached/indexed data and display quotes remain untrusted inputs to financial decisions. Missing/stale reads are not zero. Position valuation and rebalance-distance displays are not P&L, ROI, health or liquidation guarantees. The separate estimated PnL and entry price come from indexed order history and the SDK mid price; they are display-only, hidden while the index disagrees with the chain, and never enter execution decisions.

## Release and dependency controls

The repository checks scope/import architecture, dependency patches/audits, source/built secrets, CSP and headers, bundle budgets, types, unit behavior, browser interaction and selected fork behavior. Security workflows also include CodeQL and supply-chain checks. Passing them does not prove that a release or dependency is uncompromised.

Version-bound policies and patches are declared in [pnpm-workspace.yaml](../pnpm-workspace.yaml). Use frozen installs. [audit_dependencies.mjs](../scripts/audit_dependencies.mjs) verifies the temporary exceptions below against the lockfile, active consumer paths, installed source hashes, and runtime regressions before allowing those specific registry advisories; new findings, registry failures, expired review or tampered patches still fail.

Production uses a separate validated configured artifact after credential-free verification. Revision stamping and deployment probes prevent confusing an old, placeholder or preview build with the intended release. See [deployment](deployment.md).

## Temporary dependency backports (reviewed 24 October 2026)

The braces advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn by GitHub on 23 October 2026 as not practically exploitable. Rechecked on 3 November 2026: the temporary braces patch and its audit exception have been removed. Any new high-severity braces finding blocks CI normally.

Hono is pinned to 4.13.11 for GHSA-hxh3-vqpv-xpqv. decode-uri-component is pinned to 0.5.1 for GHSA-qr28-fpjm-wq7f.
follow-redirects is pinned to 1.16.2 for GHSA-mrwp-f3q8-3g9p.

The typed ESLint tooling's minimatch 10.2.6 dependency is replaced by 11.0.1 for [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249). The older ESLint consumers retain their separate 3.1.5 API generation. The registry's broader version range still reports that version, but it predates the affected optimization pass; the gate verifies its absence on the active consumer paths and tests the amplification pattern. This is a tooling dependency; the finding remains visible in audit output, with no advisory suppression.

`zod@3.22.4` consumers are moved to `3.25.76` with a narrowly scoped
backport for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The vulnerable behavior is retained in the upstream Zod 3 line, so the patch
limits work for oversized arrays and sets before visiting their elements.
`zod@4.4.3` consumers are moved to `4.6.7`, whose bundled Zod 3 compatibility
subpath receives the corresponding patch. The workspace keeps Zod 3 and Zod 4
as separate API generations; it does not replace Zod 3 consumers with Zod 4.
The guard checks the active `viem`, SDK, Privy, Wagmi and Porto resolution paths,
the patched package hashes and bounded array, set and map regressions,
including asynchronous parsing and valid-input compatibility.

For the Zod 3 bundled Zod 4 implementation, the early bound applies to leading
default size checks. A user-supplied `when` callback opts out of the early check
so it continues to observe transformed values with its original semantics.
No early guard is added to unbounded or minimum-only schemas. This is a local,
reviewed backport, not an upstream Zod 3 release.

Undici is pinned to `7.30.1` for [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)
and the related advisories addressed by that release. The existing
minimum-release-age exclusions remain scoped to the named Miniflare and Wrangler
versions; Undici 7.30.1 meets the release-age policy independently, and the
exclusions do not suppress audit findings.

The Zod audit exception expires on 7 November 2026. Replace it with a published
fix and remove its patch, override and gate helper when a compatible upstream
release becomes available. The Undici override should also be reviewed against
the refreshed Wrangler/Miniflare dependency graph.
