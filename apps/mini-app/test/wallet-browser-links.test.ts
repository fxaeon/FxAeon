import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWalletBrowserLinks, getWalletHandoffHelp, walletBrowserTarget } from '../src/lib/wallet/walletBrowserLinks';
import { WALLET_CATALOG, buildWalletChoices } from '../src/lib/wallet/walletCatalog';
import { resolveWalletConnectionRoute } from '../src/lib/wallet/walletConnectionRoutes';

test('Rabby native launch carries open-dapp and the exact trusted route through one encoding layer', () => {
  const href = 'https://app.fxaeon.com/positions?position=ETH%3Along%3A2033&return=%2Fearn%3Fa%3D1#review';
  const links = getWalletBrowserLinks('/positions', { href, origin: 'https://app.fxaeon.com' });
  const rabby = new URL(links.find((link) => link.name === 'Rabby')!.href);
  assert.equal(rabby.protocol, 'rabbygo:');
  assert.equal(rabby.host, 'go.rabby.io');
  assert.equal(rabby.pathname, '/mobile/');
  assert.equal(rabby.searchParams.get('_cmd'), 'open-dapp');
  assert.equal(rabby.searchParams.get('dapp'), href);
  assert.equal(rabby.hash, '');
  assert.deepEqual([...rabby.searchParams.keys()], ['_cmd', 'dapp']);
  for (const name of ['Trust Wallet', 'Rainbow']) {
    assert.equal(new URL(links.find((link) => link.name === name)!.href).searchParams.get('url'), href);
  }
  const phantom = new URL(links.find((link) => link.name === 'Phantom')!.href);
  assert.equal(decodeURIComponent(phantom.pathname.slice('/ul/browse/'.length)), href);
  assert.equal(phantom.searchParams.get('ref'), 'https://app.fxaeon.com');
});

test('nested wallet URL cannot cross the captured browser origin or carry credentials or executable schemes', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,bad', 'https://evil.test/earn', 'https://user:pass@fxaeon.com/earn', 'http://fxaeon.com/earn', '//evil.test/earn']) {
    assert.equal(walletBrowserTarget({ href, origin: 'https://fxaeon.com' }), null);
    const rabby = new URL(getWalletBrowserLinks('/earn', { href, origin: 'https://fxaeon.com' }).find((link) => link.name === 'Rabby')!.href);
    assert.equal(rabby.searchParams.get('dapp'), 'https://fxaeon.com/earn');
  }
});

test('current preview HTTPS and local development origin stay intact', () => {
  for (const origin of ['https://fxaeon-preview.example', 'http://127.0.0.1:3000', 'http://localhost:3000']) {
    const href = `${origin}/move?token=fxUSD#destination`;
    assert.equal(walletBrowserTarget({ href, origin }), href);
  }
});

test('Coinbase, OKX and Zerion browser commands carry one encoded sanitized target, never a pairing request', () => {
  const location = { href: 'https://fxaeon.com/positions?position=ETH%3Along%3A2033&tgWebAppData=proof#review?tab=details', origin: 'https://fxaeon.com' };
  const safe = walletBrowserTarget(location)!;
  const links = getWalletBrowserLinks('/positions', location);
  for (const [name, protocol, host, pathname, key] of [
    ['Base Wallet', 'https:', 'go.cb-w.com', '/dapp', 'cb_url'],
    ['OKX', 'okx:', 'wallet', '/dapp/url', 'dappUrl'],
    ['Zerion', 'https:', 'link.zerion.io', '/', 'url'],
  ]) {
    const link = new URL(links.find(item => item.name === name)!.href);
    assert.equal(link.protocol, protocol); assert.equal(link.host, host); assert.equal(link.pathname, pathname);
    assert.equal(link.searchParams.get(key), safe);
    assert.deepEqual([...link.searchParams.keys()], [key]);
    assert.equal(link.hash, '');
    assert.doesNotMatch(link.href, /tgWebApp|wc\?|wsegue|session|wallet\/connect/);
  }
});

test('wallet browser target removes Telegram launch proofs and OAuth tokens without dropping FxAeon route state', () => {
  const href = 'https://fxaeon.com/positions?position=ETH%3Along%3A2033&tgWebAppStartParam=launch&access_token=secret#tgWebAppData=proof&tgWebAppVersion=8.0&tab=review';
  const safe = walletBrowserTarget({ href, origin: 'https://fxaeon.com' })!;
  assert.equal(new URL(safe).searchParams.get('position'), 'ETH:long:2033');
  assert.equal(new URL(safe).hash, '#tab=review');
  assert.doesNotMatch(safe, /tgWebApp|secret|proof|launch/);
  assert.equal(walletBrowserTarget({ href: 'https://fxaeon.com/trade#review?tgWebAppData=proof&market=ETH', origin: 'https://fxaeon.com' }), 'https://fxaeon.com/trade#review?market=ETH');
});

for (const wallet of WALLET_CATALOG) {
  test(`${wallet.name} exposes fixed install/guide links and a sanitized current dapp without claiming a wallet session`, () => {
    const route = resolveWalletConnectionRoute(buildWalletChoices([]).find((item) => item.id === wallet.id)!, {
      providers: [], environment: 'mobile', location: { href: 'https://fxaeon.com/move?token=fxUSD&tgWebAppData=proof#review', origin: 'https://fxaeon.com' },
    });
    assert.ok(route.kind === 'browser' || route.kind === 'download');
    if (route.kind !== 'browser' && route.kind !== 'download') assert.fail();
    assert.deepEqual({ fallbackHref: route.fallbackHref, guideHref: route.guideHref }, getWalletHandoffHelp(wallet.id));
    assert.equal(new URL(route.fallbackHref!).protocol, 'https:');
    assert.equal(new URL(route.guideHref!).protocol, 'https:');
    assert.equal(route.dappHref, 'https://fxaeon.com/move?token=fxUSD#review');
    assert.equal('provider' in route, false);
    assert.equal(route.canReopen, route.kind === 'browser');
    if (route.kind === 'download') assert.match(route.message, /Open FxAeon.*browser to connect/);
  });
}
