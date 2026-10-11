# Wallet authentication and admission cost decision

**Reviewed: 10 October 2026. Status: proposed admission design; not implemented.**

Retain Privy for Telegram while confirming custom-auth entitlement and pricing.
Do not migrate to Dynamic solely for its larger free MAU allowance: production
custom JWT authentication is an Enterprise feature there. The separate browser
wallet routing change does not implement an admission service or a billing cap.
See [the rollout design](./telegram-wallet-rollout.md) for the proposed quota,
waitlist, and public-web handoff behavior.

## Seamless Telegram access remains possible

Custom JWT does not inherently require another button, password, OTP, or popup:

1. The user opens FxAeon inside Telegram.
2. FxAeon's server validates signed `initData` and its freshness, then checks
   admission. Telegram's unverified client identity is never sufficient.
3. An admitted user receives a short-lived JWT; the wallet SDK authenticates
   automatically. A denied visitor sees the waitlist and public-web option.

This preserves zero additional login actions, not zero latency. It adds backend
verification, a database operation, and token issuance before wallet readiness.
Measure real Telegram cold and returning launches before promising equivalent
timing; retain transaction confirmations. [Telegram verification](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
and [Privy's automatic JWT synchronization](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/usage)
support this design; the latter replaces calls to Privy's native `login` method.

## Current published commercial terms

| Question | Privy | Dynamic |
| --- | --- | --- |
| Free MAU allowance | Printed as both 0–499 and “up to 500”; Core starts at 500 | Up to 1,000 on Self-Serve |
| Next published tier | $299/month for 500–2,499 MAU | $249/month for the published 1,000–5,000 band |
| Custom JWT in production | Request access; this account's entitlement and price remain unconfirmed | Enterprise required; sandbox testing does not require Enterprise |
| Additional limits | 50K monthly signatures and $1M monthly transaction volume included | Rate limits apply; the public page does not establish unlimited signing or a signature tariff |

Sources: [Privy pricing](https://www.privy.io/pricing),
[Privy JWT setup](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup),
[Dynamic pricing](https://www.dynamic.xyz/pricing), and
[Dynamic BYOA requirements](https://www.dynamic.xyz/docs/auth/bring-your-own-auth).

Privy counts authenticated users with an active session in the previous 30 days.
Dynamic counts monthly logins or creation of an embedded wallet, including a
pregenerated wallet. Neither allowance simply counts all registered wallets.
A permanent 500-member cohort therefore does not guarantee a free Privy bill:
resolve the exact MAU boundary and separate signature/volume treatment first.

At 750 active users, Dynamic's native Self-Serve flow could save Privy's $299
monthly Core base fee, assuming Privy's other usage stays within its allowances.
That comparison cannot price a Dynamic custom-JWT deployment: obtain its live
BYOA quote. At the current handful of test users, there is no MAU fee saving.

## A frontend waitlist cannot enforce provider billing admission

Privy's [native allowlist excludes Telegram](https://docs.privy.io/user-management/users/managing-users/allowlist).
Dynamic's [Allow Site Access outcome](https://www.dynamic.xyz/docs/auth/access-control/access-lists)
can prevent JWT issuance, but its [entry schema](https://www.dynamic.xyz/docs/api-reference/allowlists/create-an-allowlist-entry)
has no Telegram ID/handle field. `externalUserId` targets an ExternalUser identity;
do not assume it matches native Telegram credentials. No native Telegram
first-N admission criterion or synchronous server veto was verified in these docs.

Dynamic has a [native Telegram sign-in endpoint](https://www.dynamic.xyz/docs/api-reference/sdk/sign-in-with-telegram)
with automatic-login support. Its [current Telegram recipe](https://www.dynamic.xyz/docs/recipes/integrations/telegram/telegram-mini-app)
uses the headless JavaScript SDK; it does not establish that the old React
`useTelegramLogin` hook is available in that SDK. Keeping an unrestricted native
auth route enabled would let clients bypass our JWT admission service.

Dynamic's [auth webhooks](https://www.dynamic.xyz/docs/auth/webhooks) report events
such as user/session creation; [delivery is retried and unordered](https://www.dynamic.xyz/docs/platform/dashboard/webhooks/delivery-best-practices).
Its legacy [onAuthInit](https://www.dynamic.xyz/docs/react/reference/events/onauthinit)
is a client callback. Neither is documented as a synchronous provider-side veto.
A client check or optional reverse proxy cannot stop direct native authentication.
Gating wallet creation after native login also occurs too late to bound MAUs.

## Decision and conditions for implementation

- Confirm Privy's live custom-auth access, price, exact MAU boundary, and usage
  charges. Dynamic is an alternative only after an equivalent live-BYOA quote.
- Enforce admission before issuing provider-accepted JWTs, with an atomic unique
  identity quota and alternative new-user authentication routes closed.
- Keep a permanent admitted cohort. Capacity limits new admissions; it never
  evicts returning users or rotates people out of access to funded wallets.
  Plan returning-user continuity and recovery during admission-service outages.
- Preserve stable identity subjects and prove wallet address, signing, and
  recovery continuity. The owner's backed-up test wallets reduce current
  migration risk; changing providers or auth methods does not preserve an
  address automatically. [Privy account linking](https://docs.privy.io/user-management/users/linking-accounts)
- Prove rejection and direct-auth bypass tests, plus real iOS/Android Telegram
  login and wallet flows, before enabling the proposed admission system.

No provider, billing plan, authentication setting, or account was changed by
this decision record.
