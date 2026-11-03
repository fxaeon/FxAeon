# Real Telegram SDK production-export regression

From the repository root (Node 22 / pnpm):

```sh
NEXT_PUBLIC_TELEGRAM_WALLET_MODE=passkey NEXT_PUBLIC_PRIVY_APP_ID=clabcdefghijklmnopqrstuv pnpm build
pnpm --dir apps/mini-app exec playwright test --config e2e/telegram-sdk.config.ts
```

The app id is a non-secret fixture. Use a disposable checkout without production
environment files. The suite requires a fresh `apps/mini-app/dist` passkey-enabled
export; it serves the actual HTML, JS, CSS and official patched SDK bytes over a
Playwright-routed HTTPS test origin. All remote requests are blocked. No app
modules or `Telegram.WebApp` object are mocked. Only native host transport and API
responses are synthetic; no real wallets or transactions are created.

Coverage includes Android/iOS first registration and a delayed ticket response
exceeding Telegram's one-second gesture TTL, exact commitment and native URL,
launch-hash removal/reload, rejected authentication, failed local SDK, and no
capability fragment persistence or logging on approval/invite routes.

Existing required CI also runs `test/telegram-sdk.test.ts` against the full patched
SDK in a VM, and `telegram-passkey-client.spec.ts` through the isolated overlay
group. Those cover origin/source checks, native transport, capabilities, prepared
ticket cancellation, account/network changes, duplicate clicks and click-time
expiry without depending on this additional passkey-enabled export.
