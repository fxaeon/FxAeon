# Changelog

All notable changes to FxAeon are documented here. The project currently maintains an unreleased integration line; versioned release notes will be added when a public release is cut.

## [Unreleased]

### Added

- An entry price and estimated PnL for each position, worked out from its orders on the f(x) index the way the official f(x) app does and taken at the SDK's DEX mid price. They show only once the index matches the chain, and exclude fees and exit costs.
- The rebalance price (f(x)'s liquidation brake) in the Trade ticket's preview, ahead of the liquidation price, and on Borrow position cards.
- A leverage slider on Trade drawn as the position's split between debt and your share, still a native slider in leverage units.
- An outcome preview on the Trade ticket: the estimated collateral, estimated debt and protocol fee rate of the route its review would open.
- A rebalance marker on each position row, read live from the position's debt ratio and its pool's rebalance and liquidation thresholds, with one line saying how far the price can move first.
- A confirmed open on Trade titled after the action, such as "Opened ETH Long", with the new position shown as its row; viewing it carries the chosen split into the position.
- Reviews that say how much ETH to add, once the fee is known, when the wallet cannot cover network fees, with a Receive ETH link.
- Telegram start parameters that open a fixed list of app screens, used by the landing's section links on phones.
- A fullscreen landing menu, with the bot's QR code on desktop and Open in Telegram on phones.
- First-class browser launch and authentication alongside the Telegram Mini App experience.
- Professional repository presentation with real workflow badges and product screenshots.
- Deterministic route and wallet-runner chaos campaigns.
- Opt-in Anvil fork coverage for randomized snapshot/revert and ordered-route execution.
- Recovery handling for pending transaction and bridge records after a reload.
- Production configuration and bundle-budget checks for the static release artifact.

### Changed

- Without a live market quote, a position's estimated rebalance and liquidation prices show the pool's own price per stETH or WBTC instead of a dash.
- Position cards are now compact borderless rows. On a phone, a row opens its position with Add, Reduce, Leverage and Close, and Back returns to the list.
- ETH long collateral reads in stETH, the unit the pool records. New collateral estimates are converted from wstETH at the live rate, and signed wstETH minimums show their stETH equivalent.
- Receipts of ETH-paid actions state the ETH sent instead of saying token movements could not be established.
- Reviews show inputs, approvals and signed minimums exactly, round cost estimates up, show the network fee maximum the wallet must fund, and state Borrow's loan-to-value.
- Loading states draw the page they become, failed reads say so with Try again instead of shimmering or showing zero, and empty states name the next step.
- The header stays on one row from 280px wide, the first tab is named Portfolio, disabled actions keep at least 4.5:1 contrast, and route titles and focus rings follow one scale and one accent.
- Earn compares a withdrawal with the exact share balance, Enter in an amount opens the review, and each action page's steps and questions moved to Docs.
- The fxUSD stability pool share is named fxSP, as wallets and explorers show it.
- History titles name positions as their rows do.
- The landing leads with the web app and a Telegram QR code on desktop, and with Telegram on phones.
- Dialogs keep focus where a person already put it when they open.
- Standardized the product on the official f(x) SDK capability boundary.
- Consolidated reads, SDK transaction planning, simulation, and explicit signing in one static web and Telegram application.
- Reworked transaction review, wallet connection, bridge progress, unavailable states, and mobile accessibility.
- Standardized releases on a reproducible Cloudflare Pages static export with frozen pnpm installs.
- Pinned `@aladdindao/fx-sdk@1.0.5` with the reviewed upstream short-pool fix until that fix is released through npm.

### Removed

- The leverage explainer's own Long/Short example switch; its examples follow the ticket's side.
- Images that no page used, from the landing and app builds.
- The application backend, delegated/session signer, database, Redis, workers, queues, price feeds, analytics, and unsupported trading features.
- Lighthouse CI and other checks that did not reflect the static client release boundary.

### Security

- Privy remains the only transaction authority; no private key is accepted or stored.
- Every SDK-produced transaction is independently reviewed, simulated, explicitly approved, receipt-checked, and followed by a fresh chain/SDK read.
- Rejection, revert, timeout, and nonce drift stop a route before later steps are submitted.
- No Privy secret, Telegram bot token, provider credential, or other signing authority is accepted by the static build.
- A Telegram start parameter can open only a screen on a fixed list of same-origin paths; any other value is ignored.

## Historical architecture

Earlier commits contained experimental bot, API, delegated execution, persistence, and automation designs. They are retained in Git history for provenance only and are not supported FxAeon capabilities.
