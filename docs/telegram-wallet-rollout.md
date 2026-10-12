# Telegram wallets and public web access

The ordinary website selects the browser wallet adapter even when a Privy app
ID is configured. It does not initialize Privy sessions. Its login, Settings,
and profile controls must not import or invoke Privy hooks. EIP-1193 and
EIP-6963 extension and wallet-browser connections retain their existing
explicit selection, account/chain checks, and transaction confirmations.

Telegram launches with nonempty launch data select the lazily loaded Privy
provider. A user-agent string, theme/version hint, or empty Telegram SDK stub
is insufficient. This client-side distinction is **not an admission or billing
security boundary**: only the auth service can validate the signed identity.
The selection is fixed for the document so navigation cannot silently replace
the active wallet. A native Telegram host or iframe with the exact HTTPS parent
origin `https://web.telegram.org` waits up to eight seconds for a missing bridge
to restore launch data after a reload. The parent origin only permits waiting;
an empty or missing payload still selects browser mode. Top-level referrals
from Telegram and unrelated iframe hosts do not delay ordinary web access.
Launches with data remain immediate. No-Privy test builds keep the existing
unauthenticated Telegram behavior.

## Rollout and connection support

The owner confirmed on 9 October 2026 that all existing accounts and wallets
are their own test accounts, with backups already taken. Migrating existing
email-login accounts is therefore not a prerequisite for this rollout.
If ordinary-web Privy accounts are introduced again, disabling that access
requires a verified recovery or linked-login path: an email account and a
Telegram account are not automatically the same Privy user. This change does
not delete accounts or move assets.

The browser adapter supports injected wallets and now offers explicit
MetaMask/Trust Wallet browser links. Normal Safari/Chrome without a provider
uses that handoff, then connects inside the wallet browser. Public routes are
preserved; query strings, launch data, and unsaved form values are not forwarded.
There is no QR/relay pairing or additional connector subscription. See
[mobile wallet-browser handoff](mobile-wallet-browser-handoff.md) for behavior
and physical-device validation still required before rollout.

## Proposed Telegram admission and waitlist

Use a permanent admitted cohort, not a rolling monthly queue that can remove
someone's access to a funded wallet. Existing admitted users retain access;
capacity only decides whether a new identity can join.

1. Before mounting Privy, send Telegram `initData` to a same-origin admission
   function. Verify the documented HMAC signature, timestamp freshness, and
   Telegram user ID on the server. Never trust `initDataUnsafe` or a client ID.
2. Atomically insert a unique Telegram identity into a D1 admission table only
   while the configured capacity has space. Concurrent requests must share one
   transaction; retries for an admitted user must not consume another seat.
   KV's eventually consistent reads are unsuitable for an exact cap.
3. Only after admission commits, issue a short-lived custom-auth JWT for Privy.
   A denied new user receives no JWT and never initializes the Privy SDK.
   Unavailable admission storage fails closed for new users, with a retry and
   public-web escape route. Plan returning-user continuity separately.
4. Show **Telegram early access is full**, with **Join waitlist** and
   **Continue on web**. Joining records the verified Telegram ID once, without
   creating a Privy account. The web action uses a user click to open a clean
   public URL; never forward Telegram launch data or auth tokens. Connecting
   an external wallet does not transfer an embedded wallet's assets.

This requires a small authentication/admission service and persistent identity
storage, which the current static architecture does not have. It is a separate
product change, not transaction infrastructure or a delegated signer.

### Why a screen or counter alone cannot enforce the cap

Privy's native allowlist explicitly excludes Telegram. While unrestricted native
Telegram sign-in remains enabled, someone can bypass a frontend waitlist and
authenticate directly. A real cap requires an auth path that Privy accepts
only with the server's admission credential, and closing alternative new-user
auth paths. Custom JWT auth requires requesting access from Privy; confirm its
availability and pricing for this account before implementing that dependency.

For existing accounts, Privy exposes `useLinkJwtAccount().linkWithCustomJwt(jwt)`.
Stage migration while the user is authenticated, verify the Telegram identity
belongs to that same user, then prove the same Privy user ID, wallet address,
signing, and recovery after custom login. Only then disable native signup.
Do not assume that changing JWT subjects preserves existing wallets.

### Capacity is not a guarantee of free billing

Privy's public pricing says both “0–499” and “up to 500”; the next tier starts
at 500. Use a configurable ceiling below 500 until the account's exact boundary
is confirmed. Reserve room for existing accounts and other apps on the team.
MAU means an authenticated active session in the previous 30 days, not total
registered users. Signature and transaction-volume thresholds apply separately.
An admission cap therefore bounds the cohort, not every possible billing input.

### Required verification for the admission change

- At capacity minus one, simultaneous new identities admit exactly one; retries
  and replayed launch data do not allocate duplicate seats.
- Forged/stale launch data, wrong bot signatures, client-supplied identities,
  and direct native-auth bypass attempts cannot create new Privy users.
- A waitlisted visitor makes zero Privy requests; database outages preserve
  honest retry states and never imply successful waitlist enrollment.
- Existing users keep the same wallet address and can sign/recover after
  migration. Admitted users are not evicted when capacity is reached.
- The web handoff strips launch credentials and supports actual mobile wallet
  connection, not just an outbound link.

## Official references (checked 9 October 2026)

- [Privy pricing](https://www.privy.io/pricing)
- [Privy allowlist limitations](https://docs.privy.io/user-management/users/managing-users/allowlist)
- [Custom JWT auth setup](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup)
- [Linking existing accounts](https://docs.privy.io/user-management/users/linking-accounts)
- [Telegram launch-data verification](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
- [Cloudflare D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)
