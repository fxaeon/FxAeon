# Contributing to FxAeon

Changes should make the product easier to understand while preserving the reviewed protocol and wallet boundaries. Start with [local setup](SETUP.md) and use the [developer handbook](docs/README.md) to find the relevant implementation guide.

## Make a focused change

1. Describe the concrete behavior: what triggers it, what the person sees, and what should happen on failure.
2. Find the owning route, shared component, and source of truth in [architecture](docs/architecture.md).
3. Preserve existing shared patterns from [DESIGN.md](DESIGN.md). Reuse components and dependencies before introducing another system.
4. Validate the changed behavior with the relevant unit or browser gate. Include unavailable, stale, cancellation, and narrow-screen states when they apply.
5. Run the full release gate before merging a release candidate, and report any checks that could not run.

Repository commands run from the root unless a guide says otherwise. Generated builds, reports, local configuration, credentials, and fork state do not belong in a commit.

## Protocol and signing changes

Read [SDK scope](docs/sdk-scope.md), [security](docs/security.md), and the [transaction lifecycle](docs/architecture.md#transaction-lifecycle) before editing planning, signing, receipts, or recovery.

- Planning stays within the pinned official SDK surface in [fx-scope.lock.json](fx-scope.lock.json). A new method is a scope decision, not a routine refactor.
- Bind accepted facts and transaction terms to the current wallet session, chain, and input intent. An expired or changed review must be refreshed and accepted.
- Validate exact destinations, selectors, values, approvals, ordering, and nonces. Preserve simulation and the final wallet/account/network checks before dispatch.
- Require visible wallet approval for each request. Dependent steps wait for verified predecessor receipts. Rejection, revert, timeout, reorg, or mismatch stops progression.
- Journal uncertain submissions without claiming success or offering an automatic resend. Local storage is recovery evidence to investigate, not chain authority.
- Keep price feeds, charts, portfolio estimates, and rebalance-distance displays outside execution decisions.

Use relevant protected fork tests when a change affects protocol reads, transaction policy, execution, ownership discovery, or recovery. Those tests send transactions only to disposable local forks. Physical wallet handoff, native Telegram authentication, and Base bridge delivery require separate evidence.

## Interface changes

Use semantic tokens and the existing amount, selection, help, review, and receipt components. Maintain readable exact-value disclosures and meaningful accessible names.

Check phone and desktop layouts, long values, keyboard focus and dismissal, reduced motion, and enlarged text. A screenshot confirms a rendered state; it does not prove wallet execution or live data correctness. Describe fixture provenance when sharing captures. [Browser gates](docs/browser-test-gates.md) identify the appropriate suite.

Display estimates must keep their approximation or uncertainty. Do not relabel a position value as P&L, ROI, health, or liquidation value. A source-chain receipt does not prove bridge delivery.

## Dependencies and SDK changes

Use the pinned package manager and preserve frozen installs. Dependency policies and version-bound patches live in [pnpm-workspace.yaml](pnpm-workspace.yaml); the package lock records the resolved graph.

Before adding a dependency, check compatibility, maintenance, license, browser payload, and the existing implementation. Record attribution for adapted code. SDK patches must preserve the allowed method surface and have regression coverage against the installed package.

Run `pnpm audit:all` for the repository's complete audit policy. It verifies the reviewed temporary backport before allowing its single advisory exception. Raw registry audit output alone does not validate that patch; an expired exception or new finding remains a failure.

For shared-module or lazy-loading changes, verify the production artifact and the real consumer dependency chain. A mocked provider test cannot by itself prove that an emitted wallet chunk loads correctly.

## Pull request checklist

The description should identify:

| Item | What reviewers need |
| --- | --- |
| Behavior | Concrete trigger and resulting experience |
| Scope | Owning files and any wallet, protocol, data, or release boundary touched |
| Validation | Commands and outcomes for the reviewed revision |
| Evidence limits | Mocks, skipped tests, unavailable protected checks, or device coverage not performed |
| Documentation | Updated maintained guide when behavior, setup, or operations changed |

Use behavior-level tests where possible. Preserve deliberate architecture and source contracts when they protect boundaries; avoid adding assertions that simply mirror implementation text.

Do not weaken size, policy, security, or test gates to make a change pass. Explain a concrete failure and fix its cause.

## Documentation changes

Keep operational instructions in the maintained guides and implementation detail in focused references. Put revision-specific results in the pull request or generated evidence, with their environment and limitations. Remove superseded iteration notes rather than retaining competing current instructions. Link to the source of a command or configuration contract instead of duplicating large inventories.

A test result belongs to its exact revision and environment. Do not present a historical suite count, screenshot, local fork, placeholder build, or mocked wallet as proof of a later production release. See [evidence boundaries](docs/testing.md#evidence-boundaries).

Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Never include credentials, Telegram launch payloads, authentication tokens, or unnecessary wallet history in an issue or test artifact.
