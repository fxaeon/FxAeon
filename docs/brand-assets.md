# Brand assets

Use the FxAeon mark for product identity and protocol/token marks only to
identify their assets. Do not imply that an asset mark is the FxAeon brand.

## Sources and use

| Asset | Source | Use |
| --- | --- | --- |
| FxAeon application mark | `apps/mini-app/public/icon.svg` | App icon and product identity |
| Landing mark | `apps/landing/assets/fxaeon-mark.svg` | Landing header, footer, finale, and favicon; its paths match the app mark |
| Token and chain marks | `apps/mini-app/public/token-icons/` and `chain-icons/` | Vendored token/network identity; the landing copies use the same app files |
| Telegram QR code | Drawn by `apps/landing/qr.mjs` during the landing build, from the configured launcher URL, as `assets/telegram-qr.svg` in `dist/` | Opens the same bot link as the Telegram buttons |
| Supplied social banner and profile image | [`assets/social/`](assets/social/) | Social-profile artwork; keep the supplied masters unchanged |
| Shared site preview | `apps/landing/assets/social-preview.png` and `apps/mini-app/public/social-preview.png` | Identical 1200×630 Open Graph/X preview for both sites; separate from social-profile artwork |

The token/chain marks come from the SmolDapp asset CDN and AladdinDAO assets.
Unknown token symbols use the app's text fallback instead of being presented as
official artwork.

FxAeon's primary brand blue is `#2973FF` across the landing site, app, and docs.
Filled primary actions use the darker `#2563eb` with white text for contrast;
small accent text uses `#7da5ff` on dark surfaces. These accessible variants
are defined in the existing semantic tokens. Success, warning, danger, token,
and network colors keep their separate meanings or identities.

## Site social preview

The editable composition is
[`apps/landing/design/social-preview.html`](../apps/landing/design/social-preview.html).
It uses the current mark, local Manrope font, and original sculpture fallback.
From the repository root, regenerate both copies with:

~~~sh
node scripts/render_social_preview.mjs
~~~

The [development renderer](../scripts/render_social_preview.mjs) requires the
workspace's Playwright browser. It captures at 1200×630 and copies the same PNG
to both sites. Inspect the result and commit both images together. The deployed
sites serve these checked-in assets; neither a request nor a normal site build
generates a social image. Social-profile banner and avatar masters remain
separate assets.

## Theme and layout

The app and landing use a single neutral dark appearance. Earlier saved app
appearance preferences migrate to dark without changing transaction settings.
Use the existing semantic tokens instead of adding a parallel palette.

Keep landing navigation and entry actions readable independently of decorative
artwork. Motion must respect reduced-motion preferences and stop when its
section is offscreen or the document is hidden. When changing artwork,
typography, or layout, run `pnpm test:landing:browser` and inspect actual phone
and desktop renders, including reduced motion and unavailable market data.

## Screenshots

Earlier repository READMEs used four images retained in [`assets/readme/`](assets/readme/). The current README uses the original application mark; these captures remain historical assets:

- **Hero** (`hero-dark.webp`, `hero-light.webp`). Historical landing exports at 1440×720 and 2×. The filenames describe earlier appearance modes, not current theme support.
- **Screens** (`screens-dark.webp`, `screens-light.webp`). Historical Portfolio, Trade, Earn and Borrow renders with deterministic sample data at 390×844 and 2×. No wallet, chain or price feed was involved, and every number on them is a sample.

Do not use these historical exports as proof of the current interface. Capture
the current dark appearance when updating public product screenshots, and
record whether each capture uses live data or a deterministic fixture.

Standard app screenshots are listed with routes, viewports, capture context,
and hashes in [`fixtures/standard-screenshot-manifest.json`](fixtures/standard-screenshot-manifest.json).
They show rendered UI with live external display data; no transaction was
submitted.

Populated position screenshots are separate. Their
[`position-screenshot-manifest.json`](fixtures/position-screenshot-manifest.json)
is authoritative for the browser-fork provenance, pinned block, verified
ETH/BTC long/short positions, captures, and restored snapshot state. Displayed
prices and charts are illustrative and visibly labelled. The landing page does
not embed the populated position screenshots. Those screenshots document a test fixture,
not production balances or market-price evidence.
