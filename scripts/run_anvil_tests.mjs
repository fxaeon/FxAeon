import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createServer } from "node:net";

const root = fileURLToPath(new URL("..", import.meta.url));
const previewMode = process.argv.slice(2).includes("--preview");
const port = parsePort(previewMode
  ? process.env.FX_FORK_PREVIEW_ANVIL_PORT ?? "8548"
  : process.env.ANVIL_PORT ?? "8547", previewMode ? "FX_FORK_PREVIEW_ANVIL_PORT" : "ANVIL_PORT");
// The product runner requires one canonical confirmation by default; callers
// may request deeper confirmation depth. Interval mining keeps receipt
// finality deterministic for every fork suite, including browser flows that
// cannot issue a second manual mine after each wallet request.
const blockTime = parseBlockTime(process.env.ANVIL_BLOCK_TIME ?? "1");
const rpcUrl = `http://127.0.0.1:${port}`;
const suite = parseSuite(process.argv.slice(2));
if (previewMode && suite !== "browser") throw new Error("--preview is only supported with --suite browser");
const browserPort = suite === "browser" ? parsePort(previewMode
  ? process.env.FX_FORK_PREVIEW_BROWSER_PORT ?? "4326"
  : process.env.FX_FORK_BROWSER_PORT ?? "4325", previewMode ? "FX_FORK_PREVIEW_BROWSER_PORT" : "FX_FORK_BROWSER_PORT") : undefined;
if (browserPort === port) throw new Error("Anvil and browser server must use different ports");
const manifestPath = resolveManifestPath(process.env.FX_ANVIL_MANIFEST_PATH);
// Prefer the dedicated fork secret, but make the operator's reviewed
// Ethereum Alchemy endpoint usable for the heavy fork gate too. The URL is
// consumed only by Anvil and is scrubbed before the application test process.
const forkUrl = [
  process.env.ANVIL_FORK_URL,
  process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL,
  process.env.ALCHEMY_RPC_URL,
].map((value) => value?.trim()).find(Boolean);

function parseSuite(args) {
  let requested = process.env.FX_ANVIL_SUITE?.trim().toLowerCase() || "protocol";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--suite") {
      requested = args[index + 1]?.trim().toLowerCase();
      index += 1;
    } else if (argument.startsWith("--suite=")) {
      requested = argument.slice("--suite=".length).trim().toLowerCase();
    } else if (argument === "--preview") {
      continue;
    } else {
      throw new Error("unknown Anvil test argument; use --suite protocol, earn, stress, all, browser, or --preview");
    }
  }
  if (!["protocol", "earn", "stress", "all", "browser"].includes(requested)) {
    throw new Error("Anvil test suite must be protocol, earn, stress, all, or browser");
  }
  return requested;
}

function resolveManifestPath(configured) {
  const candidate = configured?.trim() || join("artifacts", "anvil", suite === "browser"
    ? previewMode ? "browser-preview-proof.json" : "browser-proof.json"
    : suite === "earn" ? "earn-proof.json" : "protocol-proof.json");
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const fromRoot = relative(root, resolved);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("FX_ANVIL_MANIFEST_PATH must be a file below the repository root");
  }
  return resolved;
}

function parsePort(value, label) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error(`${label} must be a decimal integer between 1024 and 65535`);
  }
  return parsed;
}

function parseBlockTime(value) {
  const parsed = Number(value);
  if (!/^(?:\d+)(?:\.\d+)?$/.test(value) || !Number.isFinite(parsed) || parsed <= 0 || parsed > 60) {
    throw new Error("ANVIL_BLOCK_TIME must be a positive number of seconds no greater than 60");
  }
  return parsed;
}

function assertForkUrl(value) {
  if (!value) throw new Error("ANVIL_FORK_URL (or NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL) is required; supply a fresh restricted HTTPS fork URL through your secret store");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ANVIL_FORK_URL must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ANVIL_FORK_URL must be a clean HTTPS endpoint without embedded credentials, query, or fragment");
  }
}

function redacted(value) {
  // Never print a provider key or URL, even if Anvil echoes its command line.
  let output = String(value);
  if (forkUrl) output = output.replaceAll(forkUrl, "[redacted fork URL]");
  // Anvil prints disposable account private keys in its default banner. Keep
  // those out of CI logs as well; all 32-byte hex values are non-authoritative
  // test artifacts and may include keys, hashes, or fork internals.
  output = output.replace(/0x[0-9a-f]{64}/gi, "[redacted 32-byte hex]");
  output = output.replace(/(https?:\/\/[^\s"'<>]+)(?=[\s"'<>]|$)/gi, (url) => {
    if (url.includes("127.0.0.1") || url.includes("localhost")) return url;
    return "[redacted external URL]";
  });
  return output;
}

function scrubChildEnvironment() {
  const childEnv = {
    ...process.env,
    ANVIL_PORT: String(port),
    ANVIL_RPC_URL: rpcUrl,
    FX_ANVIL_FORKED: "1",
    FX_ANVIL_SUITE: suite,
    NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE: "1",
    NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL: rpcUrl,
  };
  if (previewMode) {
    childEnv.FX_FORK_PREVIEW = "1";
    childEnv.FX_FORK_BROWSER_PORT = String(browserPort);
    childEnv.FX_E2E_DIST_DIR = `dist-fork-preview-${browserPort}`;
  } else {
    delete childEnv.FX_FORK_PREVIEW;
    delete childEnv.FX_E2E_DIST_DIR;
    if (browserPort !== undefined) childEnv.FX_FORK_BROWSER_PORT = String(browserPort);
  }
  if (suite !== "stress") {
    childEnv.FX_ANVIL_MANIFEST_PATH = manifestPath;
    childEnv.FX_ANVIL_EARN_MANIFEST_PATH = suite === "earn"
      ? manifestPath
      : resolve(root, "artifacts", "anvil", "earn-proof.json");
  } else {
    delete childEnv.FX_ANVIL_MANIFEST_PATH;
    delete childEnv.FX_ANVIL_EARN_MANIFEST_PATH;
  }
  // The integration test uses only the local fork. Do not unnecessarily pass
  // production provider, bot, wallet, or deployment credentials to it.
  for (const name of [
    "ANVIL_FORK_URL",
    "NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL",
    "NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL",
    "ALCHEMY_RPC_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN_SECRET",
    "PRIVY_APP_SECRET",
    "CLOUDFLARE_API_TOKEN",
  ]) delete childEnv[name];
  const allowedLocalEndpoints = new Set([
    "ANVIL_RPC_URL",
    "NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL",
  ]);
  for (const name of Object.keys(childEnv)) {
    if (allowedLocalEndpoints.has(name)) continue;
    if (/(?:^|_)(?:SECRET|TOKEN|PRIVATE_KEY|MNEMONIC|API_KEY|FORK_URL|RPC_URL)$/i.test(name)) {
      delete childEnv[name];
    }
  }
  return childEnv;
}

async function assertLoopbackPortAvailable(localPort) {
  const probe = createServer();
  await new Promise((resolveProbe, reject) => {
    probe.once("error", () => reject(new Error(`loopback port ${localPort} is already in use; choose another test port`)));
    probe.listen(localPort, "127.0.0.1", () => probe.close(resolveProbe));
  });
}

function validateProtocolManifest() {
  if (!existsSync(manifestPath)) {
    throw new Error("real protocol proof passed without producing its manifest");
  }
  const text = readFileSync(manifestPath, "utf8");
  if (forkUrl && text.includes(forkUrl)) {
    throw new Error("protocol proof manifest contains the upstream fork URL");
  }
  if (/https?:\/\//i.test(text)) {
    throw new Error("protocol proof manifest contains a forbidden URL");
  }
  const manifest = JSON.parse(text);
  const containsSensitiveField = (value) => {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, nested]) => (
      /^(private.?key|mnemonic|fork.?url|rpc.?url|provider.?credential)$/i.test(key)
      || containsSensitiveField(nested)
    ));
  };
  if (containsSensitiveField(manifest)) {
    throw new Error("protocol proof manifest contains a forbidden credential field");
  }
  const positions = Array.isArray(manifest?.positions) ? manifest.positions : [];
  const partialReductions = Array.isArray(manifest?.partialReductions) ? manifest.partialReductions : [];
  const closedPositions = Array.isArray(manifest?.closedPositions) ? manifest.closedPositions : [];
  const externalPosition = manifest?.externalPosition;
  const scenarios = new Set(positions.map((position) => `${position?.market}:${position?.side}`));
  const expectedScenarios = ["ETH:long", "ETH:short", "BTC:long", "BTC:short"];
  const positionEvidenceValid = positions.length === 4 && positions.every((position) => (
    /^0x[0-9a-f]{40}$/i.test(position?.pool ?? "")
    && Number.isSafeInteger(position?.positionId)
    && position.positionId > 0
    && BigInt(position?.rawCollateral ?? "0") > 0n
    && BigInt(position?.rawDebt ?? "0") > 0n
    && Array.isArray(position?.transactions)
    && position.transactions.some((transaction) => (
      transaction?.kind === "action"
      && /^0x[0-9a-f]{64}$/i.test(transaction?.hash ?? "")
      && BigInt(transaction?.blockNumber ?? "0") > 0n
    ))
  ));
  const partialReductionEvidenceValid = suite === "browser" || (
    partialReductions.length === 4
    && partialReductions.every((reduction) => (
      ["ETH", "BTC"].includes(reduction?.market)
      && ["long", "short"].includes(reduction?.side)
      && Number.isSafeInteger(reduction?.positionId)
      && reduction.positionId > 0
      && /^0x[0-9a-f]{40}$/i.test(reduction?.pool ?? "")
      && BigInt(reduction?.requestedAmountWei ?? "0") > 0n
      && reduction?.reductionFractionBps === 2500
      && BigInt(reduction?.rawCollateralBefore ?? "0") > BigInt(reduction?.rawCollateralAfter ?? "0")
      && BigInt(reduction?.rawCollateralAfter ?? "0") > 0n
      && BigInt(reduction?.rawDebtBefore ?? "0") > BigInt(reduction?.rawDebtAfter ?? "0")
      && BigInt(reduction?.rawDebtAfter ?? "0") > 0n
      && BigInt(reduction?.usdcAfter ?? "0") > BigInt(reduction?.usdcBefore ?? "0")
      && Array.isArray(reduction?.transactions)
      && reduction.transactions.length > 0
      && reduction.transactions.every((transaction) => (
        /^0x[0-9a-f]{64}$/i.test(transaction?.hash ?? "")
        && BigInt(transaction?.blockNumber ?? "0") > 0n
      ))
    ))
  );
  const closedEvidenceValid = suite !== "browser" || (
    closedPositions.length === 4
    && closedPositions.every((position) => (
      ["ETH", "BTC"].includes(position?.market)
      && ["long", "short"].includes(position?.side)
      && Number.isSafeInteger(position?.positionId)
      && position.positionId > 0
      && Array.isArray(position?.transactions)
      && position.transactions.length > 0
      && position.transactions.every((transaction) => (
        /^0x[0-9a-f]{64}$/i.test(transaction?.hash ?? "")
        && BigInt(transaction?.blockNumber ?? "0") > 0n
      ))
    ))
  );
  const externalEvidenceValid = suite !== "browser" || (
    externalPosition
    && externalPosition.market === "ETH"
    && externalPosition.side === "long"
    && /^0x[0-9a-f]{40}$/i.test(externalPosition.pool ?? "")
    && Number.isSafeInteger(externalPosition.positionId)
    && externalPosition.positionId > 0
    && /^0x[0-9a-f]{40}$/i.test(externalPosition.createdBy ?? "")
    && /^0x[0-9a-f]{40}$/i.test(externalPosition.transferredTo ?? "")
    && /^0x[0-9a-f]{40}$/i.test(externalPosition.transferredBackTo ?? "")
    && /^0x[0-9a-f]{40}$/i.test(externalPosition.finalOwner ?? "")
    && BigInt(externalPosition.rawCollateral ?? "0") > 0n
    && BigInt(externalPosition.rawDebt ?? "0") > 0n
    && Array.isArray(externalPosition.transactions)
    && externalPosition.transactions.length > 0
    && externalPosition.transactions.every((transaction) => (
      /^0x[0-9a-f]{64}$/i.test(transaction?.hash ?? "")
      && BigInt(transaction?.blockNumber ?? "0") > 0n
    ))
  );
  if (
    manifest?.proof !== "fxaeon-real-fx-position-fork"
    || manifest?.chainId !== 1
    || manifest?.assertions?.scenarioCount !== 4
    || manifest?.assertions?.coexistingInSingleSnapshot !== true
    || manifest?.assertions?.ownershipVerified !== true
    || manifest?.assertions?.nonzeroCollateralAndDebtVerified !== true
    || (suite !== "browser" && manifest?.assertions?.partialReductionVerified !== true)
    || (suite !== "browser" && manifest?.assertions?.partialReductionPreservedOwnershipAndIds !== true)
    || (suite !== "browser" && manifest?.assertions?.partialReductionChangedOnlyTargetPosition !== true)
    || (suite !== "browser" && manifest?.assertions?.partialReductionReturnedSelectedOutput !== true)
    || manifest?.assertions?.snapshotRevertedAfterProof !== true
    || (suite === "browser" && manifest?.assertions?.submittedExplorerBeforeConfirmation !== true)
    || (suite === "browser" && manifest?.assertions?.confirmedPositionBeforeIndexer !== true)
    || (suite === "browser" && manifest?.assertions?.restoredConfirmedPosition !== true)
    || (suite === "browser" && manifest?.assertions?.directWalletDiscoveryWithIndexerLagVerified !== true)
    || (suite === "browser" && manifest?.assertions?.externalPositionWithoutJournalVerified !== true)
    || (suite === "browser" && manifest?.assertions?.ownershipTransferIsolationVerified !== true)
    || (suite === "browser" && manifest?.assertions?.canonicalPositionParityVerified !== true)
    || (suite === "browser" && manifest?.assertions?.browserDriven !== true)
    || (suite === "browser" && manifest?.assertions?.directCloseActionVerified !== true)
    || (suite === "browser" && manifest?.assertions?.everySupportedPositionClosed !== true)
    || (suite === "browser" && manifest?.assertions?.closeOutputBalanceRefreshVerified !== true)
    || (suite === "browser" && manifest?.assertions?.quoteExpiryBlockedUntilRefresh !== true)
    || (suite === "browser" && manifest?.assertions?.earnDepositReviewVerified !== true)
    || (suite === "browser" && manifest?.assertions?.earnDepositCalldataBoundToReviewedAmountAndRecipient !== true)
    || (suite === "browser" && manifest?.assertions?.earnInstantWithdrawalReviewVerified !== true)
    || (suite === "browser" && manifest?.assertions?.earnInstantWithdrawalCalldataBoundToSelectedShares !== true)
    || (suite === "browser" && manifest?.assertions?.earnAfterCooldownReviewVerified !== true)
    || (suite === "browser" && manifest?.assertions?.earnAfterCooldownCalldataBoundToSelectedShares !== true)
    || (suite === "browser" && manifest?.assertions?.moveExecutionVerified !== false)
    || (suite === "browser" && typeof manifest?.assertions?.moveExecutionNotTestedReason !== "string")
    || expectedScenarios.some((scenario) => !scenarios.has(scenario))
    || !positionEvidenceValid
    || !partialReductionEvidenceValid
    || !closedEvidenceValid
    || !externalEvidenceValid
  ) {
    throw new Error("protocol proof manifest is incomplete or failed its release-evidence schema");
  }
  process.stdout.write(`Verified redacted four-position ${suite === "browser" ? "open-and-close browser" : "protocol"} proof manifest at ${relative(root, manifestPath)}\n`);
}

function validateEarnManifest() {
  const earnPath = suite === "earn" ? manifestPath : resolve(root, "artifacts", "anvil", "earn-proof.json");
  if (!existsSync(earnPath)) throw new Error("real fxSAVE proof passed without producing its manifest");
  const text = readFileSync(earnPath, "utf8");
  if (forkUrl && text.includes(forkUrl)) throw new Error("fxSAVE proof manifest contains the upstream fork URL");
  if (/https?:\/\//i.test(text)) throw new Error("fxSAVE proof manifest contains a forbidden URL");
  const manifest = JSON.parse(text);
  const containsSensitiveField = (value) => {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, nested]) => (
      /^(private.?key|mnemonic|fork.?url|rpc.?url|provider.?credential)$/i.test(key)
      || containsSensitiveField(nested)
    ));
  };
  if (containsSensitiveField(manifest)) throw new Error("fxSAVE proof manifest contains a forbidden credential field");
  const txHash = /^0x[0-9a-f]{64}$/i;
  const actions = Array.isArray(manifest?.actions) ? manifest.actions : [];
  const requiredOperations = new Set([
    "depositFxSave",
    "withdrawFxSave.instant",
    "withdrawFxSave.directBasePool",
    "depositFxSave.directBasePool",
    "withdrawFxSave.queued",
    "getRedeemTx",
    "depositFxSave.fxUSD",
  ]);
  const operationNames = new Set(actions.map((action) => action?.operation));
  const txEvidenceValid = actions.length === requiredOperations.size && actions.every((action) => (
    typeof action?.operation === "string"
    && Array.isArray(action?.transactions)
    && action.transactions.length > 0
    && action.transactions.some((tx) => tx?.kind === "action")
    && action.transactions.every((tx) => txHash.test(tx?.hash ?? "") && BigInt(tx?.blockNumber ?? "0") > 0n)
  ));
  const feeEvidence = manifest?.feeEvidence;
  const feeEvidenceFields = [
    feeEvidence?.instantRedeemFeeRatio,
    feeEvidence?.grossYield,
    feeEvidence?.grossStable,
    feeEvidence?.feeAdjustedYield,
    feeEvidence?.feeAdjustedStable,
    feeEvidence?.executionGrossYield,
    feeEvidence?.executionGrossStable,
    feeEvidence?.executionFeeAdjustedYield,
    feeEvidence?.executionFeeAdjustedStable,
    feeEvidence?.eventShares,
    feeEvidence?.eventYield,
    feeEvidence?.eventStable,
    feeEvidence?.quotedYieldToUsdc,
    feeEvidence?.quotedStableToUsdc,
    feeEvidence?.actualUsdc,
  ];
  const feeEvidenceValid = feeEvidenceFields.every((value) => typeof value === "string" && /^\d+$/.test(value))
    && BigInt(feeEvidence.instantRedeemFeeRatio) > 0n
    && BigInt(feeEvidence.grossYield) > BigInt(feeEvidence.feeAdjustedYield)
    && BigInt(feeEvidence.grossStable) > BigInt(feeEvidence.feeAdjustedStable)
    && BigInt(feeEvidence.executionGrossYield) > BigInt(feeEvidence.executionFeeAdjustedYield)
    && BigInt(feeEvidence.executionGrossStable) > BigInt(feeEvidence.executionFeeAdjustedStable)
    && BigInt(feeEvidence.eventShares) > 0n
    && feeEvidence.eventYield === feeEvidence.executionFeeAdjustedYield
    && feeEvidence.eventStable === feeEvidence.executionFeeAdjustedStable
    && BigInt(feeEvidence.actualUsdc) > 0n;
  const assertions = manifest?.assertions;
  if (
    manifest?.proof !== "fxaeon-real-fxsave-fork"
    || manifest?.chainId !== 1
    || assertions?.sdkDeposit !== true
    || assertions?.instantWithdraw !== true
    || assertions?.queuedWithdraw !== true
    || assertions?.cooldownObserved !== true
    || assertions?.claim !== true
    || assertions?.directBasePoolDeposit !== true
    || assertions?.directBasePoolRedeem !== true
    || assertions?.balancesVerified !== true
    || assertions?.sharesVerified !== true
    || assertions?.eventsVerified !== true
    || assertions?.feesVerified !== true
    || assertions?.snapshotRevertedAfterProof !== true
    || [...requiredOperations].some((operation) => !operationNames.has(operation))
    || !feeEvidenceValid
    || !txEvidenceValid
  ) throw new Error("fxSAVE proof manifest is incomplete or failed its release-evidence schema");
  process.stdout.write(`Verified redacted fxSAVE proof manifest at ${relative(root, earnPath)}\n`);
}

function spawnWithRedaction(command, args, options = {}) {
  assertNotInterrupted();
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // Each Unix subprocess owns an isolated process group, so cleanup never
    // needs name-based or machine-wide process killing.
    detached: process.platform !== "win32",
  });
  child.on("error", (error) => { child.startupError = error; });
  const pipe = (stream, target) => {
    let pending = "";
    stream?.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/(\r?\n)/);
      // Keep the unterminated line until its newline arrives so a private key
      // or provider URL split across stream chunks cannot bypass redaction.
      pending = lines.pop() ?? "";
      target.write(redacted(lines.join("")));
    });
    stream?.on("end", () => {
      if (pending) target.write(redacted(pending));
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(5_000), shutdownController.signal]),
  });
  if (!response.ok) throw new Error(`local Anvil RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`local Anvil RPC error: ${payload.error.message ?? "unknown error"}`);
  return payload.result;
}

async function waitForAnvil(child) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    assertNotInterrupted();
    assertAnvilRunning(child);
    let chainId;
    let clientVersion;
    try {
      chainId = await rpc("eth_chainId");
      clientVersion = await rpc("web3_clientVersion");
    } catch (error) {
      lastError = error;
      assertNotInterrupted();
      assertAnvilRunning(child);
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    assertNotInterrupted();
    assertAnvilRunning(child);
    if (chainId !== "0x1") throw new Error(`Anvil fork chain identity was ${String(chainId)}, expected Ethereum mainnet`);
    if (typeof clientVersion !== "string" || !/^anvil\//i.test(clientVersion)) throw new Error("local fork endpoint did not identify as Anvil");
    return;
  }
  throw new Error(`timed out waiting for Anvil RPC: ${lastError instanceof Error ? lastError.message : "endpoint unavailable"}`);
}

function assertAnvilRunning(child) {
  if (child.startupError) throw new Error(child.startupError.code === "ENOENT"
    ? "Anvil was not found; install Foundry and ensure ANVIL_BIN/anvil is on PATH"
    : "Anvil could not be started");
  if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Anvil exited before its RPC endpoint became ready (exit ${child.exitCode})`);
}

function commandForPnpm() {
  const inherited = process.env.npm_execpath;
  if (inherited && existsSync(inherited) && /pnpm(?:\.c?js)?$/i.test(inherited)) return { command: process.execPath, args: [inherited] };
  return process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "pnpm.cmd"] }
    : { command: "pnpm", args: [] };
}

let anvil;
let tests;
let interrupted = false;
let cleanupPromise;
const shutdownController = new AbortController();

function assertNotInterrupted() {
  if (interrupted) throw new Error("Anvil test run was interrupted");
}

function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function stopOwnedProcessTree(child) {
  if (!child?.pid) return;
  if (child.stopPromise) return child.stopPromise;
  child.stopPromise = (async () => {
    if (process.platform === "win32") {
      // A live ChildProcess handle establishes ownership of this PID. Avoid
      // targeting an exited/reused PID, and never kill by executable name.
      if (child.exitCode !== null || child.signalCode !== null) return;
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      await new Promise((resolveStop, reject) => {
        const timer = setTimeout(() => { killer.kill(); reject(new Error("timed out stopping the owned test process tree")); }, 10_000);
        killer.once("error", (error) => { clearTimeout(timer); reject(error); });
        killer.once("exit", (code) => {
          clearTimeout(timer);
          if (code !== 0 && child.exitCode === null && child.signalCode === null) reject(new Error("could not stop the owned test process tree"));
          else resolveStop();
        });
      });
      return;
    }
    // detached:true created this exact group. Descendants remain members if
    // the package-manager parent exits before its browser/server children.
    if (!groupExists(child.pid)) return;
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && groupExists(child.pid)) await new Promise((resolveStop) => setTimeout(resolveStop, 50));
    if (groupExists(child.pid)) {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  })();
  return child.stopPromise;
}

function cleanup() {
  cleanupPromise ??= (async () => {
    // Keep the fork alive until the test process tree has stopped issuing RPCs.
    try { await stopOwnedProcessTree(tests); } finally { await stopOwnedProcessTree(anvil); }
  })();
  return cleanupPromise;
}

process.once("SIGINT", () => {
  interrupted = true;
  shutdownController.abort();
  void cleanup().catch(() => undefined);
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  interrupted = true;
  shutdownController.abort();
  void cleanup().catch(() => undefined);
  process.exitCode = 143;
});

try {
  if (previewMode) {
    process.stdout.write(`Starting an isolated funded fork preview on http://127.0.0.1:${browserPort}/trade with Anvil RPC on 127.0.0.1:${port}.\n`);
    process.stdout.write("Only disposable local Anvil accounts and fork state are used; no live wallet funds or private keys are involved. Press Ctrl+C to close the preview and stop the local fork.\n");
  }
  assertForkUrl(forkUrl);
  await assertLoopbackPortAvailable(port);
  if (browserPort !== undefined) await assertLoopbackPortAvailable(browserPort);
  assertNotInterrupted();
   if (suite !== "stress") {
     rmSync(manifestPath, { force: true });
     if (suite === "all") rmSync(resolve(root, "artifacts", "anvil", "earn-proof.json"), { force: true });
   }
  const anvilBin = process.env.ANVIL_BIN?.trim() || "anvil";
  const anvilArgs = [
    "--fork-url", forkUrl,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--chain-id", "1",
    "--accounts", "20",
    "--balance", "10000",
    "--no-rate-limit",
    "--block-time", String(blockTime),
    "--quiet",
  ];
  if (process.env.ANVIL_FORK_BLOCK?.trim()) {
    if (!/^\d+$/.test(process.env.ANVIL_FORK_BLOCK.trim())) throw new Error("ANVIL_FORK_BLOCK must be a decimal block number");
    anvilArgs.push("--fork-block-number", process.env.ANVIL_FORK_BLOCK.trim());
  }

  anvil = spawnWithRedaction(anvilBin, anvilArgs, { cwd: root, env: scrubChildEnvironment() });
  await waitForAnvil(anvil);
  assertNotInterrupted();

  const pnpm = commandForPnpm();
  tests = spawnWithRedaction(
    pnpm.command,
    [...pnpm.args, "--dir", join("apps", "mini-app"), ...(suite === "browser"
      ? ["exec", "tsx", "e2e/fork/positions.browser.ts"]
      : ["test:anvil"])],
    { cwd: root, env: scrubChildEnvironment() },
  );
  const testExit = await new Promise((resolve, reject) => {
    tests.once("error", reject);
    tests.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  assertNotInterrupted();
  if (Number(testExit) !== 0) {
    process.exitCode = Number(testExit);
  } else if (previewMode) {
    process.stdout.write("Funded local fork preview closed; its app, browser, and Anvil processes have stopped.\n");
    process.exitCode = 0;
  } else {
    if (suite === "earn") validateEarnManifest();
    else if (suite === "all") {
      validateProtocolManifest();
      validateEarnManifest();
    } else if (suite !== "stress") validateProtocolManifest();
    process.exitCode = 0;
  }
} catch (error) {
  process.stderr.write(`FxAeon Anvil tests could not run: ${redacted(error instanceof Error ? error.message : String(error))}\n`);
  if (!interrupted) process.exitCode = 2;
} finally {
  try { await cleanup(); } catch (error) {
    process.stderr.write(`Anvil test cleanup failed: ${redacted(error instanceof Error ? error.message : String(error))}\n`);
    if (!interrupted) process.exitCode = 2;
  }
}
