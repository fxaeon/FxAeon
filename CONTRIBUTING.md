# Contributing to FxAeon

Thanks for helping improve FxAeon. Start with [local setup](SETUP.md), then use the [developer handbook](docs/README.md) to find the owning code and its verification gate.

## A focused contribution

1. Describe the user-visible behavior, including what should happen when data or a dependency is unavailable.
2. Find the owning route, shared component, and source of truth in [architecture](docs/architecture.md).
3. Reuse the existing patterns in [DESIGN.md](DESIGN.md) and the shared components before adding a new system.
4. Test the behavior that changed, including stale, unavailable, cancellation, and narrow-screen states where relevant.
5. Run the release verification before proposing a release candidate, and report checks that could not run.

Run repository commands from the root unless a guide says otherwise. Do not commit generated builds, reports, local configuration, credentials, or fork state.

## Protocol, wallet, and receipt changes

Before changing planning, signing, receipts, or recovery, read the [SDK scope](docs/sdk-scope.md), [security model](docs/security.md), and [transaction lifecycle](docs/architecture.md#transaction-lifecycle).

- Keep SDK calls within the pinned public surface in [`fx-scope.lock.json`](fx-scope.lock.json). Adding a method requires an explicit scope review.
- Bind accepted terms to the current wallet session, chain, and inputs. Refresh and re-review changed or expired terms.
- Validate destinations, selectors, values, approvals, ordering, and nonces. Preserve simulation and final wallet, account, and network checks before dispatch.
- Require wallet approval for every request. Wait for verified predecessor receipts before dependent steps; stop on rejection, revert, timeout, reorg, or mismatch.
- Record uncertain submissions for recovery without claiming success or automatically resending. Local storage is evidence to investigate, not chain authority.
- Keep prices, charts, and portfolio estimates outside execution decisions.

Use protected fork tests when a change affects protocol reads, transaction policy, execution, ownership discovery, or recovery. Those tests use disposable local forks. Physical wallet handoff, native Telegram authentication, and real Base bridge delivery need separate evidence.

## Interface and evidence

Use semantic tokens and the shared amount, selection, help, review, and receipt components. Preserve exact-value disclosures and meaningful accessible names.

Check phone and desktop layouts, long values, keyboard focus and dismissal, reduced motion, and enlarged text. A screenshot proves a rendered state only; it does not prove wallet execution or live data correctness. Identify fixture provenance when sharing captures. The [browser gate map](docs/browser-test-gates.md) points to the relevant suite.

Keep estimates visibly approximate. Do not relabel position value as P&L, ROI, health, or liquidation value. A source-chain receipt does not prove bridge delivery.

## Dependencies and SDK patches

Use the pinned package manager and frozen installs. Dependency policies and version-bound patches are recorded in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and the lockfile.

Before adding a dependency, check compatibility, maintenance, license, browser payload, and whether an existing implementation already fits. Attribute adapted code. SDK patches must retain the allowed method surface and include regression coverage against the installed package.

Run `pnpm audit:all` for the repository's complete dependency-audit policy. It validates the reviewed temporary backport before allowing its single advisory exception; raw registry audit output alone does not validate the patch. An expired exception or new finding remains a failure.

For shared-module or lazy-loading changes, verify the production artifact and the consumer dependency chain. A mocked provider test alone cannot show that an emitted wallet chunk loads correctly.

## Pull request checklist

| Include | Reviewer needs |
| --- | --- |
| Behavior | The concrete trigger and resulting experience |
| Scope | Owning files and any wallet, protocol, data, or release boundary touched |
| Validation | Commands and outcomes for the reviewed revision |
| Evidence limits | Mocks, skipped checks, unavailable protected tests, or device coverage not performed |
| Documentation | The maintained guide updated when behavior, setup, or operations changed |

Use behavior-level tests where possible. Keep source contracts that protect real boundaries; avoid assertions that simply mirror implementation text. Do not weaken size, policy, security, or test gates to hide a regression. Fix the cause and explain any remaining limitation.

## Documentation and security reports

Keep operational instructions in maintained guides and implementation detail in focused references. Put revision-specific results in the pull request or generated evidence with its environment and limits. Remove superseded iteration notes instead of leaving competing instructions. A test result belongs to the exact revision and environment where it ran; see [testing evidence boundaries](docs/testing.md#evidence-boundaries).

Report vulnerabilities privately through [`SECURITY.md`](SECURITY.md). Never include credentials, Telegram launch payloads, authentication tokens, or unnecessary wallet history in an issue or test artifact.
