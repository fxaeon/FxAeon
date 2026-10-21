# FxAeon developer handbook

Build and maintain the web app, Telegram Mini App, and independent landing site. The handbook describes the repository's implemented behavior; the app's separate [product guide](https://fxaeon.com/docs) is written for people using the product.

## Start here

| Task | Guide |
| --- | --- |
| Install and run locally | [Local development](../SETUP.md) |
| Prepare a focused contribution | [Contributing](../CONTRIBUTING.md) |
| Understand system and signing boundaries | [Architecture](architecture.md) and [security](security.md) |
| Find the right test | [Testing](testing.md) and [browser gate map](browser-test-gates.md) |
| Deploy or roll back | [Deployment](deployment.md) and [release checklist](launch-readiness.md) |

The financial app is [fxaeon.com](https://fxaeon.com); [fxaeon.xyz](https://fxaeon.xyz) is the independent marketing site. Their builds, Pages Functions, configuration, and domains are separate.

The public guide has product topics under `/docs/guide/` and SDK topics under
`/docs/sdk/`, including setup, positions, borrowing, bridging, Earn, execution,
and boundaries. Repository operational instructions stay in this handbook.

## Implementation references

| Area | Reference |
| --- | --- |
| Allowed protocol methods, patch, amounts, units, and capability matrix | [Official SDK scope](sdk-scope.md) |
| Product areas, reviews, receipts, and unavailable states | [Product behavior](product-behavior.md) |
| Shared visual and interaction contracts | [Design system](../DESIGN.md) |
| Ordinary-web provider selection and mobile navigation | [Wallet browser handoff](mobile-wallet-browser-handoff.md) |
| Accepted Privy wallet identity, cancellation, and dispatch authority | [Privy wallet ownership](privy-wallet-ownership.md) |
| Development-only deterministic component catalog | [UI state lab](ui-state-lab.md) |
| Marks, licenses, current appearance, and capture provenance | [Brand assets](brand-assets.md) |
| Populated position capture setup | [Position screenshot fixture](position-screenshot-fixture.md) |

Package guides: [financial app](../apps/mini-app/README.md), [landing](../apps/landing/README.md), and [built-browser tests](../apps/mini-app/e2e/README.md).

## What establishes a result

The selected wallet authorizes signing; verified chain receipts and current canonical reads establish transaction and protocol state. Indexers, caches, local drafts, display prices, and screenshots have narrower roles.

Likewise, test evidence has a scope:

- Built-route tests cover the delivered app with credential-free or deterministic boundaries.
- Isolated harnesses exercise real components and controllers with synthetic services.
- Protected Anvil tests execute against disposable local Ethereum forks.
- Native Telegram login, physical wallet-browser handoff, and real Base delivery need separate validation.
- A release record describes the revision named in that record, not the current branch automatically.

See [testing](testing.md) for commands and evidence requirements, and the
[release checklist](launch-readiness.md) for the current candidate's work.

This handbook contains maintained instructions and implementation contracts.
Completed iteration notes, abandoned proposals, and superseded candidate reports
remain available in Git history. Keep new release evidence with its exact
revision, environment, and limitations; do not treat an older result as a current
release status. Update the owning guide whenever behavior changes.
