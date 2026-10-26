# Wallet marks

These local images identify wallet-browser links. They are not evidence that a
wallet is installed, connected, or endorses FxAeon. Do not fetch arbitrary
extension-supplied icon URLs.

- `metamask.svg`: unchanged `MetaMask-icon-fox.svg` from MetaMask's official logo
  pack, linked at https://metamask.io/assets on 2026-10-10.
  Source: https://assets.ctfassets.net/clixtyxoaeas/1d7h0Cnm1RaQ0TspxaTS0H/57418d60d3a13fbee748be1ca560235a/MetaMask-Logo-Pack__4_.zip
  The pack includes no separate software license; MetaMask owns the mark.
- `trust-wallet.svg`: unchanged Trust Wallet mark from RainbowKit's maintained
  wallet connector, revision `03360ee924cfa6af13ff1d623b356bf5a170348e`.
  Source: https://github.com/rainbow-me/rainbowkit/blob/03360ee924cfa6af13ff1d623b356bf5a170348e/packages/rainbowkit/src/wallets/walletConnectors/trustWallet/trustWallet.svg
  The upstream MIT notice is included as `RainbowKit-LICENSE.txt`. Trust Wallet
  retains rights to its brand. No RainbowKit runtime or connector is added.

The additional unchanged `coinbase.svg`, `phantom.svg`, `rabby.svg`,
`rainbow.svg`, `zerion.svg`, and `okx.svg` marks come from the same pinned
RainbowKit revision and MIT notice. Each is located in its corresponding
`packages/rainbowkit/src/wallets/walletConnectors/<name>Wallet/<name>Wallet.svg`
folder at https://github.com/rainbow-me/rainbowkit/tree/03360ee924cfa6af13ff1d623b356bf5a170348e/packages/rainbowkit/src/wallets/walletConnectors .
They identify either an exact detected provider's announced brand or the
wallet's official product link; they do not imply installation or connection.

- `base.svg`: current Base Square, extracted from the official brand guide at
  https://brand.base.org/core-identifiers on 2026-10-11. Geometry and viewBox are
  unchanged. The source CSS class's light-mode `#0000FF` color is resolved into
  the SVG path fill for standalone image use; site-only class attributes are
  removed. Original inline SVG SHA-256:
  `7007ee54b8d7e7b88929a2912a17f9720bff9151c85cdd19f4920d1fc7335f27`.
  This is a Base brand asset, not an MIT/public-domain licensing claim.
  The stable `coinbase` provider identity uses this requested Base Wallet mark;
  it does not change the user's provider, account or authentication method.

Existing catalog rows retain their local marks, including Base Wallet. Additional installed EIP-6963 wallets may supply their own bounded data-image icons, rendered only through img. Invalid or failed announced images use the generic mark; no arbitrary network image URL is fetched. Names and marks never authorize a signer.
