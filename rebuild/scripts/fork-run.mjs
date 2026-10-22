import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { encodeFunctionData } from 'viem';
import { ADDRESSES, POOL_ABI } from '../src/protocol/contracts.ts';
import { GuardedFork, hash, invariant, quantity, record, rpcExchange } from '../test/fork/guard.ts';
import { validateProof } from '../test/fork/manifest.ts';
import { sourceManifest } from './fork-source.mjs';
import { anvilVersion, childEnvironment, launchAnvil, terminateOwned } from './fork-process.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const results = resolve(root, 'test/fork/results');
const proofFile = resolve(results, 'native-long-proof.json');
const resultFile = resolve(results, 'last-run.json');
const runId = randomUUID();
const startedAt = new Date().toISOString();
const args = process.argv.slice(2);
const binary = process.env.FX_REBUILD_ANVIL_BIN?.trim() || 'anvil';
let outcome = { schemaVersion: 1, runId, startedAt, status: 'blocked', realProtocolVerified: false,
  node: process.version, scope: 'native ETH new ETH long only', checks: [], transactionsSent: 0 };
let node;
let testChild;

function save() {
  mkdirSync(results, { recursive: true });
  const temporary = `${resultFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...outcome, completedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, resultFile);
}

function upstreamUrl() {
  invariant(args.length === 0 || (args.length === 1 && args[0] === '--publicnode'), 'Use no argument or the explicit --publicnode diagnostic option.');
  const configured = [process.env.ANVIL_FORK_URL, process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL, process.env.ALCHEMY_RPC_URL]
    .map(value => value?.trim()).find(Boolean);
  invariant(!configured || !args.length, 'Choose the configured archive endpoint or the explicit public diagnostic, not both.');
  const raw = configured || (args[0] === '--publicnode' ? 'https://ethereum-rpc.publicnode.com' : undefined);
  invariant(raw, 'No authorized archive RPC is configured. Set ANVIL_FORK_URL; no signing was attempted.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('The archive RPC URL is invalid.'); }
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port,
    'The archive source must be a clean HTTPS endpoint without embedded credentials, query, fragment, or alternate port.');
  invariant(url.hostname !== 'localhost' && !/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|\[|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname),
    'The archive source must be a public Ethereum read endpoint.');
  outcome.archiveSource = configured ? 'explicit documented environment configuration (URL withheld)' : 'installed SDK documented PublicNode default';
  return url.href;
}

async function probeArchive(url) {
  const read = rpcExchange(url, globalThis.fetch.bind(globalThis), 15_000);
  invariant(quantity(await read('eth_chainId')) === 1n, 'The archive endpoint did not prove Ethereum chain 1.');
  const configuredBlock = process.env.ANVIL_FORK_BLOCK?.trim();
  invariant(!configuredBlock || /^[1-9][0-9]*$/.test(configuredBlock), 'ANVIL_FORK_BLOCK must be a positive decimal number.');
  const head = record(await read('eth_getBlockByNumber', ['latest', false]));
  const headNumber = quantity(head.number);
  const blockNumber = configuredBlock ? BigInt(configuredBlock) : headNumber - 64n;
  invariant(blockNumber > 0n && blockNumber <= headNumber, 'The pinned archive block is outside the known chain.');
  const blockTag = `0x${blockNumber.toString(16)}`;
  const block = record(await read('eth_getBlockByNumber', [blockTag, false]));
  invariant(quantity(block.number) === blockNumber, 'The archive returned the wrong pinned block.');
  const blockHash = hash(block.hash);
  // Prove access to historical protocol state, not just a public latest header.
  // These are deployed production addresses, never replacement fixture code.
  for (const target of [ADDRESSES.router, ADDRESSES.pool, ADDRESSES.manager, ADDRESSES.converter]) {
    const code = await read('eth_getCode', [target, blockTag]);
    invariant(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code), 'The archive did not return historical deployed protocol code.');
  }
  const poolRange = await read('eth_call', [{ to: ADDRESSES.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'getDebtRatioRange' }) }, blockTag]);
  invariant(typeof poolRange === 'string' && /^0x[0-9a-fA-F]{128}$/.test(poolRange), 'The archive did not return historical pool storage reads.');
  return { blockNumber, blockHash };
}

function runTest(environment) {
  return new Promise((resolveTest, reject) => {
    testChild = spawn(process.execPath, ['--import', 'tsx', 'test/fork/native-long.test.ts'], {
      cwd: root, env: childEnvironment(environment), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; let overflow = false;
    const collect = chunk => {
      if (output.length + chunk.length > 8_000_000) { overflow = true; void terminateOwned(testChild); return; }
      output += String(chunk);
    };
    testChild.stdout.on('data', collect); testChild.stderr.on('data', collect);
    const timer = setTimeout(() => { void terminateOwned(testChild); }, 180_000);
    testChild.once('error', () => { clearTimeout(timer); reject(new Error('The dedicated fork test process failed to start.')); });
    testChild.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveTest({ code, signal, overflow, output });
    });
  });
}

for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => {
  outcome.status = 'failed'; outcome.reason = 'The fork run was interrupted.';
  Promise.allSettled([testChild ? terminateOwned(testChild) : Promise.resolve(), node?.stop() ?? Promise.resolve()])
    .finally(() => { save(); process.exit(130); });
});

try {
  mkdirSync(results, { recursive: true });
  // A stale passing file must never satisfy this run.
  rmSync(proofFile, { force: true });
  outcome.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  outcome.anvilVersion = anvilVersion(binary);
  outcome.retainedCiAnvilVersion = '1.8.1';
  outcome.anvilVersionMatchesRetainedCi = outcome.anvilVersion === outcome.retainedCiAnvilVersion;
  outcome.sdkVersion = JSON.parse(readFileSync(resolve(root, 'node_modules/@aladdindao/fx-sdk/package.json'), 'utf8')).version;
  const source = sourceManifest(root);
  outcome.sourceManifestHash = source.digest;
  writeFileSync(resolve(results, 'source-manifest.json'), JSON.stringify(source, null, 2) + '\n', { mode: 0o600 });
  const upstream = upstreamUrl();
  const archive = await probeArchive(upstream);
  outcome.checks.push('Ethereum archive chain, pinned header, deployed contract code and historical pool read proved');
  outcome.archiveBlock = { number: String(archive.blockNumber), hash: archive.blockHash };
  node = await launchAnvil({ binary, forkUrl: upstream, blockNumber: archive.blockNumber });
  const fork = new GuardedFork(node.url, archive);
  const identity = await fork.prove();
  outcome.checks.push('Owned loopback Anvil, Ethereum chain, fork base/hash and instance identity proved');
  outcome.status = 'running'; outcome.transactionsSent = null; save();
  const execution = await runTest({
    FX_REBUILD_FORK_RPC: node.url, FX_REBUILD_FORK_BASE: String(identity.blockNumber),
    FX_REBUILD_FORK_HASH: identity.blockHash, FX_REBUILD_FORK_INSTANCE: identity.instanceId,
    FX_REBUILD_FORK_RUN: runId, FX_REBUILD_FORK_PROOF: proofFile, FX_REBUILD_FORK_SOURCE: source.digest,
  });
  // Only safe test-process output is captured: that process has no upstream URL
  // and its fetch boundary cannot reach an external service.
  writeFileSync(resolve(results, 'native-long.tap'), execution.output, { mode: 0o600 });
  const count = name => Number(execution.output.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? -1);
  invariant(execution.code === 0 && !execution.signal && !execution.overflow && count('tests') === 1 && count('pass') === 1
    && count('fail') === 0 && count('skipped') === 0 && count('cancelled') === 0 && count('todo') === 0
    && /^ok 1 - \[FORK-NATIVE-LONG\]/m.test(execution.output), 'The actual fork test did not complete its required named case successfully.');
  invariant(sourceManifest(root).digest === source.digest, 'The executable source changed during the fork run; repeat against a stable checkpoint.');
  const proof = validateProof(JSON.parse(readFileSync(proofFile, 'utf8')), { runId, sourceManifestHash: source.digest, ...identity });
  outcome.status = 'passed'; outcome.realProtocolVerified = true; outcome.transactionsSent = 1;
  outcome.proof = { transactionHash: proof.execution.hash, positionId: proof.execution.positionId, file: 'native-long-proof.json' };
  outcome.checks.push('Real installed SDK, production protocol, controller, browser wallet, canonical receipt/accounting and reload without resend proved');
} catch (error) {
  if (outcome.status === 'running') outcome.status = 'failed';
  outcome.reason = error instanceof Error ? error.message : 'The fork harness failed.';
  // Constructed errors contain only safe fixed text/status codes. Never serialize
  // Error.cause, upstream request data, a provider URL, or a private key.
  process.exitCode = outcome.status === 'blocked' ? 2 : 1;
} finally {
  if (testChild) await terminateOwned(testChild);
  if (node) await node.stop();
  save();
  process.stdout.write(JSON.stringify({ status: outcome.status, realProtocolVerified: outcome.realProtocolVerified,
    reason: outcome.reason, report: 'test/fork/results/last-run.json' }) + '\n');
}
