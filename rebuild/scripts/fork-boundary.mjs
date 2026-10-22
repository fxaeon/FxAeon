import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GuardedFork } from '../test/fork/guard.ts';
import { anvilVersion, launchAnvil } from './fork-process.mjs';

// Actual local-process evidence for rejection of a nonfork node. It deliberately
// cannot satisfy a real protocol/fork gate and creates no signing account.
const binary = process.env.FX_REBUILD_ANVIL_BIN?.trim() || 'anvil';
let node;
const result = { kind: 'actual-local-nonfork-rejection', realProtocolVerified: false, generatedAt: new Date().toISOString(),
  status: 'failed', accountFundings: 0, signatures: 0, sends: 0 };
try {
  result.anvilVersion = anvilVersion(binary);
  node = await launchAnvil({ binary });
  const fork = new GuardedFork(node.url, { blockNumber: 1n, blockHash: `0x${'00'.repeat(32)}` });
  await assert.rejects(fork.fundDisposable(`0x${'11'.repeat(20)}`), /Expected a JSON object/);
  result.status = 'passed'; result.boundary = 'Anvil chain 1 without fork metadata rejected before funding or signing';
} catch (error) { result.reason = error instanceof Error ? error.message : 'Local boundary check failed.'; process.exitCode = 1; }
finally {
  if (node) await node.stop();
  const folder = fileURLToPath(new URL('../test/fork/results/', import.meta.url));
  mkdirSync(folder, { recursive: true });
  writeFileSync(folder + 'local-boundary.json', JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result) + '\n');
}
