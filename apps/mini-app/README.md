# Financial web and Telegram app

This package builds the static Next.js 16/React 19 app hosted at [fxaeon.com](https://fxaeon.com). Portfolio is the entry; Trade, Positions, Earn, Borrow, and Move use the pinned official f(x) SDK.

Start with [local setup](../../SETUP.md). The root [developer handbook](../../docs/README.md) owns shared setup, architecture, test, and deployment instructions.

## Run and verify

Commands run from the repository root:

~~~sh
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify
~~~

Use [browser gates](../../docs/browser-test-gates.md) to select an isolated interaction test. `pnpm test:e2e` covers built routes, not all isolated projects.

## Runtime boundaries

Ordinary browsers use an explicitly accepted injected EVM wallet. Configured Telegram Mini App launches with nonempty data load Privy lazily. A Privy ID alone does not enable ordinary-web email login. Host detection selects UX; the authentication service validates signed identity.

The app runs protocol reads, planning, policy checks, simulation, and transaction execution in the browser. Every transaction requires selected-wallet approval. The optional root `/api/gas` Function is read-only. No FxAeon signer or protocol backend exists.

Positions, borrowing, and fxSAVE accounting use Ethereum. Move supports specified fxUSD/fxSAVE transfers between Ethereum and Base, with source confirmation and destination delivery tracked separately.

## Source map

| Directory | Responsibility |
| --- | --- |
| `src/app/` | Routes, metadata, forms, and product-level behavior |
| `src/components/` | Shared shell, amount/selection controls, providers, reviews and receipts |
| `src/lib/fx/` | SDK adapter, policy, simulation, runner, receipts and recovery |
| `src/lib/wallet/` | Provider identity, connection lifecycle, and signing dispatch |
| `src/lib/web3/` | Shared read-only chain/balance infrastructure |
| `e2e/` | Built-route and isolated browser fixtures; development-only state lab |
| `test/` | Unit, contract, chaos and local-fork tests |

Reviews stay on the product route and bind the accepted simulated route to the current input and wallet session. Changed/expired intent requires a fresh review. Exact transaction values and caveats remain inspectable.

Drafts and local journals are scoped recovery hints. A saved draft does not prove submission, and a submitted record cannot automatically resend. Chain receipts and fresh canonical reads establish financial state.

## Build output

| Mode | Output |
| --- | --- |
| Development/intermediate files | `.next/` |
| Production static export | `dist/` |
| Explicit isolated export | Validated `FX_E2E_DIST_DIR` name when used by its fixture |

Build sequentially in one checkout; do not run Next development and export concurrently. Generated CSP/header files are part of the export. Public configuration is compiled at build time.

Read [architecture](../../docs/architecture.md), [security](../../docs/security.md), [SDK scope](../../docs/sdk-scope.md), and [deployment](../../docs/deployment.md) before changing financial or release boundaries.
