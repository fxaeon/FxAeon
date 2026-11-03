# Admission email and user reports

Email is for successful waitlist admission and incoming user feedback/reports only. It is not an authentication method: the miniapp retains native Privy Telegram login. No marketing, newsletters, transaction notices or generic onboarding campaigns.

Use `notifications@fxaeon.com` for admission confirmations and `support@fxaeon.com` for reports and replies. The domain is verified in Resend for sending and receiving, with enforced TLS and no tracking configured. The dedicated [FxAeon Support inbox](https://resend.com/inboxes/support@fxaeon.com) received Cloudflare's destination-verification email successfully on 3 November 2026. Read and reply to reports there; no personal Gmail forwarding is needed.

`support@fxaeon.xyz` is the planned alias to the same inbox. Its destination is verified, but activation is pending approval to replace the legacy registrar mail records. Do not advertise the alias until activation and delivery have been verified. Automated admission emails are not enabled: contact verification, an outbox and a server-side sender credential still need implementation before rollout.

## DNS and rollout

Configured 3 November 2026: `fxaeon.com` has Resend's `resend._domainkey` TXT record, DNS-only `rsend` and `send` Forge CNAMEs, and priority-10 MX `receive-apne1.forge.rmta.net`. Resend verifies all of these records. Existing website, Privy, verification and Cloudflare DMARC reporting records were preserved. `fxaeon.xyz` still has registrar forwarding MX/SPF records. Add only exact provider-issued records; do not invent DKIM keys, publish duplicate SPF records, or replace DMARC reporting configuration blindly.

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

Link only to the configured official Telegram app URL. Before enabling automated delivery, test one consented recipient, Reply-To routing, SPF/DKIM/DMARC alignment, duplicate retries, quota exhaustion and provider failures. Inbound delivery has been checked with Cloudflare's verification message; no admission success message has been sent.

Sources: [Resend pricing](https://resend.com/pricing), [domain verification](https://resend.com/docs/dashboard/domains/introduction), [Cloudflare email pricing](https://developers.cloudflare.com/email-service/platform/pricing/).
