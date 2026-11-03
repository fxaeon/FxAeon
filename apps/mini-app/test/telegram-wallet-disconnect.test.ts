import assert from 'node:assert/strict';
import test from 'node:test';
import { setTelegramWalletDisconnected, telegramWalletDisconnected } from '../src/lib/telegramWalletDisconnect';

const launch = (id: unknown, authDate = '1') => new URLSearchParams({ user: JSON.stringify({ id }), auth_date: authDate, hash: 'fixture' }).toString();
function withStorage(storage: unknown, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete (globalThis as { window?: unknown }).window;
  }
}

test('disconnect stores only an identity-scoped opt-out and survives fresh launch timestamps', () => {
  const saved = new Map<string, string>();
  withStorage({ getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) }, () => {
    assert.equal(telegramWalletDisconnected(launch(101)), false);
    setTelegramWalletDisconnected(launch(101), true);
    assert.deepEqual([...saved], [['fxaeon:telegram-wallet-disconnected:v1:101', '1']]);
    assert.equal(telegramWalletDisconnected(launch(101, '2')), true);
    assert.equal(telegramWalletDisconnected(launch(102)), false);
    setTelegramWalletDisconnected(launch(102), true);
    setTelegramWalletDisconnected(launch(101), false);
    assert.equal(telegramWalletDisconnected(launch(101)), false);
    assert.equal(telegramWalletDisconnected(launch(102)), true);
    saved.set('fxaeon:telegram-wallet-disconnected:v1:101', '{"authenticated":true}');
    assert.equal(telegramWalletDisconnected(launch(101)), false);
  });
});

test('malformed identities cannot read or overwrite another identity preference', () => {
  let calls = 0;
  const unexpected = () => { calls += 1; throw new Error('Storage must not be accessed'); };
  withStorage({ getItem: unexpected, setItem: unexpected, removeItem: unexpected }, () => {
    for (const data of ['', 'user=broken', ...[null, 0, -1, '101', 1.5, Number.MAX_SAFE_INTEGER + 1].map(id => launch(id))]) {
      assert.equal(telegramWalletDisconnected(data), false);
      assert.doesNotThrow(() => setTelegramWalletDisconnected(data, true));
    }
    assert.equal(calls, 0);
  });
});

test('blocked storage retains only the current document choice and clearing it still works', () => {
  const blocked = () => { throw new Error('Storage denied'); };
  withStorage({ getItem: blocked, setItem: blocked, removeItem: blocked }, () => {
    setTelegramWalletDisconnected(launch(103), true);
    assert.equal(telegramWalletDisconnected(launch(103)), true);
    assert.equal(telegramWalletDisconnected(launch(104)), false);
    setTelegramWalletDisconnected(launch(103), false);
    assert.equal(telegramWalletDisconnected(launch(103)), false);
  });
});

test('a failed write overrides readable missing storage for the current document', () => {
  withStorage({ getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); }, removeItem: () => undefined }, () => {
    setTelegramWalletDisconnected(launch(105), true);
    assert.equal(telegramWalletDisconnected(launch(105, '2')), true);
    assert.equal(telegramWalletDisconnected(launch(106)), false);
    setTelegramWalletDisconnected(launch(105), false);
    assert.equal(telegramWalletDisconnected(launch(105)), false);
  });
});

test('a failed removal overrides a readable stale opt-out after verified reconnect', () => {
  const saved = new Map([['fxaeon:telegram-wallet-disconnected:v1:107', '1']]);
  withStorage({ getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value), removeItem: () => { throw new Error('Removal denied'); } }, () => {
    assert.equal(telegramWalletDisconnected(launch(107)), true);
    setTelegramWalletDisconnected(launch(107), false);
    assert.equal(telegramWalletDisconnected(launch(107)), false);
    assert.equal(saved.get('fxaeon:telegram-wallet-disconnected:v1:107'), '1');
    setTelegramWalletDisconnected(launch(107), true);
    assert.equal(telegramWalletDisconnected(launch(107)), true);
  });
});

test('a successful write still preserves the document choice when reads later fail', () => {
  let readBlocked = false;
  const saved = new Map<string, string>();
  withStorage({ getItem: (key: string) => { if (readBlocked) throw new Error('Read denied'); return saved.get(key); },
    setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) }, () => {
    setTelegramWalletDisconnected(launch(108), true);
    readBlocked = true;
    assert.equal(telegramWalletDisconnected(launch(108, '2')), true);
    assert.equal(telegramWalletDisconnected(launch(109)), false);
    setTelegramWalletDisconnected(launch(108), false);
    assert.equal(telegramWalletDisconnected(launch(108)), false);
    assert.equal(saved.has('fxaeon:telegram-wallet-disconnected:v1:108'), false);
  });
});
