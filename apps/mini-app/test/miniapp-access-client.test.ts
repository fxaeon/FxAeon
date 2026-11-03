import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { miniappTransaction, verifySigningChallenge, miniappAccess, MiniappAccessError, validatedHandoffUrl, validateApprovalTransaction, challengeCommitment, verifyChallengeCommitment, telegramReturnUrl } from '../src/lib/miniappAccess';

const APP = 'clabcdefghijklmnopqrstuv';
const FROM = `0x${'1'.repeat(40)}`;
const TO = `0x${'2'.repeat(40)}`;
const NOW = 1_793_700_000_000;
const tx = miniappTransaction({ to: TO, chainId: 8453, data: '0x1234', value: 16n, gasLimit: 21_000n, nonce: 3 }, FROM);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`;
  return JSON.stringify(value);
}
const encode = (value: unknown) => Buffer.from(canonical(value)).toString('base64url');
function envelope() {
  return { version: 1, method: 'POST', url: 'https://api.privy.io/v1/wallets/wallet-1/rpc',
    headers: { 'privy-app-id': APP, 'privy-idempotency-key': 'intent-1', 'privy-request-expiry': String(NOW + 300_000) },
    body: { method: 'eth_sendTransaction', caip2: 'eip155:8453', reference_id: 'intent-1', params: { transaction: { to: TO, chain_id: 8453, value: '0x10', data: '0x1234', gas_limit: '0x5208', nonce: '0x3' } } },
  };
}

test('normalizes exact reviewed quantities and independently accepts the canonical authorization', () => {
  assert.equal(tx.chainId, 8453);
  assert.equal(tx.value, '0x10');
  assert.equal(tx.gasLimit, '0x5208');
  assert.equal(tx.nonce, '0x3');
  assert.ok(Object.isFrozen(tx));
  const verified = verifySigningChallenge(encode(envelope()), tx, 'wallet-1', APP, NOW);
  assert.equal(verified.walletId, 'wallet-1'); assert.deepEqual(verified.transaction, tx);
  const withChainType = { ...envelope(), body: { ...envelope().body, chain_type: 'ethereum' } };
  assert.equal(verifySigningChallenge(encode(withChainType), tx, 'wallet-1', APP, NOW).walletId, 'wallet-1');
});

test('rejects every substituted authorization field, added fee, and unexpected header/body field', () => {
  const mutations: Array<(e: any) => void> = [
    e => { e.version = 2; }, e => { e.method = 'GET'; },
    e => { e.url = 'https://api.privy.io/v1/wallets/wallet-2/rpc'; },
    e => { e.url = 'https://evil.example/v1/wallets/wallet-1/rpc'; },
    e => { e.headers['privy-app-id'] = 'anotherappabcdefghijklmnop'; },
    e => { e.headers.authorization = 'unexpected'; },
    e => { e.headers['privy-request-expiry'] = String(NOW); },
    e => { e.headers['privy-request-expiry'] = String(NOW + 300_001); },
    e => { e.headers['privy-idempotency-key'] = ''; },
    e => { e.body.method = 'eth_sign'; }, e => { e.body.caip2 = 'eip155:1'; },
    e => { e.body.chain_type = 'solana'; }, e => { e.body.sponsor = true; },
    e => { e.body.reference_id = 'different-intent'; }, e => { delete e.body.reference_id; },
    e => { e.body.params.extra = true; }, e => { e.extra = true; },
    e => { e.body.params.transaction.to = FROM; },
    e => { e.body.params.transaction.chain_id = 1; },
    e => { e.body.params.transaction.value = '0x11'; },
    e => { e.body.params.transaction.data = '0x4321'; },
    e => { e.body.params.transaction.gas_limit = '0x5209'; },
    e => { e.body.params.transaction.nonce = '0x4'; },
    e => { e.body.params.transaction.gas_price = '0x1'; },
    e => { e.body.params.transaction.max_fee_per_gas = '0x1'; },
    e => { e.body.params.transaction.max_priority_fee_per_gas = '0x1'; },
    e => { e.body.params.transaction.from = FROM; },
    e => { delete e.body.params.transaction.nonce; },
  ];
  for (const mutate of mutations) {
    const value = envelope(); mutate(value);
    assert.throws(() => verifySigningChallenge(encode(value), tx, 'wallet-1', APP, NOW), /does not match/);
  }
  assert.throws(() => verifySigningChallenge(encode(envelope()), tx, 'wallet-1', '', NOW));
  assert.throws(() => verifySigningChallenge(Buffer.from(JSON.stringify(envelope())).toString('base64url'), tx, 'wallet-1', APP, NOW), /does not match/);
  assert.throws(() => verifySigningChallenge(Buffer.from('random nonce').toString('base64url'), tx, 'wallet-1', APP, NOW));
});

test('a locally retained commitment rejects a substituted signing or registration challenge', async () => {
  const original = encode(envelope());
  const digest = await challengeCommitment(original);
  await verifyChallengeCommitment(original, digest);
  const changed = envelope(); changed.body.params.transaction.to = FROM;
  await assert.rejects(verifyChallengeCommitment(encode(changed), digest));
  const registration = Buffer.from('registration challenge 1').toString('base64url');
  await assert.rejects(verifyChallengeCommitment(Buffer.from('registration challenge 2').toString('base64url'), await challengeCommitment(registration)));
  await assert.rejects(verifyChallengeCommitment(original, ''));
});

test('validates the browser display transaction without dropping unexpected fields', () => {
  assert.deepEqual(validateApprovalTransaction(tx), tx);
  assert.throws(() => validateApprovalTransaction({ ...tx, sponsor: true }));
  assert.throws(() => validateApprovalTransaction({ ...tx, gasPrice: {} }));
  assert.throws(() => miniappTransaction({ to: TO, chainId: 1, from: TO }, FROM));
  assert.throws(() => miniappTransaction({ to: TO, chainId: 1, value: Number.MAX_SAFE_INTEGER + 1 }, FROM));
});

test('handoff links stay on the official same-origin approval route', () => {
  assert.equal(validatedHandoffUrl('/wallet-approval#token=opaque', 'https://fxaeon.com'), 'https://fxaeon.com/wallet-approval#token=opaque');
  for (const url of ['https://evil.example/wallet-approval#token=x', '/login#token=x', '/wallet-approval?token=x', '/wallet-approval', 'https://user:password@fxaeon.com/wallet-approval#token=x']) {
    assert.throws(() => validatedHandoffUrl(url, 'https://fxaeon.com'));
  }
});

const originalFetch = globalThis.fetch;

test('Telegram return links launch the Mini App and never retain capability/query payloads', () => {
  const original = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL;
  const main = 'https://t.me/FxAeonBot?startapp';
  try {
    delete process.env.NEXT_PUBLIC_TELEGRAM_APP_URL;
    assert.equal(telegramReturnUrl(), main);
    for (const [configured, expected] of [
      ['https://t.me/FxAeonBot', main], ['https://t.me/FxAeonBot?startapp', main],
      ['https://t.me/FxAeonBot?startapp=trade#token=synthetic', main],
      ['https://t.me/FxAeonBot?token=synthetic#commitment=synthetic', main],
      ['https://t.me/FxAeonBot/app', 'https://t.me/FxAeonBot/app'],
      ['https://t.me/FxAeonBot/app?startapp=trade#token=synthetic', 'https://t.me/FxAeonBot/app'],
      ['https://evil.test/FxAeonBot', main], ['https://t.me.evil.test/FxAeonBot', main],
      ['https://user:password@t.me/FxAeonBot', main], ['https://t.me:443/FxAeonBot', main],
      ['http://t.me/FxAeonBot', main], ['https://t.me/FxAeonBot/../OtherBot', main],
      ['https://t.me/FxAeonBot/%2e%2e', main], ['https://t.me/', main],
    ]) {
      process.env.NEXT_PUBLIC_TELEGRAM_APP_URL = configured;
      assert.equal(telegramReturnUrl(), expected, configured);
    }
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_TELEGRAM_APP_URL;
    else process.env.NEXT_PUBLIC_TELEGRAM_APP_URL = original;
  }
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('token POSTs never include launch data and transport never follows redirects', async () => {
  const calls: Array<{ action: string; token: string; launchData?: string }> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/telegram-wallet'); assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ verified: true }));
  };
  await miniappAccess('email/confirm', { token: 'secret' }, { launchData: 'must-not-leak' });
  assert.deepEqual(calls, [{ action: 'email/confirm', token: 'secret' }]);
});

test('an ambiguous completion is never retried and raw service errors stay private', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('secret service diagnostic'); };
  await assert.rejects(miniappAccess('sign/complete', { challengeId: 'id', response: {} as never }, { launchData: 'signed-launch' }),
    (error: unknown) => error instanceof MiniappAccessError && error.uncertain && !error.message.includes('secret'));
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'secret service diagnostic' }), { status: 400 });
  await assert.rejects(miniappAccess('status', {}, { launchData: 'signed-launch' }),
    (error: unknown) => error instanceof MiniappAccessError && !error.message.includes('secret'));
});
