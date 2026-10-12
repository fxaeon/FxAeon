import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const headers = readFileSync(resolve(root, '_headers'), 'utf8').split(/\r?\n/)
  .filter((line) => /^\s+[^:]+:/.test(line))
  .map((line) => { const separator = line.indexOf(':'); return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]; });
createServer((req, res) => {
  for (const [key, value] of headers) res.setHeader(key, value);
  const notFound = () => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(resolve(root, '404.html')).on('error', () => res.end('Page not found')).pipe(res);
  };
  let requested;
  try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }
  const path = resolve(root, `.${requested}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) { res.writeHead(403); res.end('Forbidden'); return; }
  try { const file = statSync(path).isDirectory() ? resolve(path, 'index.html') : path; statSync(file); res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); createReadStream(file).on('error', () => { if (!res.headersSent) notFound(); else res.end(); }).pipe(res); }
  catch { notFound(); }
}).listen(process.env.PORT || 4173, '127.0.0.1', () => console.log(`Landing preview: http://127.0.0.1:${process.env.PORT || 4173}`));
