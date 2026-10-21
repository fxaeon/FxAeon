<div align="center">

<a href="https://fxaeon.xyz"><img alt="FxAeon" src="apps/mini-app/public/icon.svg" width="64"></a>

# FxAeon

Trade, save, borrow, and move assets with f(x) Protocol.

[Open web app](https://fxaeon.com) · [Open in Telegram](https://t.me/FxAeonBot) · [Website](https://fxaeon.xyz) · [Developer handbook](docs/README.md)

[![Client CI](https://github.com/fxaeon/FxAeon/actions/workflows/ci.yml/badge.svg)](https://github.com/fxaeon/FxAeon/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/license-MIT-2973FF)](LICENSE)

</div>

FxAeon is a self-custodial web app and Telegram Mini App built on the pinned official [f(x) Protocol SDK](https://github.com/AladdinDAO/fx-sdk). The browser builds a route, presents its amounts and limits, and requests approval from the selected wallet for each transaction.

| Product | Supported behavior |
| --- | --- |
| Trade and Positions | Open and manage supported ETH/BTC long and short positions within live pool limits |
| Earn | Deposit into fxSAVE; redeem directly to fxSP without cooldown, or withdraw to fxUSD/USDC instantly for the applicable fee or through a queued claim |
| Borrow | Supply supported collateral, borrow fxUSD, repay debt, and withdraw collateral |
| Move | Bridge fxUSD and fxSAVE between Ethereum and Base; track source confirmation and destination delivery separately |
| Send | Review a supported native/token wallet transfer on the selected network; track its submitted hash in History |
| Portfolio and History | Inspect available balances, positions, activity, and receipt-verified recovery state |

Positions, borrowing, and fxSAVE accounting use Ethereum. Base is supported for the reviewed Move routes; it is not a second positions ledger. [Product behavior](docs/product-behavior.md) describes the interface and its limits.

## Run locally

Use **Node.js 22** and **pnpm 11.19.0**, as pinned in [package.json](package.json).

~~~sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
~~~

Open [localhost:3000](http://localhost:3000). A fresh checkout can render public routes and unavailable states without credentials. For public protocol reads, configure restricted RPC endpoints using [SETUP.md](SETUP.md).

Ordinary browsers use explicitly selected injected EVM wallets, including wallet-browser handoff when supported. Configured Telegram launches with nonempty launch data load Privy. Adding a Privy app ID does not enable Privy email login on the ordinary website. [Wallet modes and setup](SETUP.md#wallet-modes) explains the distinction.

## Development workflow

~~~sh
pnpm test
pnpm typecheck
pnpm lint
pnpm verify
~~~

Use focused checks while iterating; run the complete verification gate before release. `pnpm verify` covers source contracts, dependency auditing, the static build, bundle and secret checks, built-route browser tests, nine isolated browser gates, and landing checks. It uses credential-free app fixtures. Protected Anvil tests are separate and use disposable local forks. See [testing](docs/testing.md).

## System boundaries

The app is a static Next.js 16 export with React 19. The selected user wallet is the signer. FxAeon has no protocol transaction backend, delegated signer, private-key input, or background executor.

- The [SDK lock](fx-scope.lock.json) permits exactly 15 public SDK methods. The installed SDK includes a [reviewed local patch](patches/@aladdindao__fx-sdk@1.0.5.patch); [SDK scope](docs/sdk-scope.md) explains its boundaries.
- Reviews bind exact transaction terms to the current wallet session and inputs. The runner validates policy and simulates before wallet requests, then verifies the resulting transaction and receipt before dependent steps.
- USD prices, charts, and portfolio estimates are display context. They do not supply transaction limits or signing amounts. Missing values remain unavailable.
- Two read-only Pages Functions have separate purposes: the app's optional [gas endpoint](functions/api/gas.ts) and the landing site's [market-data endpoint](apps/landing/functions/api/market-data.ts). Neither signs or plans protocol actions.

FxAeon is unaudited application software for financial transactions. Read the [security model](docs/security.md), inspect wallet requests, and use [SECURITY.md](SECURITY.md) for private vulnerability reports.

## Repository map

| Path | Responsibility |
| --- | --- |
| [apps/mini-app](apps/mini-app/README.md) | Static financial app, wallet adapters, SDK integration, and browser harnesses |
| [apps/landing](apps/landing/README.md) | Independent marketing site, original FxAeon sculpture, and display-only scenarios |
| [functions/api](functions/api) | Optional application gas Pages Function |
| [docs](docs/README.md) | Developer handbook, implementation contracts, and capture provenance |
| [patches](patches) | Version-bound dependency patches applied by pnpm |
| [scripts](scripts) | Verification, build, deployment, and capture tools |
| [DESIGN.md](DESIGN.md) | Product tokens, component and responsive interaction contracts |

Start with [setup](SETUP.md), then [contributing](CONTRIBUTING.md). Maintainers should read [architecture](docs/architecture.md), [testing](docs/testing.md), and [deployment](docs/deployment.md). The app's separate reader-facing guide is available at [/docs](https://fxaeon.com/docs).

[MIT License](LICENSE).
