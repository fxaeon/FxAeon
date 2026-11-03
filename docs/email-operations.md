# Admission email and user reports

Email is for successful waitlist admission and incoming user feedback/reports only. It is not an authentication method: the miniapp retains native Privy Telegram login. No marketing, newsletters, transaction notices or generic onboarding campaigns.

The intended addresses are `notifications@fxaeon.com` for admission confirmations and `support@fxaeon.com` for reports and replies. `support@fxaeon.xyz` is an alias to the same support inbox. Resend's Free plan is the proposed sending/inbox provider; setup is pending account sign-in and domain verification. Do not display these addresses as operational until a delivery check succeeds.

## DNS and rollout

Checked 3 November 2026: `fxaeon.com` has no MX records and has an existing Cloudflare DMARC reporting record. `fxaeon.xyz` has registrar forwarding MX records. Preserve existing forwarding until the replacement has been verified. Add only the exact SPF, DKIM and receiving records issued by the selected provider; do not invent DKIM keys, publish duplicate SPF records, or replace DMARC reporting configuration blindly.

Use the Free plan without paid overages. Resend currently documents 3,000 emails per month and 100 per day, shared with inbox traffic. Reserve headroom for reports and replies; enqueue admission confirmations and stop sending when the application budget is reached. Quota or provider failure must never revoke an admission or affect wallet access. Keep sending credentials server-side, scoped to the sending domain; never place them in Next public variables or source control.

## Admission confirmation boundary

Only enqueue a message after durable admission and provider access have both been confirmed. Key it by the admission ID to prevent duplicates. An email address is optional contact information, separate from Telegram identity, and must be verified before it receives admission mail. Do not send to an address copied from an unverified form or assume a Telegram profile supplies an email address.

Use `Reply-To: support@fxaeon.com`. Disable open/click tracking. Never include wallet balances, transaction data, Telegram launch data, credentials, or keys. Do not send a false success message while the free provider-enforced admission cap is unresolved.

Proposed message:

> Subject: Your FxAeon miniapp access is ready
>
> You're off the waitlist. Open FxAeon from the official Telegram bot and sign in with Telegram to use your account.
>
> Need help or want to report a problem? Reply to this email. FxAeon will never ask for your recovery phrase or private key.

Link only to the configured official Telegram app URL. Before enabling delivery, test one consented recipient, Reply-To routing, SPF/DKIM/DMARC alignment, duplicate retries, quota exhaustion and provider failures. No email has been sent and no mail DNS records have been changed as part of this configuration preparation.

Sources: [Resend pricing](https://resend.com/pricing), [domain verification](https://resend.com/docs/dashboard/domains/introduction), [Cloudflare email pricing](https://developers.cloudflare.com/email-service/platform/pricing/).
