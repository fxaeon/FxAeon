# Brand assets

Use the FxAeon mark for product identity and protocol/token marks only to
identify their assets. Do not imply that an asset mark is the FxAeon brand.

## Sources and use

| Asset | Source | Use |
| --- | --- | --- |
| FxAeon application mark | `apps/mini-app/public/icon.svg` | App icon and product identity |
| Landing mark | `apps/landing/assets/fxaeon-mark.svg` | Landing header, footer, finale, and favicon; its paths match the app mark |
| Token and chain marks | `apps/mini-app/public/token-icons/` and `chain-icons/` | Vendored token/network identity; the landing copies use the same app files |
| Telegram QR code | Drawn by `apps/landing/qr.mjs` during the landing build, from the configured launcher URL, as `assets/telegram-qr.svg` in `dist/` | Landing hero and menu on desktop; opens the same bot link as the buttons |
| Supplied social banner and profile image | [`assets/social/`](assets/social/) | Social exports; keep the supplied masters unchanged |
| App social-preview image | `apps/mini-app/public/landing/fxaeon-banner.png` | Open Graph/Twitter metadata, not the visible landing hero |

The token/chain marks come from the SmolDapp asset CDN and AladdinDAO assets.
Unknown token symbols use the app's text fallback instead of being presented as
official artwork.

FxAeon's primary brand blue is `#2973FF` across the landing site, app, and docs.
Filled primary actions use that exact blue with near-black `#0b0c0e` foreground
text for contrast. Small accent text on light surfaces may use the darker
accessible blue `#1d4ed8`; this is an accessibility adjustment, not a second
brand color. Success, warning, danger, token, and network colors keep their
separate meanings or identities.

## Theme and layout

The app supports official dark, neutral dark, and light appearance modes. The
landing site has coordinated dark and light modes. Use existing semantic
tokens in the app and landing stylesheets instead of adding a parallel color
palette.

The landing header is transparent over the aurora, with a soft sky scrim that
keeps its brand and controls legible on any frame, and gains a blurred surface
once the page scrolls. Its navigation lives in a fullscreen menu. Respect
reduced-motion preferences.
When changing the aurora, overlays, typography, colors, or theme behavior,
rerun `pnpm test:landing:browser` (it measures text contrast against the
painted aurora) and review both themes on mobile and desktop.

## Screenshots

The repository README uses four images in [`assets/readme/`](assets/readme/):

- **Hero** (`hero-dark.webp`, `hero-light.webp`). The landing page's own hero at 1440×720 and 2×, with its header controls, buttons and QR code hidden, in each theme.
- **Screens** (`screens-dark.webp`, `screens-light.webp`). The real Portfolio, Trade, Earn and Borrow pages, rendered against deterministic sample data with reduced motion at 390×844 and 2×. No wallet, chain or price feed was involved, and every number on them is a sample.

Recapture all four whenever those pages or the landing hero change visibly.

Standard app screenshots are listed with routes, viewports, capture context,
and hashes in [`fixtures/standard-screenshot-manifest.json`](fixtures/standard-screenshot-manifest.json).
They show rendered UI with live external display data; no transaction was
submitted.

Populated position screenshots are separate. Their
[`position-screenshot-manifest.json`](fixtures/position-screenshot-manifest.json)
is authoritative for the browser-fork provenance, pinned block, verified
ETH/BTC long/short positions, captures, and restored snapshot state. Displayed
prices and charts are illustrative and visibly labelled. The landing page
renders app screens in HTML/CSS with example values, described as examples to
assistive technology; it does
not embed the populated position screenshots. Those screenshots document a test fixture,
not production balances or market-price evidence.
