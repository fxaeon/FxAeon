# FxAeon — replacement client checkpoint

This directory is the independently authored replacement for FxAeon. The old
application remains intact while the rebuild establishes behavior parity.
The current checkpoint covers **a new ETH long funded with native ETH**:
exact input → installed SDK planning → independent policy/economic checks →
simulation → explicit review → selected-wallet request → canonical receipt,
position proof and account-scoped history.

This is **step 3**, not the finished product or the step-5 parity gate. Actual
protocol transactions on a local fork, native Telegram authentication and
physical wallet handoff remain unverified. No production funds were used.

## Read first

- [Behavior specification](../BEHAVIOR_SPEC.md) and its three evidence ledgers.
- [Architecture and design decisions](../DECISIONS.md), including the explicit
  exception preserving reviewed vendor patches byte-for-byte.
- [Reference study](../docs/rebuild/REFERENCES.md): each supplied repository has
  an adopt/avoid mapping to FxAeon's product surfaces.
- [Design system](docs/DESIGN_SYSTEM.md), [plan](../PLAN.md) and [issues](../ISSUES.md).
- [Checkpoint evidence](docs/CHECKPOINT.md) and [acceptance map](docs/SLICE_ACCEPTANCE.json).

## Run the production client

Use Node **22.23.4** and pnpm **11.19.0**. The exact new dependency graph lives
in this directory's lock; its workspace boundary prevents accidental use of the
legacy workspace installation.

```sh
cd rebuild
pnpm install --frozen-lockfile
pnpm build
pnpm preview
```

Open `http://127.0.0.1:4173/` for the landing or `/app/` for Trade. `pnpm dev`
starts the Vite development server on the same loopback port. Do not run two
servers on that port at once.

With no RPC configuration, the production UI states that verified market data
is unavailable and refuses to prepare live trades. It does not use placeholder
prices or silently select a public provider.

For a reviewed deployment, copy `.env.example` to `.env.local` and set
`VITE_ETHEREUM_RPC_URLS` to one to three approved Ethereum Alchemy/Infura HTTPS
URLs, separated by commas. These are **public browser configuration**, not server
secrets; restrict provider access by origin/quota. Rebuild after changing them.
The app accepts only the exact endpoint forms validated by `src/protocol/rpc.ts`.

Connecting is explicit. Only the selected EIP-6963/EIP-1193 provider can sign.
The first slice has no embedded-wallet authentication. The Telegram host
adapter supports viewport/safe-area/Back/theme behavior and a user-triggered
MetaMask handoff; those are not proof of native device or authentication parity.

## Explore the simulation without funds

The deterministic preview is a **separate build graph**, available only on
loopback. It renders the real application/controller/wallet adapter with
synthetic protocol responses. Its permanent Simulation labels remain visible.

```sh
pnpm build:fixture
node scripts/serve.mjs --dir dist-fixture --port 4173
```

Open `http://127.0.0.1:4173/app/?scenario=success`, connect the explicitly
simulated injected wallet, enter an amount and review it. The fixture makes no
public RPC request and does not access a real wallet or private key.

Additional `scenario` values are `reject`, `unknown-send`, `pending`, `reverted`,
`missing-position`, `receipt-error`, `wrong-chain`, `nonce-drift`, `account-change`,
`simulation-error`, `insufficient-funds` and `slow-quote`. `ttl=1000` exercises a
one-second review. These switches exist only in the simulation build; the
production runtime cannot select them from the URL.

## Verification

```sh
pnpm verify
```

The **checkpoint** command runs isolated named unit/integration cases, strict
TypeScript, the production build, exact installed SDK/patch and architectural
checks, production bundle budgets, the separate simulation build, running
browser acceptance and a bounded registry dependency audit. It fails on the
first unsuccessful stage and records the completed scope. It is explicitly not
the unfinished full-product/fork/native-device release gate.

The unit harness runs a deliberate failing typed canary first. It then requires
real named TAP cases, no skips and zero failures from each isolated test module.
This prevents file-only success output from being mistaken for executed tests
when an environment blocks test subprocesses. Child-process execution must be
available for a valid aggregate result.

Playwright 1.64.1 requests its pinned Chromium 156. In this workspace, that
download failed and the supplemental browser is Chromium 153.0.8010.0. The
explicit `FXAEON_CHROMIUM_EXECUTABLE` override identifies that fallback; it is
not a pinned-browser pass. See [browser acceptance](test/browser/README.md).

The integration case uses the **actual installed SDK**, public protocol factory,
real controller and selected-wallet adapter. Only external RPC/index responses
are deterministic. That proves component composition; it does not establish
that a real transaction executes against current f(x) contracts. Step 5 still
requires actual transactions on a disposable, proven local Ethereum fork.

## Architecture

| Boundary | Responsibility |
| --- | --- |
| `src/domain` | Exact amounts, accepted intent, state machine, dispatch guard and conservative recovery journal |
| `src/protocol` | Fixed SDK facade, approved read transport, canonical ABI policy, independent economics, simulation, receipt/ownership proof |
| `src/wallet` | Explicit provider selection, exact raw capability, fresh context checks and the sole application transaction-request site |
| `src/host` | Browser/Telegram viewport and Back behavior, theme and sanitized explicit wallet handoff |
| `src/ui` | Accessible, responsive rendering and presentation-only overlays |
| `src/runtime.ts` | Production composition; no test-scenario selection |
| `test/fixtures` | Separate loopback-only synthetic responses; absent from production output |
| `scripts` | Local verification, static preview and bounded audit; no production planning or signing service |
| `vendor` | Exact reviewed SDK correction input and installed artifact hashes |

The approved protocol surface remains exactly 15 pinned SDK methods. This
checkpoint uses `increasePosition` and `getPositions`; the other methods are
preserved in the scope contract for later modules, not falsely presented as
implemented product screens.

## Storage and recovery

Before a wallet prompt, the prospective attempt must be saved and read back.
If browser storage is denied, signing stops with a clear message. A storage
error after dispatch cannot discard the in-memory hash. Other tabs recheck
persisted unresolved attempts inside the shared wallet lock.

Stored labels are hints. Reloading never restores an executable review, and a
stored confirmed/declined label cannot prove a fresh outcome. Unknown submission
does not expose a resend button. A restored no-hash attempt conservatively
requires further wallet/chain investigation; automatic clearing is not implemented.

## Delivery and remaining scope

The local preview server applies the built `public/_headers` security policy.
The eventual static host must apply equivalent CSP, referrer, MIME, cache and
frame rules; no deployment has been performed at this checkpoint.

Remaining modules include all other assets/markets and position actions, Borrow,
Earn, Move, full portfolio/history, transfers, native Telegram/Privy, complete
SDK patch regression breadth, final landing/documentation, CI cutover and all
release checks. `DECISIONS.md` defines each module's acceptance boundary. The
old tree is replaced only after every specification record has an accepted new
test mapping and the complete local-fork parity gate passes.
