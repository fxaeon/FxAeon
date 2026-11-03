# Telegram Mini Apps SDK

Official Telegram Messenger source with the security patches below, MIT licensed
(see LICENSE). This is the official Bot API 7.0 release, not the current hosted SDK.

- Upstream: https://github.com/TelegramMessenger/TGMiniAppsJsSDK
- Pinned commit: e086c60734519ff816c3af5cf95def3edd7d12fc (Bot API 7.0 release)
- Source: https://raw.githubusercontent.com/TelegramMessenger/TGMiniAppsJsSDK/e086c60734519ff816c3af5cf95def3edd7d12fc/telegram-web-app.js
- Raw upstream SHA-256: fd5e505fa90dba9312fdc2fa679f5e340c2f38a7fddbf1db8b53b26b32139159
- Patched SHA-256: b317829a04cec83bafdaff23c153b9d66498ddd1b1ab887b2b1edd4e695c03da

Audited local changes:

1. Skip both SDK initializers on `/wallet-approval` and `/invite` (also trailing
   slash and `.html` variants). Their capability fragments must remain in memory
   only; the upstream initializer otherwise caches the entire fragment in sessionStorage.
2. Log event names only in `postEvent` and `receiveEvent`. Never log payloads,
   which can contain the complete browser handoff capability URL.
3. Target all three iframe `postMessage` calls at `https://web.telegram.org` and
   accept parent events only from both that exact origin and `window.parent`.
   Native proxy/notify transports are unchanged.

Served from the application origin before hydration so blocked access to
telegram.org cannot prevent the bridge from initializing. This release includes
the platform/initData, native openLink, write-access, viewport, theme, back-button
and haptic APIs used by this app. Later optional APIs remain feature-detected:
`setBottomBarColor` (7.10), safe-area and newer device APIs are absent. The current
canonical telegram.org source could not be retrieved from this network; no
third-party mirror or unverified replacement was used.
Never use SDK platform hints or initDataUnsafe as authentication proof: the server
still verifies signed launch data and enforces admission and wallet authorization.

Update only from a reviewed official source; retain the license, record the commit
and checksum, and rerun the real-SDK production-export regression.
