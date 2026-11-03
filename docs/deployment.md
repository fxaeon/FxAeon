# Deployment and rollback

FxAeon uses two independent Cloudflare Pages projects. Keep their roots, output directories, Functions, configuration, and domains separate.

| Application | Project | Build root and command | Output | Domain |
| --- | --- | --- | --- | --- |
| Financial web/Telegram app | `fxaeon` | Repository root; `pnpm build` | `apps/mini-app/dist` | `fxaeon.com`, `www.fxaeon.com` |
| Landing | `fxaeon-landing` | `apps/landing`; `node build.mjs` | `dist` | `fxaeon.xyz` |

Configuration lives in the [root Wrangler file](../wrangler.toml), [landing Wrangler file](../apps/landing/wrangler.toml), and [production workflow](../.github/workflows/deploy-mini-app.yml). These are Pages applications; `wrangler deploy` is a different Workers deployment path.

## Configuration

The app consumes `NEXT_PUBLIC_*` settings at build time. GitHub Secrets protect their configuration in Actions, but the compiled values are public. Restrict browser credentials by origin, chain, and quota. A Pages runtime variable cannot rewrite a previously built bundle.

| Setting | Production storage | Use |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | GitHub secret | Intended production Privy application |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | GitHub secrets | Primary restricted chain endpoints |
| `NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL` | Optional GitHub secrets | Secondary Alchemy endpoints |
| `NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_INFURA_BASE_RPC_URL` | Optional GitHub secrets | Secondary HTTP endpoints |
| `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY` | GitHub secret | Public wallet-token discovery credential |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | GitHub variable | Clean bot/Mini App launcher |
| `TELEGRAM_BOT_TOKEN` | GitHub and Pages server secret | Bot metadata, command replies and opted-in invitations; never a public build input |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | GitHub secrets | Pages artifact upload and optional secret synchronization |
| `ETHERSCAN_API_KEY` | Optional GitHub/Pages production secret | Read-only app gas Function |
| `NEXT_PUBLIC_TELEGRAM_ADMISSION` | GitHub variable, `on` or unset | Telegram admission gate in front of Privy; off until the D1 binding is deployed |
| `TELEGRAM_BOT_ID` | Pages secret, synced by the release workflow | The bot’s public numeric ID, derived from `TELEGRAM_BOT_TOKEN`; identity verification does not use the token |
| `LIVE_GAS_ORACLE_URL` | Workflow environment | Probe destination only; does not configure the Function |

The Cloudflare token needs Pages Edit on the deployment account. Privy must allow the intended origins and Ethereum/Base configuration. The local-development app ID in the example is rejected by production validation.

[validate_production_env.mjs](../scripts/validate_production_env.mjs) requires the intended Privy ID, both primary Alchemy endpoints, Data API key, Telegram URL, and bot token. It validates supplied optional endpoints and rejects placeholders. It also rejects populated `NEXT_PUBLIC_FX_SCREENSHOT_*`, `NEXT_PUBLIC_FX_LOCAL_FORK_*`, and `NEXT_PUBLIC_FX_ANVIL_*` families. Keep local fixture settings out of all deployed environments.

The validator checks its supplied process environment; it does not inspect dashboard values or load Next's local environment files. A structurally valid endpoint is not proof of live service health or quota.

For each chain, HTTP/SDK reads prefer primary Alchemy, then Infura, then Alchemy2. WebSocket reconnects can rotate primary Alchemy to Alchemy2. Changing a subscription plan does not change this configured ordering.

## Preview environments

Cloudflare Git previews build independently and do not inherit GitHub Actions secrets. Set Preview variables deliberately. An empty Privy ID produces browser mode, even with Telegram launch hints; a passing placeholder/credential-free build does not prove configured Telegram authentication.

Record the preview revision and which services are configured before testing. Browser/provider mocks and module-load checks can validate narrower behavior, but do not substitute for live authentication or device evidence.

Disable automatic production Git deployments for the financial app before using the verified-artifact workflow. Ensure an older production build is not still running. Keeping Git previews enabled is compatible with that separation.

## Production release sequence

The [deployment workflow](../.github/workflows/deploy-mini-app.yml) starts after [Client CI](../.github/workflows/ci.yml) completes successfully for a push to `main`, or by manual dispatch on `main`. A CI-triggered deployment checks out the exact SHA tested by that run, and verifies it still matches remote `main` before building and again before upload. If a newer commit reaches `main` while an older CI run is finishing, the older deployment stops instead of replacing it. A manual dispatch runs the full `pnpm verify` suite itself.

Verification runs in a digest-pinned official Playwright image with browsers and system libraries already installed. The workflow still selects Node 22 and pnpm 11.19.0, and explicitly uses Bash for deployment conditionals. Keep its image version aligned with `@playwright/test`; the [testing guide](testing.md#ci-topology) describes the version contract.

1. Install the pinned toolchain and frozen dependency graph.
2. Confirm the release SHA is still remote `main` and validate protected production inputs.
3. For manual dispatch, run `pnpm verify` using its credential-free test configuration. For push deployment, require successful Client CI for the same-repository `main` SHA instead of repeating that suite.
4. Build the landing export and a separate production-configured financial export (`pnpm build:landing`, then `pnpm build`). The artifact scanner checks both output directories, even though this workflow uploads only the financial export.
5. Scan the built output, verify supplied RPC endpoints are actually compiled into browser chunks, and enforce existing bundle/CSP budgets.
6. Stamp the artifact with the release SHA and synchronize the optional gas secret.
7. Check that the release SHA is still remote `main` immediately before upload.
8. Upload the prebuilt artifact with Wrangler Pages, including root Functions.
9. Verify deployed revision, gas response/configuration, and expected public Privy configuration.
10. Synchronize Telegram bot metadata and its default Mini App menu.

This uploads an existing export; Cloudflare does not rebuild it. Custom domains and bindings remain attached to the Pages project. Never replace this sequence with an unverified local upload during routine release work.

The CI verification export and production-configured export intentionally remain separate. Sharing the browser runtime does not make a credential-free verification bundle suitable for deployment. The typecheck stage uses the [direct compiler runner](../scripts/typecheck.mjs), which retains app, fork, and E2E checks while avoiding nested package-manager resolution.

[verify_built_rpc_config.mjs](../scripts/verify_built_rpc_config.mjs) requires each supplied RPC to appear as a complete string literal in exported browser JavaScript. HTML, source maps, manifests, and server output are insufficient. Diagnostics identify names/counts rather than endpoint values. The check proves inclusion, not live provider health, billing, or successful failover.

Current budgets in [check_bundle_size.mjs](../scripts/check_bundle_size.mjs) are 12 MiB total assets, 8 MiB raw JavaScript, 3 MiB gzipped JavaScript, and 2 MiB for one JavaScript asset. Source maps and forbidden telemetry also fail. These are guardrails, not performance benchmarks; do not raise them to bypass a regression.

## Read-only Functions

### Financial app gas

The root `functions/` directory is deployed with the financial export. `/api/gas` reads a fixed Ethereum oracle and has no protocol planning/signing authority.

A missing `ETHERSCAN_API_KEY` or unavailable upstream returns the same `503 {"error":"gas oracle unavailable"}`. The public response cannot distinguish these causes. The release workflow can continue with the app's bounded RPC gas fallback when the optional binding is unavailable; when secret synchronization succeeds it requires the configured oracle check.

`LIVE_GAS_ORACLE_URL` selects a probe URL only. Changing it does not supply the API key.

### Landing market data

Deploy from `apps/landing` so Pages discovers `apps/landing/functions/api/market-data.ts`. Uploading only static `dist` from an unrelated root omits that Function.

The endpoint uses fixed public display feeds without credentials. The browser calls the same origin; unavailable/expired values stay unavailable. The landing does not initialize the wallet or SDK. See the [landing package guide](../apps/landing/README.md) for exact data validation and cache bounds.

The landing build image/install controls are recorded in its Wrangler configuration. Keep those controls there instead of duplicating conflicting dashboard values. Its only optional public build setting is the Telegram launcher.

## Telegram settings

Bot synchronization does not configure BotFather's native Main Mini App/profile launch button. Set those explicitly and verify real `startapp` entry on a phone.

The bot menu contains `/start`, `/help`, and `/support`. The production release installs the authenticated `/api/telegram-bot` webhook after deploying its handler. Synchronization refuses to replace a webhook belonging to another service. Replies are limited to private chats, with durable update deduplication and per-chat limits; commands never approve admissions or submit transactions. The chat menu's **Open FxAeon** button remains available.

Public web mode and Telegram Privy mode have different configuration and identity paths. Changing provider settings does not migrate accounts or move funds.

### Telegram admission and waitlist

The passkey flow uses verified Telegram identity and user-owned Privy wallets. Everyone joins a waitlist first. Explicit operator approval reserves a permanent database seat before an invitation or wallet creation. The limit is 480 including the monotonic legacy baseline; repeated approval does not consume duplicate seats. Delivery failure does not revoke approval.

Provider public signup must be closed and the provider inventory reconciled before activation. A browser gate or configuration assertion alone cannot enforce this boundary. The provider application credential transports requests and is never a wallet owner or additional signer. Keep all server credentials out of static builds and generated plaintext configuration.

Configuration sync proves saved settings, not an already deployed worker's bindings. A verified release must package the reviewed runtime configuration, deploy the intended revision, and verify authenticated runtime behavior before enrollment expands. Physical-device passkey handoff and live-provider entitlement require separate evidence; synthetic tests do not establish them.

Rollback must preserve reservations and keep public signup closed. Never recycle seats, replace owner keys or external wallet identities, or alter the legacy baseline to bypass a capacity check. Unknown transaction outcomes must be reconciled without automatic resubmission. Losing every copy of a synced passkey or access to the Telegram account has no implemented recovery path.

Account inventories, approval identities, provider configuration procedures and operational checklists belong in private operator records. Keep them out of public issues, workflow inputs, logs and artifacts. The older admission compatibility endpoint cannot enforce a provider signup cap and must not substitute for the passkey flow. See the [security model](security.md) for the public controls and their limits. Security depends on enforced authorization and database/provider constraints, not on keeping these procedures private.

## Rollback and diagnosis

Select a known-good Pages deployment for rollback, then make a corrective `main` commit so the next workflow and repository agree with the restored revision.

| Failure | Investigate |
| --- | --- |
| Wrong deployed revision | Workflow source SHA, remote-head guard, artifact stamp, concurrent/automatic Git deployment |
| Missing production RPC/Privy input | Build-time workflow environment and built-config verification; runtime bindings cannot repair static JS |
| Preview has no Privy | Preview build variables, allowed origin, and actual Telegram launch data |
| Gas unavailable | Optional Pages binding and upstream; keep the fallback/absence visible |
| Landing figures unavailable | Correct Function root, fixed upstream health, validated freshness |
| Telegram launcher/menu differs | BotFather Main Mini App plus workflow metadata/menu synchronization |
| Bundle exceeds budget | Measure the production artifact and reduce real duplication/imports; preserve the gate |

Finish with the [release checklist](launch-readiness.md). Record evidence for this exact revision using the [testing guide's evidence requirements](testing.md#evidence-boundaries).
