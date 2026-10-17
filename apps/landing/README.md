# FxAeon landing

Standalone static landing page for `fxaeon.xyz`. It introduces Trade, Earn, Borrow, and Move on f(x) Protocol and links to the app at `https://fxaeon.com/` or its Telegram Mini App.

## Preview and build

```sh
cd apps/landing
node build.mjs
node serve.mjs
```

The build writes the static site to `dist/`; the preview server listens at `http://localhost:4173` (or `PORT`). It needs Node.js but no installed package dependencies. Any static host can deploy `dist`. For Cloudflare Pages set the root directory to `apps/landing`, build command to `node build.mjs`, and output directory to `dist`. The Wrangler config pins the Pages build image to Node `22.23.2` and sets `SKIP_DEPENDENCY_INSTALL=true`. Keep those controls in `wrangler.toml` instead of duplicating them in dashboard variables. Attach only `fxaeon.xyz` to this project; `fxaeon.com` belongs to the financial app project.

Set `NEXT_PUBLIC_TELEGRAM_APP_URL` at build time to the bot or named Mini App launcher, such as `https://t.me/<bot>[/<app>]`, optionally with one `startapp` value. The build validates that URL and uses it for the Telegram actions and QR code. Product cards open the matching web route on desktop and the corresponding `startapp` route in Telegram on phones and tablets.

## Visual and performance notes

The page uses a dark-only palette, Inter for interface copy, and Manrope for headlines and the wordmark. Both fonts are self-hosted with their OFL notices. Poppins files remain only as source inputs for the separate banner artwork and are excluded from the deployed site. Product illustrations and balances are examples, not live account data or controls. Risk notes explain liquidation risk, variable savings yields, fees, and network costs.

The hero field pairs a static SVG topographic fallback with a small original WebGL2 shader in `hero-field.js`. The shader is inspired by the calm layered field on [React Bits Aurora](https://reactbits.dev/backgrounds/aurora); no React Bits source or runtime is copied. The contour field is decorative and is skipped when WebGL2 is unavailable, reduced motion is requested, the visitor has enabled save-data, or the browser has scrolled it offscreen. It caps rendering at 30 frames per second and 1.2 device pixels per CSS pixel, and pauses when the tab is hidden or the page motion control is off. The effect never gates text or controls.

COSS UI informed the quiet neutral surfaces, typography, and outlined controls. React Bits informed the restrained reveal and shader treatment. Shaders.com was reviewed for its composable WebGPU effects, but its full JavaScript registry is not shipped because it would add about 2.5 MB minified for this single hero field. These are design references, not runtime dependencies. The page makes no remote font, analytics, API, or other service requests.

The mobile navigation uses a native modal dialog with browser focus handling and Escape behavior. The menu opens from the header button; its close button or a navigation link closes it. At widths up to 760 pixels the inline desktop navigation is replaced by the menu. App and Telegram actions follow the existing CSS capability query `(hover: hover) and (pointer: fine) and (min-width: 861px)`; no user-agent detection is used.

## Verification

`pnpm test:landing` checks product links and copy, device routing, keyboard-accessible markup, menu and dark-only behavior, reduced-motion rules, CSP and static headers, Telegram URL validation and QR parity with the app's pinned encoder, local font notices, the standalone build, icon SVGs and their source license, and that deployed assets are referenced. `pnpm test:landing:browser` checks responsive routing, overflow, menu keyboard behavior, reduced motion, basic product coverage, and the absence of external requests.
