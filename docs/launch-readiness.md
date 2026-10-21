# Release checklist

Use this for a named release candidate. This file is a checklist of work, not a claim that any deployment has passed.

## Source and verification

- [ ] Record the exact source revision and reviewed changes.
- [ ] Confirm protocol changes remain within [the SDK lock](../fx-scope.lock.json).
- [ ] Run `pnpm verify` or confirm every equivalent Client CI phase passed for that revision. Inspect failures, retries, skips, dependency audit, secret scan, bundle and browser reports.
- [ ] Run relevant protected Anvil gates for signing, protocol reads, ownership discovery, execution or recovery changes; inspect redacted manifests.
- [ ] Keep evidence scoped: fixture, fork, browser, device, live service, or deployed artifact. Do not carry older results forward implicitly.

## Product behavior

- [ ] Review changed flows on narrow/short phones and desktop, with long values, keyboard navigation, enlarged text, reduced motion, and unavailable data.
- [ ] Keep exact amounts, minima, fee caveats, recipient, approvals, and request count accessible before signing.
- [ ] Check changed/expired reviews, wallet changes, cancellation, pending/uncertain state, and receipt-driven results.
- [ ] Verify mobile action clearance and complete 44px targets; inspect clipping and actual hit areas, not only screenshots.
- [ ] Recheck emitted consumer chunks after lazy-loading or shared-module changes.
- [ ] Recapture public screenshots when appearance changed, and record fixture/live-data provenance using [brand guidance](brand-assets.md#screenshots).

## Configuration and deployment

- [ ] Keep Preview and Production variables, domains, restrictions, quotas, and Privy apps distinct.
- [ ] Confirm no private/server credentials or local fixture flags enter public build inputs.
- [ ] Follow [deployment](deployment.md): verify the production-configured artifact, exact deployed revision, headers/CSP, expected public configuration, and applicable Function probes.
- [ ] Keep the app and landing projects/Functions separate. A static-only landing upload must not silently omit market data.
- [ ] Confirm rollback targets and make repository/deployment revisions converge after any rollback.

## Device and live-service claims

- [ ] Test actual browser-wallet connection/review where relevant.
- [ ] Verify native Telegram authentication, wallet continuity/recovery, and handoff on supported physical devices before claiming that coverage.
- [ ] Test real `startapp` entry after configuring BotFather's Main Mini App. Workflow menu synchronization alone does not configure it.
- [ ] Verify actual matching Base delivery before claiming live cross-chain coverage. An Ethereum fork or source receipt is insufficient.
- [ ] If a required live configuration/device is unavailable, record the exact limitation and the narrower successful checks.

## Publication and evidence

- [ ] Ensure maintained guides and in-app explanations match implemented behavior.
- [ ] Remove superseded iteration notes and abandoned proposals. Keep retained capture provenance accurate, and record current results with their exact revision and scope.
- [ ] Confirm privacy/risk disclosures match current data handling. The in-app privacy description is operational disclosure, not a complete legal policy or terms of service.

FxAeon is unaudited financial application software. Passing checks does not certify protocol safety or replace independent security review.
