# Admission email and user reports

Email is for requested contact verification, waitlist admission and incoming user feedback/reports. It does not authorize enrollment or wallet signing; Telegram identity and passkey approvals have separate verification. No marketing, newsletters, transaction notices or generic onboarding campaigns.

Use `notifications@fxaeon.com` for admission confirmations and `support@fxaeon.com` for reports and replies. Keep inbox access, routing records, provider account configuration and recipient-specific delivery evidence in private operator records. The code implements contact verification and a durable outbox; implementation does not establish live delivery or provider configuration.

## DNS and rollout

Use provider-issued records and verify SPF, DKIM and DMARC alignment before delivery. Preserve existing website and verification records; do not publish duplicate SPF records or replace unrelated routing and reporting configuration.

Reserve provider quota for reports and replies; enqueue admission confirmations and stop sending when the application budget is reached. Quota or provider failure must never revoke an admission or affect wallet access. Keep sending credentials server-side, scoped to the sending domain; never place them in Next public variables or source control.

## Admission confirmation boundary

Only enqueue a message after durable admission and provider access have both been confirmed. Key it by the admission ID to prevent duplicates. An email address is optional contact information, separate from Telegram identity, and must be verified before it receives admission mail. Do not send to an address copied from an unverified form or assume a Telegram profile supplies an email address.

Use `Reply-To: support@fxaeon.com`. Disable open/click tracking. Never include wallet balances, transaction data, Telegram launch data, credentials, or keys. Do not send a false success message while the free provider-enforced admission cap is unresolved.

Proposed message:

> Subject: Your FxAeon miniapp access is ready
>
> You're off the waitlist. Open FxAeon from the official Telegram bot and sign in with Telegram to use your account.
>
> Need help or want to report a problem? Reply to this email. FxAeon will never ask for your recovery phrase or private key.

Link only to the configured official Telegram app URL. Before enabling automated delivery, test a consented recipient, Reply-To routing, SPF/DKIM/DMARC alignment, duplicate retries, quota exhaustion and provider failures. Record live delivery evidence privately against the deployed revision.

Sources: [Resend pricing](https://resend.com/pricing), [domain verification](https://resend.com/docs/dashboard/domains/introduction), [Cloudflare email pricing](https://developers.cloudflare.com/email-service/platform/pricing/).
