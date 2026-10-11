# Deployment

FxAeon deploys as two independent Cloudflare Pages sites. Keep their roots,
build outputs, environment variables, and custom domains separate.

| Site | Pages project | Root | Build | Output | Intended domain |
| --- | --- | --- | --- | --- | --- |
| Financial web and Telegram app | `fxaeon` | Repository root `/` | `pnpm --filter @fxaeon/mini-app build` | `apps/mini-app/dist` | `fxaeon.com`, `www.fxaeon.com` |
| Marketing site | `fxaeon-landing` | `apps/landing` | `node build.mjs` | `dist` | `fxaeon.xyz` |

The landing project watches `apps/landing/*`, as recorded in
[`apps/landing/wrangler.toml`](../apps/landing/wrangler.toml). The app project
uses the root [`wrangler.toml`](../wrangler.toml). Both deploy static Pages
output; `wrangler deploy` is for Workers and is not the deployment command for
these sites.

## Build configuration

The financial app consumes public variables at build time. For production,
GitHub Actions supplies the protected values while building, then uploads the
finished static artifact. Cloudflare Pages does not rebuild that upload, so
duplicating these public build variables in Cloudflare is unnecessary for this
release path. Changes to GitHub build variables take effect on the next release
build, not by changing a runtime Pages binding.

Cloudflare Git previews build independently. Set the desired public variables
in the Pages **Preview** environment if using those builds; they do not inherit
GitHub Actions secrets. A preview without optional fallback variables uses only
its configured providers. Keep any separately enabled Pages build environment
explicit rather than assuming it shares the production GitHub configuration.

| Name | GitHub storage | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Secret | Production Privy app; local-development ID is rejected |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Secret | Origin-restricted Ethereum RPC |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Secret | Origin-restricted Base RPC |
| `NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL` | Optional secrets | Second Alchemy endpoints for Ethereum/Base HTTP and WebSocket failover |
| `NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_INFURA_BASE_RPC_URL` | Optional secrets | Third-choice Ethereum/Base HTTP fallback endpoints |
| `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY` | Secret | Browser-visible wallet-token discovery key, restricted by origin and quota |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Variable | `https://t.me/FxAeonBot` or a configured Mini App launcher |
| `TELEGRAM_BOT_TOKEN` | Secret | Bot metadata and menu synchronization; never a `NEXT_PUBLIC_*` value |
| `ETHERSCAN_API_KEY` | Optional secret | Read-only `/api/gas` Pages Function binding; when absent, the app uses its bounded RPC gas estimate fallback |
| `LIVE_GAS_ORACLE_URL` | GitHub Actions environment value | URL the release workflow probes after deploying; it does not configure the Pages Function or replace `ETHERSCAN_API_KEY` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Required secrets | Upload the verified Pages artifact and sync the optional gas-oracle secret; token requires Pages Edit on the deployment account |

The `/api/gas` response uses the same `503 {"error":"gas oracle unavailable"}`
for a missing `ETHERSCAN_API_KEY` binding and an unavailable Etherscan upstream.
The public health check can confirm whether a valid snapshot is being served,
but cannot tell which failure caused that response. Set `ETHERSCAN_API_KEY` as
a Cloudflare Pages production secret; `LIVE_GAS_ORACLE_URL` only selects the
public URL checked by GitHub Actions.

All `NEXT_PUBLIC_*` values are exposed in the compiled client. The production
validator requires the Privy ID, both Alchemy RPCs, Data API key, Telegram URL,
and bot token. Configure Privy for the exact production and preview origins and
Ethereum/Base networks. Do not reuse the local Privy application in production.
For each chain, HTTP reads and SDK planning prefer primary Alchemy, then
Infura, then Alchemy2. WebSockets start with primary Alchemy and rotate to
Alchemy2 on reconnect. A provider plan upgrade changes its capacity and billing;
it does not change this endpoint order or move healthy primary traffic to a
paid fallback.
The validator rejects any populated `NEXT_PUBLIC_FX_SCREENSHOT_*`,
`NEXT_PUBLIC_FX_LOCAL_FORK_*` or `NEXT_PUBLIC_FX_ANVIL_*` variable, matched by
prefix, and placeholder optional Infura endpoints. Keep all of those unset in
production and preview deployment dashboards. The validator checks the process
environment supplied to it; it does not inspect dashboard settings or load Next.js
`.env` files. Local fork builds remain available for disposable testing.

The landing site only needs its optional Telegram URL when building. It has no
wallet, Privy, RPC, or protocol configuration. The Pages build can use the
defaults in its source when no Telegram URL is set.

## Release workflow

Before enabling the release workflow, turn off automatic production Git
deployments for the `fxaeon` Pages project and ensure no main-branch build is
still running. The Git integration can remain available for isolated preview
deployments. This prevents a provider build from publishing over the artifact
uploaded by GitHub Actions.

`.github/workflows/deploy-mini-app.yml` runs for pushes to `main` or manual
dispatch. Manual dispatch must target the latest `main` commit. The workflow
validates production inputs, runs `pnpm verify`, builds the
production static app, checks the built artifact, stamps its revision, and
uploads `apps/mini-app/dist` with Wrangler Pages to project `fxaeon` on branch
`main`. Immediately before uploading, it checks that the commit is still the
remote `main` head. It verifies the deployed revision before checking the optional live
gas-oracle binding, the public Privy configuration, and synchronizing the
Telegram bot metadata and default Mini App menu. A Telegram sync does not
configure the native Main Mini App or profile launch button; those remain
BotFather settings.

The artifact check runs `node scripts/verify_built_rpc_config.mjs` with the same
RPC inputs as the production build. Every supplied RPC endpoint must appear as
a complete string literal in the exported `_next/static/**/*.js` browser
chunks. Missing optional inputs remain allowed; supplied-but-missing endpoints
fail before deployment. Source maps, server output, HTML and manifests do not
satisfy this check. Diagnostics contain variable names and counts, never
endpoint values. The check proves build-time inclusion, not live provider
health, account billing or successful failover. The later live configuration
probe separately checks the public Privy ID.

The upload uses the existing Pages project, so its custom domains and runtime
bindings remain attached to that project. Wrangler uploads the repository's
`functions/` directory along with the static output, including the `/api/gas`
Pages Function; generated `_headers` and CSP files are part of the build output.
The release workflow deploys the prebuilt artifact and does not run a Cloudflare
build or deploy a Worker. The standalone landing build is tested in CI and is
deployed by its separate Pages project.

If production needs a rollback, select a known-good deployment in the
Cloudflare dashboard and roll back to it, then make a corrective commit on
`main` so the repository and the next workflow deployment return to the same
revision.

Protected fork testing is separate from deployment. It uses a disposable local
Anvil fork and a protected Ethereum RPC secret; see
[`testing.md`](testing.md).
