# Mobile wallet-browser handoff

Web users connect an injected EVM wallet. On mobile, MetaMask and Trust Wallet
links open FxAeon in the wallet's own browser, where the existing injected-wallet
connection runs. This does not add an authentication provider, relay subscription,
project ID, or QR-pairing service. Existing Telegram Privy access is unchanged.
No new connector MAU billing is introduced by ordinary app links or injected
wallets. Existing RPC costs and network transaction gas still apply.
The existing wallet adapter continues to own connection and signing. Wagmi's
public-read/cache configuration remains unchanged.

A single detected wallet connects directly. Multiple detected wallets open an
accessible chooser. With no detected wallet, the same chooser offers wallet-app
links and manual instructions. The login page also offers those links directly.

The links have fixed wallet-app hosts and a fixed `fxaeon.com` destination. They
preserve only these public routes: `/`, `/earn`, `/trade`, `/borrow`, `/positions`,
`/move`, and `/send`. All other routes return to `/`. They never forward query
parameters, fragments, Telegram launch data, or transaction form values. Users
connect again in the wallet browser and may need to re-enter unsaved form input.

Every transaction still requires wallet approval. The selected injected provider
is pinned for the session; late extensions cannot replace it. An ambiguous
automatic restore clears back to an explicit wallet choice. Account, chain,
provider, or disconnect changes during transaction preflight stop submission.

Automated tests cover provider selection, cancellation, focus, signing guards and
link destinations. Physical iOS/Android app opening and returning have not yet
been verified; check both MetaMask and Trust Wallet on devices before release.
If an app does not open, the UI directs the user to enter fxaeon.com in its browser.

Official link references:

- [MetaMask mobile deep links](https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/)
- [Trust Wallet deep linking](https://developer.trustwallet.com/developer/develop-for-trust/deeplinking)
