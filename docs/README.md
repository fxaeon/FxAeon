# Developer handbook

Use this handbook to find the code owner, verification gate, and operational guide for the financial web app, Telegram Mini App, and independent landing site. For product help, use the public [FxAeon guide](https://fxaeon.com/docs).

The app at [fxaeon.com](https://fxaeon.com) and the marketing site at [fxaeon.xyz](https://fxaeon.xyz) build and deploy independently. Their Pages Functions, configuration, and domains are separate.

## Start with your task

| Task | Start here |
| --- | --- |
| Install and run locally | [Local setup](../SETUP.md) |
| Find a route, service, or signing boundary | [Architecture](architecture.md) |
| Understand supported product behavior | [Product behavior](product-behavior.md) |
| Change SDK calls or transaction policy | [SDK scope](sdk-scope.md), [security model](security.md), and [contributing](../CONTRIBUTING.md) |
| Choose a test and report its limits | [Testing](testing.md) and [browser gate map](browser-test-gates.md) |
| Prepare or diagnose a release | [Deployment](deployment.md) and [release checklist](launch-readiness.md) |

## Implementation references

| Area | Guide |
| --- | --- |
| Public SDK methods, local patch, units, and capabilities | [SDK scope](sdk-scope.md) |
| Product routes, reviews, receipts, and unavailable states | [Product behavior](product-behavior.md) |
| Shared visual and interaction rules | [Design system](../DESIGN.md) |
| Ordinary browser wallets and phone handoff | [Wallet browser handoff](mobile-wallet-browser-handoff.md) |
| Privy wallet identity, cancellation, and dispatch authority | [Privy wallet ownership](privy-wallet-ownership.md) |
| Deterministic development component catalog | [UI state lab](ui-state-lab.md) |
| Completed full-page UI review and capture notes | [UI audit — 26 October 2026](ui-audit-2026-10-26.md) |
| Marks, licenses, social previews, and screenshot provenance | [Brand assets](brand-assets.md) |
| Populated position capture setup | [Position screenshot fixture](position-screenshot-fixture.md) |

## Applications

| Package | Responsibility | Guide |
| --- | --- | --- |
| [`apps/mini-app`](../apps/mini-app/README.md) | Static financial app, wallet adapters, SDK integration, and browser harnesses | [App guide](../apps/mini-app/README.md) |
| [`apps/landing`](../apps/landing/README.md) | Independent marketing site and display-only market data | [Landing guide](../apps/landing/README.md) |
| [`functions`](../functions) | Optional app gas Pages Function | [Deployment](deployment.md#read-only-functions) |
| [`scripts`](../scripts) | Verification, build, deployment, and capture tooling | [Testing](testing.md) · [Deployment](deployment.md) |

## Evidence and system boundaries

Verified chain receipts and current canonical reads establish transaction and protocol state. Indexers, caches, local drafts, display prices, and screenshots have narrower roles.

- Built-route tests cover the delivered app with credential-free or deterministic boundaries.
- Isolated browser harnesses exercise real components and controllers with synthetic services.
- Protected Anvil tests run against disposable local Ethereum forks.
- Native Telegram login, physical wallet-browser handoff, and real Base bridge delivery require separate validation.
- A release record describes only the revision and environment where its checks ran.

See [testing evidence boundaries](testing.md#evidence-boundaries) before sharing a test count, screenshot, or release result. Keep current operational instructions in their owning guides; completed iteration notes and superseded reports belong in Git history.
