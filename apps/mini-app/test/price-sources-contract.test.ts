import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('client sources and CSP have no DefiLlama routes, adapters or permissions', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  function inspect(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(?:ts|tsx|js)$/.test(entry.name)) assert.doesNotMatch(readFileSync(path, 'utf8'), /llama\.fi|defillama|LlamaResponse|parseUsdPriceResponse/i, path);
    }
  }
  inspect(join(root, 'src'));
  const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
  assert.doesNotMatch(headers, /llama\.fi|defillama/i);
  assert.match(headers, /https:\/\/api\.aladdin\.club/);
  assert.match(headers, /https:\/\/api\.coingecko\.com/);
});
