# Wallet selection and mobile browser handoff

FxAeon uses a browser-only Wagmi session owner on ordinary web and its existing
Privy flow in Telegram. Shared Wagmi data clients remain read-only. Browser
signing configs use exactly one selected provider, with automatic discovery and
broad reconnect disabled. This change adds no wallet SDK, relay, QR
pairing, project configuration or metered connection service. Existing RPC
services and transaction gas are separate.

## One wallet choice, automatic routing

Every ordinary-web Connect action opens the same logo-and-name picker, even
when only one wallet is present. The initial picker is exactly MetaMask, Base
Wallet, OKX and Rabby, in that order. Searchable Other wallets includes Trust
Wallet, Phantom, Rainbow, Zerion and the primary choices, with a single row for
each catalog identity. Installed secondary, unknown and neutral legacy providers
remain under Other rather than expanding the initial four. The resolver always prefers
the precise announced provider object. An unannounced global provider is offered
only as a neutral Wallet, never as a named wallet fallback.

If the selected provider is absent, one click opens its reviewed official route:

| Wallet | Mobile route | Desktop route |
| --- | --- | --- |
| MetaMask | Wallet-browser universal link; official download fallback | Official extension download |
| Trust Wallet | Wallet-browser universal link; official download fallback | Official extension download |
| Phantom | Wallet-browser universal link; official download fallback | Official browser download |
| Rabby | Wallet-browser universal link; official download fallback | Official extension download |
| Rainbow | Wallet-browser universal link; official download fallback | Official extension download |
| Base Wallet | Official mobile app download page | Official extension download |
| Zerion | Official mobile app download page | Official extension download |
| OKX | Official wallet app download page | Official extension download |

The first five links continue in the wallet's browser when the installed app and
OS support their registered universal link. Their web fallbacks were inspected;
actual installed-phone dispatch is still a release test, not an established fact.
No maintained no-configuration browser link was verified for the last three, so
those rows open the official app page instead of inventing a connection route.
The historical Coinbase deep link is deliberately excluded until current device
behavior is verified.

Base Wallet is a display-label update only: its stable catalog ID is `coinbase`
and its injected identity remains `com.coinbase.wallet`. The existing provider
object and remembered account are retained across the browser lifecycle migration.
No Base Account, SDK or passkey flow is introduced. Current Base labels and
the Coinbase/Coinbase Wallet compatibility labels are reserved so unknown
self-attested names receive neutral labels instead of borrowing either brand.
The official [Coinbase downloads page](https://www.coinbase.com/wallet/downloads)
identifies the mobile app as Base App and still identifies its browser extension
as Coinbase Wallet. This picker uses the requested Base Wallet display label.

Unknown environments, including Android tablets presenting ambiguous desktop
hints, use platform-aware official app pages. Mobile and unknown environments
never receive extension-only URLs. Device hints choose navigation UX; they do
not detect installation. There is no timeout-based installed-app guessing.
Navigation runs directly in the click gesture. If the original tab remains
visible, an Open button can repeat that action, with Back and Close still usable.
No instructions-only dead end or manual connection-method selection is required.

A wallet-browser handoff opens a separate browser context. It cannot connect the
original Chrome/Safari tab or preserve an unsaved transaction form without a
session transport. The existing injected approval flow operates inside the wallet
browser; app opening or downloading is never described as an approved session.

The browser links use fixed wallet-app hosts and a fixed fxaeon.com destination.
Only `/`, `/earn`, `/trade`, `/borrow`, `/positions`, `/move` and `/send` survive;
other paths become `/`. Query parameters, fragments, Telegram launch data,
addresses and transaction form values are not forwarded.

## Session and cancellation rules

All CTA consumers share one connection request. Repeated choices share an
already-pending prompt for the same provider object. Back, Close, Escape,
backdrop, native Back and unmount invalidate the attempt; late success cannot
replace a newer choice. Cancelled replacement keeps the prior valid session.
Opening a wallet app or download page is a handoff, never approved accounts or a
successful session.

A usable connection requires valid approved accounts and a supported Ethereum
or Base chain, checked again before publication. Change listeners remain active
through the handoff into the session owner. Account/provider/network changes
during transaction preflight still block signing. Transactions are never replayed
on foreground return.

Passive restoration requires a saved unique provider identity and remembered
account, followed by fresh silent reads. Old or partial preferences require an
explicit selection. A manual disconnect cannot silently restore. Ambiguous
self-claimed provider identities fail closed; display metadata is not proof of
authenticity. Later ambiguity invalidates signing authority. An explicitly selected
provider stays pinned and cannot be replaced by a different global provider.

MetaMask Mobile's `io.metamask.mobile` announcement is treated as a display alias
of `io.metamask`. One exact provider object produces one MetaMask choice; distinct
objects claiming either alias remain ambiguous and cannot be selected silently.
The alias is corroborated by the pinned [mobile build identifier](https://github.com/MetaMask/metamask-mobile/blob/bedf01fd2cd72cc60d16b1d56069582de0d86ea0/scripts/inpage-bridge/webpack.config.js)
and [provider announcement](https://github.com/MetaMask/metamask-mobile/blob/bedf01fd2cd72cc60d16b1d56069582de0d86ea0/scripts/inpage-bridge/src/provider.js).

Account reauthorization and provider `connect` events trigger fresh silent reads
from the active pinned provider, including its supported chain. They never
request approval, replace an explicitly disconnected session, or replay a
transaction. MetaMask Mobile's bounded `data.originalError.code === 4902` chain
error is handled like a direct unknown-chain response; explicit user rejection
and unreviewed RPC metadata still prevent network addition.

Busy Connect controls remain focusable while synchronous guards prevent repeated
requests. Dismissal returns focus to the originating control. If successful
connection removes that control, the wallet dialog alone may return focus to the
current header wallet control or main heading, provided no newer dialog, route,
or deliberate focus target has taken ownership.

## Verification boundary

Focused mock tests exercise routing, metadata collisions, exact selection,
shared requests, late results, account/chain changes and link sanitization.
Browser regression tests cover the real adapter and overlay, including keyboard,
focus, repeated/interrupted flows and mobile widths. Written browser tests are
not evidence that they ran. Full current typing, production export, aggregate
checks and actual browser/device verification remain required before release.
No physical iOS/Android wallet handoff or original-tab return has been verified.

Official link references:

- [MetaMask links](https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/)
- [Trust Wallet links](https://developer.trustwallet.com/developer/develop-for-trust/deeplinking)
- [Phantom browser link](https://docs.phantom.com/phantom-deeplinks/other-methods/browse)
- [Rabby registered universal link](https://github.com/RabbyHub/rabby-mobile/blob/784783cc9ddce0edf90b8a65e5c18bc02b57af00/apps/mobile/src/constant/universalLink.ts) and [handler](https://github.com/RabbyHub/rabby-mobile/blob/784783cc9ddce0edf90b8a65e5c18bc02b57af00/apps/mobile/src/hooks/universalLink.ts)
- [Rainbow browser-link handler](https://github.com/rainbow-me/rainbow/blob/206981573a4da4ca24985bc0819a70a17819f079/src/handlers/deeplinks.ts) and [registered domain](https://github.com/rainbow-me/rainbow/blob/206981573a4da4ca24985bc0819a70a17819f079/ios/Rainbow/Rainbow.entitlements)
- Official app pages: [Base Wallet](https://wallet.coinbase.com/download), [Zerion](https://zerion.io/download/), [OKX](https://web3.okx.com/download)

## Existing Wagmi integration review

The pinned app uses Wagmi 3.7.7, core 3.6.5 and connectors 8.2.0. The requested
[version-2 injected documentation](https://2.x.wagmi.sh/core/api/connectors/injected)
remains useful conceptually, but it is not this app's dependency version. The
installed injected connector handles EIP-1193 requests, listeners, disconnect
markers and optional delayed injection. It does not supply wallet-app universal
links or mobile download routing. A target callback returning undefined falls
back to generic window.ethereum; it must not be used as a missing named wallet.
The browser owner uses public Wagmi connect, reconnect, disconnect, connection
watching and wallet-client actions through fixed-object injected connectors.
Each pending selection gets an isolated config. Fresh account, chain and identity
validation must pass before it becomes the accepted config projected through
FxWalletContext; cancelling a replacement preserves the prior accepted session.
An owned provider facade contains late results and listeners without revoking
permissions during cancellation. Scoped silent restoration requires the saved
unique wallet and its remembered account, including when that account is not
first in the provider's account list.

Foreground reconciliation uses a local-only public core reset before scoped
reconnect, preventing duplicate native handlers. Raw events remain observed
while native event forwarding is suspended across that reset. Same-account
revalidation preserves the accepted display identity while transaction authority
stays fenced. Actual account loss, disconnect or conflicting discovery clears it.
The switch policy retains reviewed RPC metadata and bounded 4902 recovery.
Already-dispatched transaction results survive local retirement for receipt
tracking, with no replay or publication of an obsolete session.

None of this changes the shared read-only Wagmi config or mounts a browser signer
inside the Privy arm. Exact documented namespaces for Base, OKX, Trust and Phantom
supplement announcements; conflicting identity claims fail closed before dedup.
These source-compatible routes still require current release/device testing.

[Reviewed upstream injected source](https://github.com/wevm/wagmi/blob/c458d201b0218a9e371de9fdd9a35b6b475fb1b2/packages/core/src/connectors/injected.ts).

- [Pinned wallet metadata and marks](https://github.com/rainbow-me/rainbowkit/tree/03360ee924cfa6af13ff1d623b356bf5a170348e/packages/rainbowkit/src/wallets/walletConnectors)
