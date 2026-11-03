import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productHref, productNavigation } from '../apps/mini-app/src/app/docs/productNavigation.ts';
import { sdkHref, sdkNavigation } from '../apps/mini-app/src/app/docs/sdkNavigation.ts';
import { routeMetadata } from '../apps/mini-app/src/app/routeMetadata.ts';

const appOrigin = 'https://fxaeon.com';
const landingOrigin = 'https://fxaeon.xyz';

function sitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`;
}

/** Explicit public allowlist. Never enumerate the app router or operator endpoints. */
export function discoveryArtifacts() {
  const routes = ['trade', 'earn', 'borrow', 'move', 'docs', 'docsGuide', 'docsSdk'];
  const urls = routes.map(route => routeMetadata(route).alternates.canonical);
  const guideLinks = productNavigation.map(({ id, title, description }) =>
    `- [${title}](${appOrigin}${productHref(id)}): ${description}`);
  const sdkLinks = sdkNavigation.map(({ id, title, description }) =>
    `- [${title}](${appOrigin}${sdkHref(id)}): ${description}`);
  urls.push(...productNavigation.map(({ id }) => `${appOrigin}${productHref(id)}`),
    ...sdkNavigation.map(({ id }) => `${appOrigin}${sdkHref(id)}`), `${appOrigin}/privacy.html`);
  const llms = `# FxAeon

> FxAeon is an independent web and Telegram interface for f(x) Protocol. Trade leveraged ETH and BTC positions, earn with fxSAVE, borrow fxUSD, and move fxUSD or fxSAVE between Ethereum and Base.

Trade, Earn, and Borrow operate on Ethereum. Move supports Ethereum and Base; Base is not a second positions or Earn ledger. The interface is for people using these products with a wallet. Each transaction requires review and wallet approval.

The landing page and public guides contain readable product information without connecting a wallet. Interactive app screens require JavaScript. Figures and scenarios on the landing page are display information, not executable quotes. Returns, delivery times, and protocol safeguards are not guarantees. Read the fees and risks guides before acting.

This optional guide links to public documentation. It does not authorize transactions, grant access, or control crawler policy; robots.txt is separate.

## Start here

- [FxAeon](${landingOrigin}/): Product introduction and web/Telegram launch actions.
- [Web app](${appOrigin}/): Interactive workspace; public product information is in the guides below.
- [Telegram](https://t.me/FxAeonBot): Open the FxAeon bot and follow the current access flow.
- [Documentation](${appOrigin}/docs): Product guides and developer documentation.
- [Product guide](${appOrigin}/docs/guide): Wallets, products, transaction reviews, fees, and risks.
- [SDK reference](${appOrigin}/docs/sdk): The supported f(x) SDK integration and execution boundaries.

## Product guides

${guideLinks.join('\n')}

## Developer reference

${sdkLinks.join('\n')}

## Policies and protocol

- [Privacy](${appOrigin}/privacy.html): Device storage, wallet information, and external services.
- [f(x) Protocol documentation](https://fxprotocol.gitbook.io/fx-docs): Protocol economics and mechanisms, maintained by the protocol.
`;
  return new Map([
    ['apps/landing/sitemap.xml', sitemap([`${landingOrigin}/`])],
    ['apps/mini-app/public/sitemap.xml', sitemap(urls)],
    ['apps/landing/llms.txt', llms],
    ['apps/mini-app/public/llms.txt', llms],
  ]);
}

export async function generateDiscovery({ check = true, root = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  for (const [path, expected] of discoveryArtifacts()) {
    const file = resolve(root, path);
    if (check) {
      const actual = await readFile(file, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (actual.replace(/\r\n/g, '\n') !== expected) throw new Error(`${path} is stale. Run pnpm discovery:generate.`);
    } else {
      await writeFile(file, expected, 'utf8');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !['--check', '--write'].includes(mode[0])) {
    throw new Error('Usage: node --experimental-strip-types scripts/generate_discovery.mjs --check|--write');
  }
  generateDiscovery({ check: mode[0] === '--check' }).then(() => {
    console.log(`Discovery artifacts ${mode[0] === '--check' ? 'verified' : 'generated'} (two sitemaps and two llms.txt files).`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
