# Security policy

FxAeon is unaudited application software that prepares financial transactions in a static browser client. Protocol audits do not audit FxAeon's UI, wallet configuration, dependency lockfile, deployment, or transaction validation. Treat every release as software that must be independently reviewed before use with funds.

## Report a vulnerability privately

Do not publish exploit details, private keys, wallet data, Telegram launch data, Privy tokens, raw calldata, or provider credentials in an issue, chat, or pull request. [Create a private GitHub security advisory](https://github.com/fxaeon/FxAeon/security/advisories/new) instead. Include the affected commit or release, component, reproducible steps, impact, and a proposed mitigation when known.

Maintainers will acknowledge a valid report, coordinate a fix and disclosure window, and credit the reporter when requested. Do not probe wallets, contracts, or infrastructure that you do not own.

## Security boundaries

- FxAeon has no protocol transaction backend, account database, or delegated signer. Two separate read-only Pages Functions serve the app's optional `/api/gas` endpoint and the landing site's `/api/market-data` endpoint. Neither plans or signs protocol actions or supplies authoritative wallet state.
- Positions, Borrow, and fxSAVE financial state is Ethereum-authoritative; Move is the supported `fxUSD`/`fxSAVE` bridge between Ethereum and Base.
- The current accepted user wallet authorizes signing: an explicitly selected injected wallet on ordinary web, or the Privy wallet integration on configured Telegram launches. Every transaction requires wallet approval. FxAeon never accepts or stores a private key.
- The official f(x) SDK is the only protocol planner. The client validates transaction targets, selectors, sender, chain, value, approvals, nonce, and order before every visible wallet prompt.
- A rejected, reverted, timed-out, or nonce-drifted step stops the route; later steps are not submitted automatically.
- Local storage is a UI and recovery hint only. It is never authoritative for balances, receipts, permissions, or bridge delivery.
- Test against local fixtures, safe simulations, or a local fork. Never use another person's wallet or production funds to reproduce a bug.

The detailed controls and release gates are documented in [`docs/security.md`](docs/security.md) and [`docs/testing.md`](docs/testing.md).
