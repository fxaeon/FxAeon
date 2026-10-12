# FxAeon landing

Standalone, dependency free static landing page for `fxaeon.xyz`. It introduces Trade, Earn, Borrow, and Move on f(x) Protocol and links to the app at `https://fxaeon.com/` or its Telegram Mini App.

## Preview and build

```sh
cd apps/landing
node build.mjs
node serve.mjs
```

The build writes the static site to `dist/`; the preview server listens at `http://localhost:4173` (or `PORT`). Any static host can deploy `dist`. The build needs Node.js, not installed package dependencies. The landing owns its checked-in illustrations and icon SVGs, copies the official protocol mark from the mini app, and generates the Telegram QR SVG from the same configured launcher used by the page links.

From the repository root, use `pnpm build:landing` and `pnpm preview:landing`. For Cloudflare Pages set the root directory to `apps/landing`, build command to `node build.mjs`, and output directory to `dist`. Attach only `fxaeon.xyz` to this project; `fxaeon.com` belongs to the financial app project. The Wrangler config pins the Pages build image to Node `22.23.2` and sets `SKIP_DEPENDENCY_INSTALL=true`. Keep those controls in `wrangler.toml` instead of duplicating them in dashboard variables. Set the Pages build watch include path to `apps/landing/*` and leave excludes empty.

Set `NEXT_PUBLIC_TELEGRAM_APP_URL` at build time to the bot or named Mini App launcher, such as `https://t.me/<bot>[/<app>]`, optionally with one `startapp` value. The build validates that URL and uses it for the Telegram actions and QR code. Product cards open the matching web route on desktop and the corresponding `startapp` route in Telegram on phones and tablets.

## Page behavior

The visual design uses a midnight-plum background with lilac accents and no announcement bar. The dark theme is the default. The footer theme button switches between dark and light and remembers the choice in local storage. On narrow screens, a native modal dialog holds the navigation links; the browser provides modal focus handling and Escape behavior. The menu opens from the header button, and its close button or a navigation link closes it. At widths up to 760 pixels the inline desktop navigation is replaced by the menu. The app and Telegram actions follow the existing CSS capability query `(hover: hover) and (pointer: fine) and (min-width: 861px)`; no user-agent detection is used.

The page contains one portfolio illustration, four product cards, protocol and wallet-control information, a Telegram preview, and native FAQ disclosures. The illustrated balances and screens are examples, not live account data or controls. Product risk notes explain liquidation risk, variable savings yields, fees, and network costs. Manrope is self-hosted for headings, Poppins for body text, and Inter for the phone preview; each font is shipped with its OFL license. The page uses no remote font, analytics, API, or other external service.

`script.js` handles theme persistence, menu state, and the footer year. Reduced-motion preferences disable transitions and animations and turn off smooth scrolling. Both scripts and styles are external files under the strict policy in `_headers`: no inline code or styles and no network connections.

## Verification

`pnpm test:landing` checks product links and copy, device routing, keyboard-accessible markup, menu and theme behavior, reduced-motion rules, CSP and static headers, Telegram URL validation and QR parity with the app's pinned encoder, the standalone no-dependency build, icon SVGs and their source license, and that shipped assets are referenced. `pnpm test:landing:browser` checks responsive routing, overflow and text contrast in both themes, theme persistence, menu keyboard behavior, reduced motion, basic product coverage, and the absence of external requests.
