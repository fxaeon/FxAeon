# Wallet ownership and signing boundaries

Start with [architecture](architecture.md#wallet-selection) for provider selection
and [browser gates](browser-test-gates.md) for verification commands.

## Browser and Telegram owners

Ordinary web uses the browser-only Wagmi signing owner. A deliberate catalog
choice binds the exact injected provider; announcements alone do not accept a
wallet. Account, chain, disconnect and document-session checks fence dispatch.
Read-only route providers have no connectors and cannot sign.

Telegram uses [TelegramPasskeyProvider](../apps/mini-app/src/components/admission/TelegramPasskeyProvider.tsx)
only when passkey mode and the public Privy app ID are configured. Disabled or
incomplete Telegram configuration shows an unavailable screen. It never selects
native Privy login or a browser signer as a fallback. Provider selection stays
fixed for the document. Secret-link enrollment and approval routes remain
independent of wallet login.

The app-owned [wallet descriptor](../apps/mini-app/src/lib/wallet/types.ts)
exposes identity and provider reads. Transaction authority belongs to the
selected owner's `sendTransaction` implementation, not to the descriptor.
The historical `usePrivyWallet` name is a common app interface, not a React-auth
SDK session. The native React-auth provider, login, export and bridge are retired.

## Passkey custody

[miniapp-access](../server/miniapp-access/index.ts) verifies Telegram identity,
permanent approval capacity and WebAuthn proofs. Its
[Privy REST boundary](../server/miniapp-access/privy.ts) provisions a wallet owned
by the enrolled passkey public key, with no additional signer. The server app
secret is transport authentication, not wallet authorization. No user private key
is stored by FxAeon.

The public `NEXT_PUBLIC_PRIVY_APP_ID` remains required: the browser checks the
canonical request's `privy-app-id` header against that configured identity before
approving it. Removing the native SDK does not remove this signing binding.
Expiry, exact transaction content and idempotency remain part of the request.
The server custody, provisioning and signing implementation is unchanged by the
React-auth removal.

An issued transaction's result must reach the runner even after a UI/session
change. An uncertain result is reconciled, never automatically resubmitted.
Browser harnesses use synthetic providers and passkey responses; they do not
establish live Privy account configuration or physical-device behavior.
