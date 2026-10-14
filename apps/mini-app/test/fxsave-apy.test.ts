import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FX_SAVE_TOKEN_ADDRESS,
  fetchFxSaveApy,
  parseFxSaveApyResponse,
} from '../src/lib/fxSaveApy';

test('parses the official fxSAVE APY response', () => {
  const result = parseFxSaveApyResponse({
    code: 200,
    data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: '6.96' } },
  }, 123);
  assert.deepEqual(result, { apy: 6.96, observedAt: 123 });
});

test('rejects an APY response for another token or invalid value', () => {
  assert.throws(() => parseFxSaveApyResponse({
    code: 200,
    data: { fxSave: { address: '0x0000000000000000000000000000000000000001', apy: '6.96' } },
  }), /unexpected token/);
  assert.throws(() => parseFxSaveApyResponse({
    code: 200,
    data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: 'not-a-number' } },
  }), /value is invalid/);
});

test('fetches and validates the official APY payload', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 200,
    data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: 4.125 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await fetchFxSaveApy();
    assert.equal(result.apy, 4.125);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('validates optional USD TVL independently of APY for the same fxSAVE address', () => {
  const payload = (tvl: unknown) => ({ code: 200, data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: '6.7', tvl } } });
  assert.deepEqual(parseFxSaveApyResponse(payload('84423918.8125'), 123), { apy: 6.7, observedAt: 123, tvlUsd: 84423918.8125 });
  for (const invalid of [-1, Infinity, 'garbage', '0x10', '', undefined, 1e14]) {
    assert.deepEqual(parseFxSaveApyResponse(payload(invalid), 123), { apy: 6.7, observedAt: 123 });
  }
});
