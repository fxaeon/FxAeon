# Local development

Run the financial app, landing site, or isolated UI fixtures independently. Start without credentials when working on layout or unavailable states; add public service configuration only for the behavior you need.

## Install the workspace

Requirements are pinned in [package.json](package.json): Node.js 22 and pnpm 11.19.0. Git is needed to clone the repository. Chromium is needed for browser tests; Foundry/Anvil is needed only for protected fork tests.

~~~sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
~~~

The frozen install applies the version-bound patches in [pnpm-workspace.yaml](pnpm-workspace.yaml). Do not remove a patch or regenerate the lockfile to bypass an installation or audit failure. See [contributing](CONTRIBUTING.md#dependencies-and-sdk-changes).

## Start the app

From the repository root:

~~~sh
pnpm dev
~~~

Open [localhost:3000](http://localhost:3000). Portfolio is the app entry. Missing RPCs, balances, or prices should produce honest unavailable states.

For configured development, copy [the public example](apps/mini-app/.env.example) into an ignored local file:

~~~sh
cp apps/mini-app/.env.example apps/mini-app/.env.local
~~~

PowerShell equivalent:

~~~powershell
Copy-Item apps/mini-app/.env.example apps/mini-app/.env.local
~~~

Replace placeholder values. Clear optional endpoints and discovery keys you are not using; copying a placeholder does not configure a working service. The example's Privy ID is reserved for local development and is rejected by production validation.

Restart the development server after environment changes. Public values are compiled into a production export, so changing a Pages runtime binding does not update an existing browser bundle.

## Wallet modes

| Context | Provider and behavior |
| --- | --- |
| Ordinary browser | Explicitly selected injected EVM wallet; supported catalog entries can offer a wallet-browser or official download handoff |
| Configured Telegram launch with nonempty launch data | Lazily mounted Privy provider; Privy validates identity, while the app maintains explicit wallet-selection and signing boundaries |
| Telegram-looking user agent or empty SDK stub | Does not grant authentication or by itself select Privy |
| No Privy app ID | Public/browser mode; Telegram-specific login reports its unavailable state |

A browser wallet signs only after the person approves its connection and each transaction. A wallet-browser link opens another browser context; it does not connect the original tab or carry its unsaved form.

A configured Privy ID alone does not put ordinary web traffic through Privy. Real Telegram authentication requires a valid launcher, origin configuration, and signed Telegram payload. Do not manufacture launch data for a live authentication request. Use the [isolated wallet-provider harness](docs/browser-test-gates.md) for deterministic routing tests.

## Public application settings

Set these in `apps/mini-app/.env.local` for local work. Names are build-time inputs, not secret storage.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy application for configured Telegram launches; optional for ordinary browser-wallet work |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Primary Ethereum Alchemy HTTPS endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Primary Base Alchemy HTTPS endpoint |
| `NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL` | Optional second Alchemy endpoints |
| `NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_INFURA_BASE_RPC_URL` | Optional Infura HTTP fallbacks |
| `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY` | Optional browser-visible wallet-token discovery |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Bot or configured Mini App launcher |

For each chain, HTTP reads and SDK planning prefer primary Alchemy, then Infura, then Alchemy2. WebSocket reconnects can rotate from primary Alchemy to Alchemy2. The app checks chain identity at financial boundaries. Use the reviewed provider hosts and the correct chain; arbitrary production RPC hosts are not accepted. Loopback endpoints are reserved for explicit local-fork fixtures.

Every `NEXT_PUBLIC_*` value is public in the delivered JavaScript. Restrict provider credentials by origin and quota. Never put private keys, bot tokens, Privy secrets, or unrestricted credentials in this file. Server/deployment settings belong in the [deployment guide](docs/deployment.md#configuration).

## Start the landing site

~~~sh
pnpm build:landing
pnpm preview:landing
~~~

Visit [localhost:4173](http://localhost:4173). Output is `apps/landing/dist/`. Its local server also serves the read-only market-data route; upstream failures leave affected values unavailable. The landing does not initialize wallets or the protocol SDK.

The standalone build can also run without a workspace install:

~~~sh
cd apps/landing
node build.mjs
node serve.mjs
~~~

See the [landing package guide](apps/landing/README.md) for artwork regeneration, data provenance, and hosting its Pages Function.

## Choose a verification loop

| Work | Start with |
| --- | --- |
| Pure logic or transaction policy | Relevant app unit test, then `pnpm test` |
| Form, overlay, or wallet interaction | Matching [isolated browser gate](docs/browser-test-gates.md) |
| Production routes, CSS, or navigation | Fresh build and built-route Playwright checks |
| Landing copy, artwork, or calculator | `pnpm test:landing` and `pnpm test:landing:browser` |
| Release candidate | `pnpm verify`, plus the relevant protected/device checks |

Install browser support once:

~~~sh
pnpm --dir apps/mini-app exec playwright install chromium
~~~

On Linux runners, Playwright's `--with-deps` option also installs browser system dependencies. Local tests can use an installed Chrome fallback when bundled Chromium is absent; specify `E2E_BROWSER_CHANNEL=chrome` or `msedge` only when intentionally selecting that browser. Record the browser when reporting visual evidence.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Balances or quotes unavailable | Replace RPC placeholders, check origin restrictions, chain, quotas, and network access |
| No Privy modal on the web | Expected browser mode; use an injected wallet or the dedicated Telegram fixture |
| Telegram opens browser-connect guidance | Verify the build contains its intended Privy ID and that nonempty launch data reached the document |
| Font or package fetch fails during build | Check network access; a failed build is not a passed verification gate |
| Browser results look older than source | Stop stale servers, rebuild, and avoid export reuse until the artifact revision is known |
| High memory use | Use `pnpm verify --serial`; do not run Next development and production builds concurrently in one checkout |
| Dependency audit reports the reviewed backport | Run `pnpm audit:all` and read [the version-bound exception](docs/security.md#temporary-dependency-backport-3-october-2026); do not add blanket ignores |

Next development uses `.next/`; production exports use `dist/`. Build/export operations must remain sequential in a checkout because Next can also use intermediate files under `.next/`. Generated output and temporary evidence are ignored.

For disposable protocol execution and funded local previews, follow [protected fork testing](docs/testing.md#protected-ethereum-fork-tests). No production funds are needed for development verification.
