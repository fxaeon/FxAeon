import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local verification server only. No planning, wallet, account or write API.
const root = fileURLToPath(new URL('..', import.meta.url));
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const directory = resolve(root, argument('--dir') ?? 'dist');
const port = Number(argument('--port') ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !directory.startsWith(root)) throw new Error('Invalid local preview configuration.');
const rules = [];
for (const line of readFileSync(resolve(directory, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), values: {} });
  else {
    const colon = line.indexOf(':');
    if (colon < 0 || !rules.length) throw new Error('Invalid security header configuration.');
    rules.at(-1).values[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) { response.writeHead(404); response.end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(directory, '.' + path);
  if (!file.startsWith(directory + sep)) { response.writeHead(404); response.end(); return; }
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file');
    const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' };
    for (const rule of rules) if (rule.pattern === '/*' || (rule.pattern.endsWith('*') && path.startsWith(rule.pattern.slice(0, -1))) || path === rule.pattern) Object.assign(headers, rule.values);
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : readFileSync(file));
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); response.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Local preview: http://127.0.0.1:${port} (${directory.split(sep).at(-1)})\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
