# Privy wallet ownership and signing boundaries

Implementation reference for [the wallet bridge](../apps/mini-app/src/lib/wallet/PrivyWalletBridge.ts).
Start with [architecture](architecture.md#wallet-selection) for provider selection,
or [browser gates](browser-test-gates.md) for the registered verification commands.

The ordinary web app uses the browser-only Wagmi session owner. Telegram uses
Privy. The route data provider remains connector-free in both modes; its Wagmi
config is not a signer and does not reconnect wallets.

## Privy connection events are availability, not acceptance

The installed `@privy-io/react-auth` 3.45.0 modal APIs return no operation ID or
operation-owned completion promise. Their event bus delivers to the current
hook listeners. Closing or navigating Back does not abort older connector work,
and delayed success callbacks can outlive the modal that started them.

Consequently, the bridge does not subscribe to login/connect completion payloads
as wallet-selection or app-promise authority. Multiple app callers join one
visible modal wait. Observed modal dismissal releases the wait as cancellation;
a never-opened modal retains the existing bounded timeout. Neither outcome
resumes an earlier protocol action.

In Telegram Settings, **Connect another wallet** adds available choices.
**Switch wallet** explicitly accepts a current Ethereum wallet for the current
authenticated user. The current funded wallet stays selected while candidates
arrive. An external-only wallet list does not silently select its first entry.
Seamless embedded-wallet hydration remains available for the authenticated user.
The wallet section shows the selection guidance beside the choices. An
authenticated account without an accepted wallet gets a deliberate “Choose
wallet” link to the expanded Settings choices. Login readiness uses the same
accepted Fx identity. Neither path automatically leaves a form or resumes an
earlier action.

## Accepted choice lifetime

The accepted choice survives bridge/provider remounts in the same browser
document. It is an in-memory, user-bound preference containing only the wallet's
Ethereum type, normalized address, wallet client, connector, metadata ID, HD
wallet index and imported flag where present. It retains no SDK wallet object,
provider, credentials, preflight ticket or signing authority. Chain and connection
time are live dispatch checks, not preference identity. No localStorage or
sessionStorage persistence is added. A full page reload starts a new preference;
the initial embedded wallet can be accepted seamlessly, while an external wallet
still requires explicit selection.

Every render resolves the preference against the current authenticated user and
the current ready SDK wallet list. A cloned/reordered descriptor for the same
semantic wallet preserves the choice. Provider readiness still enables Connect
CTAs, but wallet-list readiness is separately required for publishing any selected
wallet or dispatch authority. A not-ready list, including an empty hydration
frame after remount, withholds authority without erasing the preference. Once a
ready list loses or ambiguously matches the chosen identity, the choice is
retired. Neither another embedded wallet nor a reappearing external candidate is
automatically adopted: the person must choose again in Settings. The address-only
selection UI also fails closed if multiple current descriptors share an address.
An established explicit-choice requirement survives authentication loss, logout
and reconnect/resume; only a successful explicit wallet choice or a new document
clears it. Opening a connection flow is not wallet-selection consent.

Logout clears the preference synchronously. Any observed authenticated user-ID
change within the document requires an explicit new choice, even for embedded
wallets and for A → B → A. The last observed user ID is retained through logout
solely to recognize that boundary; the previous choice is not retained. This
avoids adopting the old user's embedded descriptor while the SDK's new-user
wallet list is still hydrating. Initial document/seamless embedded acceptance
remains automatic, and its first accepted identity stays pinned across clones,
reordering and provider remounts. An external preference alone never reconnects
a wallet or signs: a remount gets fresh dispatch authority and every send still
passes current provider/account/network preflight and visible wallet approval.

## Manual disconnect

A local, credential-free intent flag is scoped to the current browser document.
It blocks the Fx wallet projection immediately, before awaiting SDK logout, and
survives React/provider remounts in that document. Delayed SDK authentication or
wallet-list changes cannot clear it. Only an explicit Connect action can resume.
No SDK storage is deleted or shared with the browser signing owner. A new page
has a new document; the old asynchronous JavaScript operations cannot survive it.

## Transaction preflight

The private dispatch guard tracks mounted state, the authenticated user, semantic
wallet identity, and a monotonically invalidated intent. Explicit selection,
including selecting the same address, logout, and unmount retire held preflights.
It checks after asynchronous provider/network/account operations and immediately
before calling the signing API. Chain and account events also fence transient
changes, and fresh reads validate the requested supported chain and sender.

Privy's embedded provider wrapper is freshly created by its SDK. An intended
chain switch can also replace its wallet descriptor. The guard allows that
specific same-owner transition and obtains the updated provider; descriptor
cloning alone is not account replacement. External providers stay pinned to the
exact acquired object and are checked again before dispatch.

Retirement before dispatch yields no signing call. Once a signing request has
actually been issued, its original hash or error must still return to the
transaction runner. It is never retried, replayed, or republished as a new wallet
session. The runner can journal and track the original transaction even if its
UI or wallet selection changes later.

## Verification scope

Unit regressions cover modal single-flight, explicit selection, document-scoped
choice continuity, independent wallet hydration readiness, definitive absence
and reappearance, semantic collisions, logout/user changes, local logout
intent, held preflight invalidation, valid intended switches, provider changes,
listener cleanup, and already-issued result continuity. Registered browser
harnesses exercise the actual bridge against synthetic SDK/provider leaves.
Separate locally built web and Telegram fixtures retain the real route/data
providers and use different origins. Their evidence is synthetic component
integration; it does not establish live Privy/Telegram authentication or physical
phone behavior. All signing destinations in those fixtures are denied or
in-memory, and they are excluded from production output.
