# FxAeon landing site

The independent public site at [fxaeon.xyz](https://fxaeon.xyz) introduces Trade, Earn, Borrow, and Move, then links to the financial app at [fxaeon.com](https://fxaeon.com) and its Telegram Mini App.

The page is static. A same-origin Pages Function supplies validated public display data. The site does not initialize a wallet, authenticate an account, or create protocol transaction plans.

## Build and preview

From the repository root:

~~~sh
pnpm build:landing
pnpm preview:landing
~~~

Or without installing workspace dependencies:

~~~sh
cd apps/landing
node build.mjs
node serve.mjs
~~~

Output is `dist/` relative to this package. The local server listens at [localhost:4173](http://localhost:4173), or `PORT`, and also serves `/api/market-data`.

Browser script and stylesheet URLs share a content version, including calculator-module imports. Unchanged builds retain URLs; browser-code or stylesheet changes update the graph's version.

## Entry and configuration

`NEXT_PUBLIC_TELEGRAM_APP_URL` optionally selects the bot or named Mini App launcher at build time. It must use the accepted HTTPS `t.me` format; the build validates it and generates the QR code from the same URL. No Privy ID, RPC endpoint, or secret is needed.

The hero keeps web and Telegram launch actions at every viewport size. Four product cards link directly to their web routes. The amount explorer, Telegram section, and footer preserve later entry points. Navigation uses a native modal dialog on widths up to 760px, with focus handling, close control, link dismissal, and Escape behavior.

## Display data and scenarios

The browser requests only same-origin resources. [functions/api/market-data.ts](functions/api/market-data.ts) reads fixed public upstreams without API keys.

| Value | Validation |
| --- | --- |
| fxSAVE APY and TVL | Official Aladdin `concentrator_aToken_tvl_apy` feed and verified fxSAVE contract `0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39` |
| APY/TVL freshness | Feed has no source-update timestamp; expires five minutes after the server check |
| ETH/BTC prices | DefiLlama address-keyed WETH/WBTC quotes, confidence at least 0.5 |
| Price timestamps | At most five minutes old and at most two minutes in the future |

Upstream reads have an eight-second deadline and a 256 KB body cap. Validated responses cache for at most 60 seconds. One source's failure does not erase another valid source. Invalid/expired figures become unavailable; they are never replaced with sample data.

Value title metadata retains provider and relevant check/source times. Retry appears when needed or while a manual retry runs. These are display values, not execution oracles.

The “What your crypto can do” calculator uses one labelled starting value and $100/$1,000/$10,000 presets:

| Scenario | Meaning |
| --- | --- |
| Earn | One-year projection assuming current fxSAVE APY stays unchanged |
| Borrow | Illustration at 50% loan-to-value |
| Trade | ETH long gross exposure under a selected leverage and ±10% ETH move |

Scenarios are not account balances, executable quotes, live borrowing limits, or liquidation estimates. The calculator connects to no wallet. Changes to its controls do not create a transaction plan.

## Artwork, typography, and motion

The cream-and-cobalt site uses self-hosted Inter for body text and Manrope for display text, with their OFL notices. The footer shares those fonts, avoiding a third family. Primary brand blue and contrast variants follow [brand guidance](../../docs/brand-assets.md). Retired artwork and unused legacy fonts are excluded from output.

The full-width cobalt hero assembles the two FxAeon shapes once. Product tiles link directly to the app, using local vector token and chain artwork. On phones they form a native swipe rail, with named selection buttons and preserved vertical scrolling. The hero and product discovery contain no simulated form, balances, or quotes. Menu transitions, interruptible calculator changes, and one-time section entrances respect live reduced-motion preferences. Keyboard focus reveals content immediately. The retired sculpture renderer and its fallback images are not shipped in the landing build.

## Social preview

Both public sites use the same checked-in 1200×630 image:
`assets/social-preview.png` here and
`apps/mini-app/public/social-preview.png` in the financial app. The editable
composition is [design/social-preview.html](design/social-preview.html).
It uses the local mark, Manrope font, and sculpture fallback.

Regenerate from the repository root with the workspace's Playwright browser:

~~~sh
node scripts/render_social_preview.mjs
~~~

The [renderer](../../scripts/render_social_preview.mjs) captures the composition
and copies the identical PNG to both locations. Inspect and commit both copies
together. Normal builds copy the existing image, and requests serve a static
asset; no runtime image generation is needed. Social-profile banner and avatar
artwork is separate; see [brand assets](../../docs/brand-assets.md).

## Hosting

The landing is the separate `fxaeon-landing` Pages project with root `apps/landing`, command `node build.mjs`, output `dist`, and domain `fxaeon.xyz`.

Deploy from this package root, or use Wrangler's `--cwd apps/landing`, so Pages discovers its Functions directory. A static-only `dist` upload from the wrong root omits market data. The page remains usable, with affected live figures unavailable.

[wrangler.toml](wrangler.toml) records Node `22.23.2` and `SKIP_DEPENDENCY_INSTALL=true`; avoid conflicting dashboard duplicates. The financial app uses a different project/root. See [deployment](../../docs/deployment.md).

## Verification

~~~sh
pnpm test:landing
pnpm test:landing:browser
~~~

Static tests cover routing and launcher parity, semantic markup, build output, licenses, CSP/headers, data validation and freshness, partial failures, races, offline and resume, and response bounds. For the redesigned hero, build and serve the landing and run the direct Playwright check:

~~~sh
node apps/landing/build.mjs
node apps/landing/serve.mjs
# In another terminal, with the existing mini-app dependencies available:
node apps/landing/test/verify-discovery.mjs
node apps/landing/test/verify-motion.mjs
~~~

The repository-level `test:landing:browser` verifier covers product discovery, responsive layout, keyboard navigation, contrast, and calculator and market-data behavior. The landing-local checks also cover product links, asset loading, native phone swipes, first/last snap alignment, interrupted menu and calculator transitions, live reduced motion, and the no-JavaScript fallback. Set `LANDING_URL` to the running preview URL for either local check (motion defaults to port 4355). Local viewport captures and the motion walkthrough in `review/` are excluded from version control.

These checks establish the tested behavior and layout, not conversion uplift, protocol execution, or production wallet state.
