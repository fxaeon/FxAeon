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
| Telegram bot avatar | [`assets/brand/fxaeon-bot-avatar-1024.png`](assets/brand/fxaeon-bot-avatar-1024.png) and [SVG export](assets/brand/fxaeon-bot-avatar.svg) | 1024×1024 opaque square, original app ribbon paths; padded for Telegram's circular crop |
| Shared site preview | `apps/landing/assets/social-preview.png` and `apps/mini-app/public/social-preview.png` | Identical 1200×630 Open Graph/X preview for both sites; separate from social-profile artwork |

The token/chain marks come from the SmolDapp asset CDN and AladdinDAO assets.
Unknown token symbols use the app's text fallback instead of being presented as
official artwork.

FxAeon's primary brand blue is `#2973FF` across the landing site, app, and docs.
Filled primary actions use the darker `#2563eb` with white text for contrast;
small accent text uses `#7da5ff` on dark surfaces. These accessible variants
are defined in the existing semantic tokens. Success, warning, danger, token,
and network colors keep their separate meanings or identities.

## Messaging and profile handoff

Use `docs/assets/brand/fxaeon-bot-avatar-1024.png` as the Telegram profile photo.
The existing ribbon remains unchanged; the export adds a neutral `#080808`
canvas and circle-safe padding. It contains no small lettering or new symbol.
The supplied social masters remain unchanged. This asset is for manual profile
review and application; the renderer never updates a profile or sends messages.

Recommended Telegram dashboard copy (plain text; dashboard descriptions do not
use reply formatting):

- **Name:** FxAeon
- **About / short description:** Trade, earn, borrow and move assets. Your onchain workspace, in Telegram.
- **Description:**

  ```text
  Your onchain workspace, in Telegram.

  Trade ETH and BTC positions, earn with fxSAVE, borrow fxUSD, and move assets between Ethereum and Base.

  Open FxAeon to check your access or join the waitlist.
  Guides: https://fxaeon.com/docs
  Support: support@fxaeon.com
  ```

The deployment metadata in `scripts/sync_telegram_bot.mjs` must be aligned by
the profile owner before a later sync, otherwise it will restore its existing
description. No sync or dashboard change is part of this export.

Command replies live in `server/miniapp-access/bot.ts`. Only their first line
is bold, via Telegram entities; paragraphs separate the next action from help.
Every reply keeps the direct `web_app` button at `https://fxaeon.com/`.

`renderNotificationEmailV2` in `server/miniapp-access/notifications.ts` provides
the HTML and plain-text verification/invitation designs. It intentionally is
not selected by dispatch yet. Activation requires a persisted enqueue-time
template version, owned by the queue/security work. Retain the legacy payload
for every previously enqueued row and every retry under its existing Resend
idempotency key. Never reset keys or infer template versions from attempt count:
a first attempt can become ambiguous across a deployment. Freeze v2 subject,
body, fallback URL, expiry and headers for retries once activated. Verification
copy uses the stored expiry in UTC; invitation copy claims no expiry.

Regenerate with the workspace's Node 22, pnpm 11.19 dependencies and Playwright:

~~~sh
node scripts/render_messaging_brand.mjs
~~~

The standard Chromium renderer exports the square SVG/PNG above and writes
synthetic review files only under `~/.codex/private/fxaeon-messaging-polish/`:
circle crops at 32/48/128px, a crop contact sheet, Telegram reply and profile
mockups at 390px, HTML email views at 320/390/560px, and HTML/plain-text phone comparisons.
These are browser mockups, not proof of a native Telegram or inbox rendering.
The renderer blocks network requests and uses no real recipient or valid token.
Keep these email previews private and out of commits. The template contains no
tracking pixels, remote images, remote fonts or link rewriting. Provider-side
tracking settings must also remain off when activated.

### Email sender avatars

An HTML logo or uploaded PNG does not control the inbox sender avatar. Resend
requires a [verified sending domain](https://resend.com/docs/dashboard/domains/introduction);
this is distinct from mailbox-provider logo display. [Gmail's official BIMI guide](https://knowledge.workspace.google.com/admin/security/set-up-bimi)
requires DMARC enforcement (`p=quarantine` or `reject`, `pct=100`), a VMC or CMC,
and a compliant hosted SVG Tiny PS logo. Its VMC checkmark is separate from
logo display. The supplied general-purpose SVG/PNG is not certified BIMI artwork.
[Apple Mail](https://support.apple.com/en-us/108340) also requires both sender
and email-provider support. Eligibility and appearance depend on the receiving
provider; no avatar display is guaranteed by this change. The parent can review
the verified sending domain and provider requirements separately before making
any DNS, certificate or dashboard changes.

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
