# Delivery, verification and landing audit

## Result and scope

The delivery ledger contains **348 atomic requirements: 282 test-backed, 57 documented/source-enforced, and 9 gaps or unresolved decisions**. Every one of the **97 static test declarations in 21 owned test files** has an exact test-title/declaration-line anchor. The six named parameterized dependency-audit cases omitted by the static inventory are mapped separately, as are six nested release-revision rejection cases. The landing browser verification script contributes additional rendered-behavior assertions.

The source baseline is **`b69d9ce1be59f982fca3ac43a8b037f7037269d4`**, audited on 2026-10-22. The original application is a specification source for the rebuild. This audit did not copy application code, modify application behavior, run deployments, synchronize Telegram, install dependencies or execute financial transactions. It writes only this report and [delivery-behaviors.json](delivery-behaviors.json), with the separately requested art-direction correction in [REFERENCES.md](REFERENCES.md). No commits were made.

The ledger's statuses have deliberately limited meanings:

- **test-backed** means an inspected test or executable browser assertion expresses the requirement. Several contracts inspect source text; that is structural regression coverage, not a successful runtime or production observation.
- **documented** means the rule is explicit in inspected implementation, workflow or documentation but is not independently asserted by the owned named tests. A script may actively enforce the rule even though this ledger uses the conservative documented status.
- **gap** means evidence, reconciliation or a decision is still needed. It does not automatically mean a production defect has been demonstrated.

Product and security agents own the remaining application behavior and document classifications. The overlap here is intentional where a release gate depends on their boundaries.

## Current execution evidence

The coordinating agent reported these results during this audit:

| Evidence | Reported result | What it establishes |
| --- | --- | --- |
| Full `pnpm verify` | Exit 1: dependency-registry audit timeout | The release gate did not pass. Build and browser stages were not reached. |
| Unit and chaos run within that verification | 1,611 passed; four fork cases skipped; zero failures | Successful source-suite execution at the audited baseline, with fork execution explicitly absent. |
| Pinned browser setup | Chromium 156 download truncated | The pinned browser runtime was not successfully provisioned. |
| Available fallback browser | Chromium 153.0.8010.0 works through explicit executablePath | A separate runtime is available; this is not evidence that the browser suites passed or that it matches the pinned runtime. |
| Local fork binary | Anvil 1.7.1 installed; repository CI requests 1.8.1 | A runtime version difference must be attached to any later fork result. |
| Read-only upstream attempt | Publicnode RPC returned HTTP 403 | No current authorized fork proof was produced from that attempt. |

These are reported orchestration results, not runs performed by this audit agent. The central [baseline record](BASELINE.md) owns command logs and subsequent status updates. Historical release records and screenshots must not be substituted for an unrun current gate.

## Contracts the rebuild must retain

### A verified artifact with a traceable release

Production has two different build contexts. Deterministic verification clears configured RPCs and local fixture settings. After it passes, the workflow rebuilds the deployable export with protected production public configuration. The artifact then undergoes built-secret scanning, exact RPC literal inclusion checks and bundle/CSP checks before it receives a revision marker. This distinction prevents passing fixture checks from being mistaken for inspection of the actual configured production artifact. Sources: `scripts/e2e_build_env.mjs`, `scripts/build_environment.contract.test.mjs`, `scripts/deploy_workflow.contract.test.mjs` and `.github/workflows/deploy-mini-app.yml`.

Immediately before upload, the workflow compares its candidate SHA with remote main. Wrangler Pages uploads the existing artifact from repository root, preserving root Pages Functions discovery. Deployment serialization uses `fxaeon-production` with cancellation disabled. The live marker must match the requested 40-character SHA through a bounded, uncached, credential-free, redirect-rejecting probe. Only then do gas, public wallet configuration and Telegram synchronization run. The marker tests explicitly reject stale revisions, malformed JSON, bad status, redirected responses, unexpected final URLs and network failures. Sources: `scripts/release_revision.test.mjs`, `scripts/release_revision.mjs` and the deploy workflow contract.

The declared GitHub production environment is source evidence; it does not establish that remote reviewers, branch protection or Cloudflare configuration are actually enforced. The documented requirement to disable competing automatic production Git deployments remains a separate release prerequisite. The financial and marketing projects must keep their own domains, roots and outputs. Source: `docs/deployment.md`.

### Verification coverage that cannot quietly shrink

The source, build, production-browser and isolated-browser phases are distinct. Current code partitions **nine** isolated harnesses exactly once: Borrow, Move, Positions, Privy send, Trade, wallet-provider routing, mobile wallet, overlays and state lab. Production route E2E uses four shards of the same uploaded static artifact. The required summary job fails if any phase is not successful. Serial mode reduces overlap, including browser workers, without deleting checks. The E2E compiler compares its effective input set against every supported TypeScript extension and Playwright configuration, with strict no-emit checks and a cache separate from the fork compiler. Sources: `scripts/verify.mjs`, `scripts/verify_phases.contract.test.mjs`, `scripts/e2e_typecheck.contract.test.mjs`, `.github/workflows/ci.yml`.

The browser test server is part of the evidence chain. Its manifest must resolve clean routes, query-bearing routes, trailing slashes and nested indexes correctly. HTML is uncached; versioned JavaScript is immutable. Encoded traversal and malformed paths cannot escape the manifest, and missing routes return the actual 404 document. Source: `apps/mini-app/test/e2e-serve.test.mjs`.

The test documentation currently describes seven sequential harnesses. That conflicts with the current runner's nine harnesses and bounded parallelism. The executable partition is the current source fact; the rebuild's specification must reconcile the prose rather than copy it unchanged.

### Bundle, CSP and dependency controls

The current release guardrails in `scripts/check_bundle_size.mjs` are:

| Artifact measure | Maximum |
| --- | --- |
| Entire static export | 12 MiB |
| All emitted JavaScript, raw | 8 MiB |
| Sum of JavaScript gzip sizes, compression level 9 | 3 MiB |
| A single emitted JavaScript file | 2 MiB |
| Cloudflare header line | 2,000 characters |

Published source maps and the explicit hCaptcha/Sentry telemetry patterns are rejected. These are upper bounds for the build, not measured interaction latency or a claim of improvement. They should survive as explicit budgets until deliberately replaced by justified limits.

The app's CSP is split for a specific reason. A short HTTP policy retains `frame-ancestors`; the early per-document meta policy supplies `default-src`, approved script sources and exactly that document's inline-script hashes. Putting a competing HTTP `script-src` or `default-src` back in would intersect with the hashed document policy and can block legitimate scripts. Meta policies must precede execution and omit directives unsupported in meta. Generation is idempotent, refuses unmanaged CSP meta elements and cannot overwrite an independently served export directory. Sources: `scripts/generate_csp_headers.contract.test.mjs`, `scripts/cloudflare_headers.contract.test.mjs` and `scripts/check_bundle_size.mjs`.

The landing uses the simpler same-origin header policy because its scripts are external local files. Its build and browser assertions prohibit inline handlers, unexpected external requests and missing local assets. Sources: `apps/landing/_headers`, `apps/landing/test/static.test.mjs`, `scripts/verify_landing_browser.mjs`.

The dependency exception is narrow and time-limited. The audit script verifies the exact braces version, hashes and all four installed dependency paths, exercises depth boundaries and bypass attempts, and allows only the named advisory/version combination. Other high/critical findings and registry errors remain blocking. **The exception expires at 2026-11-03T00:00:00Z.** Persistent workspace advisory ignores are prohibited. This must be resolved or re-reviewed before that date; it is not an indefinitely reusable exception. Sources: `scripts/audit_dependencies.mjs`, its six parameterized tests, and `.github/workflows/supply-chain.yml`.

### Landing integrity and motion

The marketing site builds without node_modules, versions the complete browser module graph with one stable digest, excludes unused assets and retains font/icon licenses. A leaf module change must invalidate its parents' cached import URLs. Its official protocol mark still comes from a sibling mini-app source asset; “no dependencies to install” does not mean that a bare landing directory is self-contained. Telegram URLs, start parameters and generated QR modules have their own validation and parity assertions. Sources: `apps/landing/build.mjs`, `apps/landing/config.mjs` and `apps/landing/test/static.test.mjs`.

The market-data endpoint cannot select arbitrary upstreams. It accepts GET without query parameters, fetches only fixed sources, rejects redirects, caps bodies at 256 KiB, limits body-complete reads to eight seconds and caches for at most 60 seconds. Failures preserve independent healthy metrics. APY/TVL require the verified vault address; prices retain real upstream timestamps and validity limits. Browser-side validation repeats the source, numeric and freshness checks. Foreground resume expires stale values before waiting for a request; cancelled or older refreshes cannot publish. Sources: the three `apps/landing/test/market-data*.test.mjs` files and `apps/landing/market-data-server.mjs`.

The calculator is display-only. Its 50% LTV, 1.1–5 leverage range and ±10% price-move math describe marketing scenarios, not executable quotes or protocol limits. Missing live input remains unavailable, and verified numeric zero is not treated as missing. Source: `apps/landing/README.md`, calculator assertions in `static.test.mjs` and the browser gate.

Actual rendered assertions cover 44-pixel controls, selected text contrast of at least 4.5:1, focus handling, keyboard tabs and dialog behavior, viewport overflow, fresh/stale data, visible pixel changes, offscreen/hidden pauses and graphics failure. System reduced motion must stop decorative loops. Context loss, missing WebGL, save-data and disabled JavaScript retain responsive still artwork and usable launch links. The implementation caps drawing at 30 FPS and 1.5 device-pixel ratio. These are behavior and resource limits; the audit does not certify the aesthetic quality of frames it has not rendered. Sources: `scripts/verify_landing_browser.mjs` and `apps/landing/sculpture.js`.

The inspected landing's dark palette, fonts, four-card arrangement and exact copy are existing contracts, not restrictions on the user-authorized new art direction. Any deliberate visual change should update the design decision and corresponding assertions while retaining data honesty, usable controls, provenance and failure states.

### Fork and service boundaries

Fork proof runs separately from the normal release gate. The launcher binds to loopback, validates Anvil/Ethereum identity, keeps manual and automated sessions on separate ports/exports, strips production credentials from children, buffers log lines before redaction and cleans up only its owned process trees. A zero process exit without a valid required proof manifest is insufficient. Manifest validation prohibits provider URLs and credential fields and checks required transaction/position or Earn evidence. Sources: `scripts/run_anvil_tests.mjs`, its contract test and `.github/workflows/anvil-fork.yml`.

The browser proof contract includes bounded re-review before the first signature, reviewed-versus-actual sender/target/calldata parity, exact signature counts and receipt-ordered progress. Read-only details or alternate sessions cannot sign. Source-level assertions that these checks exist are not proof that a current fork run succeeded.

Telegram synchronization is idempotent and sequential: read, change if needed, read back, then continue. Request and readback bounds prevent indefinite waits; failures stop later writes, and diagnostics exclude tokens and request URLs. Source: `scripts/telegram_bot_sync.contract.test.mjs`.

## Coverage ledger

“Ledger rows” counts all records citing a file, including a gap that cites the original test to describe its limits. It is not a passing-test count. Parameterized and nested cases are listed separately because the static source inventory does not enumerate them.

| Test source | Static declarations | Additional named cases mapped | Ledger rows citing file |
| --- | ---: | --- | ---: |
| `apps/landing/test/market-data-client.test.mjs` | 3 | — | 7 |
| `apps/landing/test/market-data-server.test.mjs` | 8 | — | 17 |
| `apps/landing/test/market-data.test.mjs` | 5 | — | 12 |
| `apps/landing/test/static.test.mjs` | 12 | — | 62 |
| `scripts/audit_dependencies.test.mjs` | 0 | 6 parameterized | 6 |
| `scripts/build_environment.contract.test.mjs` | 5 | — | 7 |
| `scripts/check_live_gas_oracle.contract.test.mjs` | 5 | — | 10 |
| `scripts/cloudflare_headers.contract.test.mjs` | 2 | — | 2 |
| `scripts/deploy_workflow.contract.test.mjs` | 7 | — | 26 |
| `scripts/e2e_typecheck.contract.test.mjs` | 3 | — | 4 |
| `scripts/generate_csp_headers.contract.test.mjs` | 4 | — | 13 |
| `scripts/launch_readiness.test.mjs` | 2 | — | 6 |
| `scripts/release_revision.test.mjs` | 6 | 6 nested | 15 |
| `scripts/run_anvil_tests.contract.test.mjs` | 5 | — | 16 |
| `scripts/telegram_bot_sync.contract.test.mjs` | 10 | — | 18 |
| `scripts/verify_architecture.contract.test.mjs` | 2 | — | 2 |
| `scripts/verify_built_rpc_config.test.mjs` | 8 | — | 10 |
| `scripts/verify_frontend_secrets.test.mjs` | 2 | — | 3 |
| `scripts/verify_live_public_config.contract.test.mjs` | 1 | — | 3 |
| `scripts/verify_phases.contract.test.mjs` | 6 | — | 16 |
| `apps/mini-app/test/e2e-serve.test.mjs` | 1 | — | 5 |

The complete machine-readable requirement list is [delivery-behaviors.json](delivery-behaviors.json). Coverage validation found **zero unmapped static declarations in this scope**, unique IDs, the requested schema on every row and existing local evidence paths.

## Delivery document classification

| Document | Classification | Use and boundary |
| --- | --- | --- |
| `SETUP.md` | Used | Toolchain, workspace, public environment and separate verification setup. |
| `CONTRIBUTING.md` | Used | Explicit authorization, transaction boundary, honest verification reporting and repository hygiene. Product/security ledgers own detailed financial requirements. |
| `.github/pull_request_template.md` | Used | Human review prompt; checkbox completion is not a machine gate. |
| `docs/deployment.md` | Used | Two projects, configuration boundary, production artifact sequence, dashboard prerequisite and rollback. |
| `docs/testing.md` | Used with reconciliation | Gate entry points and evidence limits; seven/sequential browser wording is stale. |
| `docs/browser-test-gates.md` | Used with reconciliation | Suite separation and scope limits; two current harnesses and concurrency model need reconciliation. |
| `docs/launch-readiness.md` | Used | Release review tasks, separate native/bridge evidence and disclosure checks; not a current completion record. |
| `docs/release-validation.md` | Historical | Evidence for source `ae59fe1` and later deployment `d66a7f7`; does not establish current baseline results. |
| `apps/landing/README.md` | Used | Standalone build, data constraints, motion/fallbacks, scenarios and verification boundaries. |
| `apps/mini-app/e2e/performance-evidence.md` | Historical/reference | Recorded fixture timing methodology and limits; no before baseline, live RPC execution or physical-device claim. |

Other inventory documents are classified by the product/security audit owners. This scoped report makes no claim that historical documentation is current execution proof.

## Gaps and decisions before acceptance

| ID | Requirement or decision | Current limit |
| --- | --- | --- |
| DEL-0336 | Testing documentation must be reconciled with the current nine-harness partition and bounded parallel execution. | Current scripts/verify.mjs has nine harnesses and concurrency two (or one in serial mode). docs/browser-test-gates.md also omits the wallet-provider and mobile-wallet rows. |
| DEL-0337 | The live wallet-configuration probe needs behavioral failure-path evidence before being treated as strong deployed-artifact provenance proof. | The current test asserts three source strings. verify_live_public_config.mjs uses substring inclusion and default fetch redirect handling; its revision query is cache context, not proof binding every fetched chunk to that revision. New runtime tests should cover false/stale matches, redirects, unexpected final origins and bounded body completion. |
| DEL-0338 | Gas-health reporting must distinguish schema validity from a freshness guarantee. | The verifier accepts any boolean stale value and nonnegative safe-integer fetchedAt; it does not reject stale=true or compare age to the current clock. Do not claim that this health check independently proves a current gas estimate. |
| DEL-0339 | The current full verification run must pass before build/browser/release readiness is claimed. | Root reported full pnpm verify exit 1 from a registry audit timeout; unit/chaos results were 1,611 pass, four fork skips, zero failures. Build and browser gates were not reached. This agent did not rerun these gates. |
| DEL-0340 | Browser and fork evidence must record actual runtime versions and any deviations from the pinned release environment. | Root reported pinned Chromium 156 download truncation, a working Chromium 153.0.8010.0 executablePath fallback, and local Anvil 1.7.1 versus CI 1.8.1. These are setup facts, not passing browser or fork proof. |
| DEL-0341 | Protected fork acceptance requires a successful authorized read-only upstream and redacted proof manifests for the actual candidate. | Root reported the tested Publicnode read-only RPC returned HTTP 403. No current fork evidence was available at this audit milestone; historical manifests must not fill that gap. |
| DEL-0342 | GitHub protection settings and Cloudflare production deployment exclusivity require separate release-time verification. | Source declares a production environment and documents disabling automatic production Git deployments; this audit did not inspect remote environment reviewers, branch protections, dashboard settings or provider origin restrictions. |
| DEL-0343 | Static asset budgets must not be presented as measured responsiveness or a production performance improvement. | The size guardrails are source-enforced release limits. Current device/network performance and a comparable before baseline are not established by them. |
| DEL-0344 | The landing's sibling canonical-mark dependency must be decided explicitly if the rebuild separates its source tree. | The dependency-free build test supplies ../mini-app/public/brand/fx-official-mark.svg. No node_modules is required, but a bare landing directory without that asset is not self-contained. |

The public wallet probe deserves stronger behavioral evidence in the rebuild: its existing test checks source structure, and its content search does not bind all fetched chunks to the verified revision. Likewise, the gas-health script currently validates a schema, not age: it accepts any boolean `stale` and any nonnegative safe `fetchedAt`. These findings do not overturn the separate exact release-marker checks; they define the practical limits of the later health/configuration steps.

No implementation or publication approval is requested by this audit. The next authorized milestone should use these records to decide the new architecture and long vertical-slice acceptance gates, then implement independently of the old application code.

