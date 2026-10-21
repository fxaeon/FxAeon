# Position screenshot fixture

Capture procedure and provenance reference. See [testing](testing.md#evidence-boundaries)
for how screenshot, local-fork, and production evidence differ.

The populated position images show four ETH/BTC long/short positions on a
disposable Ethereum fork. The pinned block and proof assertions are recorded
in the [position screenshot manifest](fixtures/position-screenshot-manifest.json)
and may change when the fixture is regenerated. The browser proof opens and
closes the positions, checks ownership and nonzero accounting, then restores
the fork snapshot. It does not use production funds or a native wallet.

The current position image set is in [`assets/`](assets/) and its exact IDs,
hashes, routes, and capture assertions are recorded in
[`fixtures/position-screenshot-manifest.json`](fixtures/position-screenshot-manifest.json).
The proof log is separate at `artifacts/anvil/browser-proof.json`. A screenshot
manifest records rendered state; it does not independently prove transaction
execution.

Prices and charts in these images are synthetic display fixtures and are
visibly labelled as illustrative. They do not represent fork-block oracle
prices, execution quotes, returns, or P&L. The underlying position state is
verified against the fork.

## Regenerate the browser proof and captures

Install Foundry/Anvil and Chromium, then provide a restricted Ethereum RPC
endpoint through the environment:

```powershell
pnpm --dir apps/mini-app exec playwright install chromium
$env:ANVIL_FORK_URL = '<restricted Ethereum RPC URL>'
pnpm test:anvil:browser
```

The gate owns its disposable local node, runs the browser path, and captures
images before restoring the node snapshot. Review the new proof and manifest
before promoting any captures into documentation or the landing site. Keep RPC
URLs, transaction hashes, account secrets, and private staged data out of the
committed manifest.

For display-only UI updates without browser transaction proof, use
`pnpm docs:screenshots`; its manifest is separate at
[`fixtures/standard-screenshot-manifest.json`](fixtures/standard-screenshot-manifest.json).
The optional `pnpm docs:screenshots:positions` Node-runner path can render
fork-backed positions, but it does not replace the browser execution proof.
