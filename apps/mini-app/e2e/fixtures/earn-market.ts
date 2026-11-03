import type { Page } from '@playwright/test';
import { toFunctionSelector } from 'viem';
import { FX_SAVE_APY_ENDPOINT, FX_SAVE_TOKEN_ADDRESS } from '../../src/lib/fxSaveApy';

// Synthetic display-only observations, not captured protocol performance.
// The actual history source is Ethereum finalized block headers + fxSAVE nav(),
// not an invented REST/GraphQL yield-history endpoint.
export const EARN_GALLERY_LABEL = 'Synthetic gallery data';
export const EARN_GALLERY_NOW = Date.UTC(2026, 10, 3, 12);
export const EARN_GALLERY_HEAD = 0x1430f00n;
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const DAY = 86_400_000;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

/** Official Aladdin response shape, intentionally illustrative values. */
export function earnGalleryMarketResponse() {
  return { code: 200, data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: '8.4', tvl: '12500000' } } };
}

export async function installEarnMarketFixture(page: Page, available = true): Promise<void> {
  await page.route(FX_SAVE_APY_ENDPOINT, route => {
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
    return route.fulfill({ status: available ? 200 : 503, contentType: 'application/json',
      body: JSON.stringify(available ? earnGalleryMarketResponse() : { code: 503, data: null }) });
  });
}

/** Fixture-only provenance, visible in every built-page capture after navigation. */
export async function installGalleryProvenanceLabel(page: Page): Promise<void> {
  await page.addInitScript(label => {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('[data-gallery-provenance]')) return;
      const note = document.createElement('aside');
      note.dataset.galleryProvenance = 'synthetic';
      note.setAttribute('aria-label', label);
      note.textContent = label;
      note.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:2px 8px;border-radius:4px;background:#151515;color:#fff;font:11px/16px Arial,sans-serif;white-space:nowrap';
      document.body.append(note);
    }, { once: true });
  }, EARN_GALLERY_LABEL);
}

function blockAt(tag: unknown, now: number): { block: bigint; timestamp: number } {
  if (!Number.isSafeInteger(now) || now <= 123 * DAY) throw new Error('Invalid synthetic Earn observation time');
  const block = ['latest', 'safe', 'finalized'].includes(String(tag)) ? EARN_GALLERY_HEAD
    : typeof tag === 'string' && /^0x[0-9a-f]+$/i.test(tag) ? BigInt(tag) : 0n;
  const timestamp = Math.floor(now / 1000) * 1000 - Number(EARN_GALLERY_HEAD - block) * 12_000;
  if (block <= 0n || block > EARN_GALLERY_HEAD || timestamp < now - 123 * DAY) throw new Error('Undefined synthetic Earn archive block');
  return { block, timestamp };
}

/** Only known Ethereum read schemas. undefined delegates to other gallery reads. */
export function earnGalleryRpcResult(method: string, params: unknown[], chainId: number, now: number): unknown {
  if (chainId !== 1) return undefined;
  if (method === 'eth_getBlockByNumber') {
    if (params.length !== 2 || params[1] !== false) throw new Error('Synthetic Earn headers require hash-only transactions');
    const { block, timestamp } = blockAt(params[0], now);
    return {
      number: hex(block), timestamp: hex(BigInt(timestamp / 1000)), hash: word(block), parentHash: word(block - 1n),
      nonce: '0x0000000000000000', sha3Uncles: word(0n), logsBloom: `0x${'00'.repeat(256)}`,
      transactionsRoot: word(1n), stateRoot: word(2n), receiptsRoot: word(3n), miner: `0x${'11'.repeat(20)}`,
      difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x400',
      gasLimit: '0x1c9c380', gasUsed: '0xe4e1c0', baseFeePerGas: '0x3b9aca00',
      mixHash: word(0n), uncles: [], transactions: [], withdrawals: [], withdrawalsRoot: word(4n),
    };
  }
  if (method !== 'eth_call') return undefined;
  const call = params[0] as { to?: string; data?: string } | undefined;
  const target = call?.to?.toLowerCase(), data = call?.data?.toLowerCase();
  const nav = target === FX_SAVE_TOKEN_ADDRESS.toLowerCase() && data === toFunctionSelector('nav()');
  const stamp = target === MULTICALL && data === toFunctionSelector('getCurrentBlockTimestamp()');
  if (!nav && !stamp) return undefined;
  if (params.length !== 2) throw new Error('Synthetic Earn calls require an explicit block');
  const { block, timestamp } = blockAt(params[1], now);
  // Integer-defined, gently increasing NAV across all 120 warmup/visible days.
  return word(stamp ? BigInt(timestamp / 1000) : 1_100_000_000_000_000_000n + (block - EARN_GALLERY_HEAD) * 30_000_000_000n);
}
