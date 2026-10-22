import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUiStateLabBundle } from './harness/state-lab-build.mjs';

const port = Number(process.env.UI_STATE_LAB_PORT || 4322);
const publicRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), 'public');
const bundle = await buildUiStateLabBundle();
const html = `<!doctype html><html lang="en" data-theme="official" data-product-ui="v2" style="--font-sans:Inter,Arial,sans-serif"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FxAeon UI state lab</title><link rel="stylesheet" href="/styles.css"></head><body style="font-family:Inter,Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  if (request.url === '/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(bundle.script);
    return;
  }
  if (request.url === '/styles.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
    response.end(bundle.css);
    return;
  }
  if (request.url === '/state-lab-font.woff2' && bundle.fontAsset) {
    response.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'no-store' });
    response.end(bundle.fontAsset);
    return;
  }
  if (request.url === '/' || request.url?.startsWith('/?')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html);
    return;
  }
  if (request.url?.startsWith('/token-icons/') || request.url?.startsWith('/chain-icons/') || request.url?.startsWith('/fonts/')) {
    const asset = resolve(publicRoot, decodeURIComponent(request.url.slice(1)));
    if (asset.startsWith(`${publicRoot}${sep}`)) {
      try {
        const body = await readFile(asset);
        const mime = extname(asset) === '.svg' ? 'image/svg+xml' : extname(asset) === '.png' ? 'image/png' : extname(asset) === '.woff2' ? 'font/woff2' : 'application/octet-stream';
        response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
        response.end(body);
        return;
      } catch { /* fall through to 404 */ }
    }
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});
server.listen(port, '127.0.0.1', () => console.log(`[state-lab] ready at http://127.0.0.1:${port}`));
