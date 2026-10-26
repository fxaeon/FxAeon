import assert from 'node:assert/strict';
import test from 'node:test';
import { safeWalletIcon } from '../src/lib/wallet/walletIcon';
import { recordEip6963Announcement } from '../src/lib/wallet/eip6963';
const svg = 'data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"/%3E';
test('bounded image data URIs accept raw, percent-encoded and base64 payloads only', () => {
  for (const icon of [svg, 'data:image/svg+xml,<svg/>', 'data:image/png;base64,aGVsbG8=', 'data:image/webp;base64,aGVsbG8=', 'data:image/jpeg,%FF%D8%FF']) assert.equal(safeWalletIcon(icon), icon);
  for (const icon of [null, {}, 'https://tracker.invalid/icon.svg', 'blob:other', 'javascript:alert(1)', 'data:text/html,<svg/>', 'data:image/svg+xml,%XX', 'data:image/png;base64,!!', 'data:image/png;base64,a', 'data:image/png,', 'data:image/svg+xml,' + 'x'.repeat(128 * 1024)]) assert.equal(safeWalletIcon(icon), undefined);
});
test('invalid and throwing icon metadata never discard an exact valid provider', () => {
  for (const icon of ['https://tracker.invalid/icon.png', 'data:text/html,<script/>']) {
    const provider = {request: async () => []};
    const item = recordEip6963Announcement({provider, info: {name: 'Unknown', rdns: 'org.icon.invalid', icon}})!;
    assert.equal(item.provider, provider); assert.equal(item.icon, undefined);
  }
  const provider = {request: async () => []};
  const info = Object.defineProperty({name: 'Unknown', rdns: 'org.icon.getter'}, 'icon', {get() {throw new Error('Unloading');}});
  assert.equal(recordEip6963Announcement({provider, info})!.provider, provider);
});
test('same-provider icon refresh does not create another identity claim', () => {
  const provider = {request: async () => []};
  const first = recordEip6963Announcement({provider, info: {name: 'Unknown', rdns: 'org.icon.refresh', icon: 'data:image/svg+xml,broken'}})!;
  const updated = recordEip6963Announcement({provider, info: {name: 'Unknown', rdns: 'org.icon.refresh', icon: svg}})!;
  assert.equal(updated.provider, first.provider); assert.equal(updated.rdns, first.rdns); assert.equal(updated.icon, svg);
  assert.equal(recordEip6963Announcement({provider, info: {rdns: first.rdns, icon: svg}}), null);
});
