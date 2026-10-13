/**
 * Tiny dependency-free static server for the Next.js static export (`dist/`),
 * used as Playwright's `webServer`. It:
 *   - builds the export first if `dist/index.html` is missing (or E2E_BUILD=1),
 *     baking the deterministic no-credentials env the tests assume;
 *   - serves clean URLs the way Cloudflare Pages does (`/portfolio` → `portfolio.html`);
 *   - serves `_next/**` assets with correct content-types;
 *   - falls back to `404.html` so the app's not-found page renders.
 *
 * The build env is pinned here so the running app's behaviour matches the
 * no-backend, no-wallet, no-RPC test contract.
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { E2E_BUILD_ENV } from '../../../scripts/e2e_build_env.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_DIR = process.env.FX_E2E_DIST_DIR?.trim() || 'dist';
if (!/^[a-zA-Z0-9_-]+$/.test(DIST_DIR)) {
  throw new Error('FX_E2E_DIST_DIR must be a simple directory name inside the mini-app workspace');
}
const DIST = join(ROOT, DIST_DIR);
const PORT = Number(process.env.PORT || 4321);

const BUILD_ENV = E2E_BUILD_ENV;

function buildIfNeeded() {
  if (existsSync(join(DIST, 'index.html')) && process.env.E2E_BUILD !== '1') return;
   
  console.log('[e2e] building mini-app static export…');
  // Reuse the package-manager CLI that launched Playwright. This works
  // cross-platform and avoids Windows .cmd shell shims; Corepack remains a
  // direct-exec fallback.
  const packageManagerCli = process.env.npm_execpath;
  const useInheritedPackageManager = packageManagerCli && existsSync(packageManagerCli);
  const windowsFallback = process.platform === 'win32' && !useInheritedPackageManager;
  const command = useInheritedPackageManager
    ? process.execPath
    : windowsFallback
      ? process.env.ComSpec || 'cmd.exe'
      : 'pnpm';
  const isNpmCli = Boolean(packageManagerCli && /npm-cli\.(?:c?js)$/i.test(packageManagerCli));
  const args = useInheritedPackageManager
    ? [packageManagerCli, ...(isNpmCli ? ['run', 'build'] : ['build'])]
    : windowsFallback
      ? ['/d', '/s', '/c', 'pnpm.cmd', 'build']
      : ['build'];
  const res = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...BUILD_ENV },
    windowsHide: true,
  });
  if (res.status !== 0) {
    console.error(`[e2e] build failed${res.error ? `: ${res.error.message}` : ''}`);
    process.exit(res.status ?? 1);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export async function createExportManifest(distRoot) {
  // Build all request keys from the export tree once. Symlinks are deliberately
  // ignored so neither routes nor assets can point outside the static export.
  const rootInfo = await lstat(distRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('static export root must be a real directory');
  }

  const files = new Map();
  const directoryRoutes = new Map();
  const cleanRoutes = new Map();

  async function collect(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await collect(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const urlPath = `/${relativePath}`;
      const file = { path: absolutePath, urlPath };
      files.set(urlPath, file);

      if (relativePath === 'index.html') {
        directoryRoutes.set('/', file);
      } else if (relativePath.endsWith('/index.html')) {
        const directoryRoute = `/${relativePath.slice(0, -'index.html'.length).replace(/\/$/, '')}`;
        directoryRoutes.set(directoryRoute, file);
        directoryRoutes.set(`${directoryRoute}/`, file);
      }

      if (relativePath.endsWith('.html')) {
        const cleanRoute = `/${relativePath.slice(0, -'.html'.length)}`;
        cleanRoutes.set(cleanRoute, file);
        cleanRoutes.set(`${cleanRoute}/`, file);
      }
    }
  }

  await collect(distRoot);

  // Exact exported paths win, then directory indexes, then clean .html routes.
  const manifest = new Map(files);
  for (const [route, file] of directoryRoutes) {
    if (!manifest.has(route)) manifest.set(route, file);
  }
  for (const [route, file] of cleanRoutes) {
    if (!manifest.has(route)) manifest.set(route, file);
  }
  return manifest;
}

export function normalizeRequestPath(requestTarget) {
  const rawPath = String(requestTarget).split('?', 1)[0];
  if (!rawPath.startsWith('/')) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath).replace(/\\/g, '/');
  } catch {
    return null;
  }

  // Reject traversal segments instead of normalizing them onto another route.
  if (decodedPath.split('/').includes('..')) return null;
  const normalizedPath = posix.normalize(decodedPath);
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

export function createStaticServer(manifest) {
  return createServer(async (req, res) => {
    try {
      const requestPath = normalizeRequestPath(req.url || '/');
      const entry = requestPath ? manifest.get(requestPath) : null;
      if (!entry) {
        const notFound = manifest.get('/404.html');
        const body = notFound ? await readFile(notFound.path) : Buffer.from('Not found');
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      const body = await readFile(entry.path);
      const type = MIME[extname(entry.path)] || 'application/octet-stream';
      // Immutable hashed assets can cache; HTML must not (deterministic test runs).
      const cache = entry.urlPath.startsWith('/_next/') && extname(entry.path) !== '.html'
        ? 'public, max-age=31536000, immutable'
        : 'no-store';
      res.writeHead(200, { 'content-type': type, 'cache-control': cache });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`server error: ${err?.message ?? err}`);
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  buildIfNeeded();
  const manifest = await createExportManifest(DIST);
  const server = createStaticServer(manifest);

  // Test and screenshot builds can contain disposable local-fork configuration.
  // Never expose their server on the machine's LAN interfaces.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[e2e] serving ${DIST} at http://localhost:${PORT}`);
  });
}
