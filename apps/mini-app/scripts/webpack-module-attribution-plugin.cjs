'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const PLUGIN_NAME = 'FxAeonPrivateWebpackModuleAttributionPlugin';
const REPORT_SUBDIRECTORY = path.join('.cache', 'webpack-module-attribution');
const APP_PATH_CHARS = /^[A-Za-z0-9_.$@+()/-]+$/;
const TOKEN_CHARS = /^[A-Za-z0-9._:-]+$/;
const ASSET_CHARS = /^[A-Za-z0-9._-]+$/;

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function privateReportDirectory(context, outputPath) {
  const appRoot = path.resolve(context);
  const directory = path.resolve(appRoot, REPORT_SUBDIRECTORY);
  const publicOutput = path.resolve(outputPath);
  if (isWithin(directory, publicOutput) || isWithin(publicOutput, directory)) {
    throw new Error('Private webpack attribution path overlaps the configured build output.');
  }
  return directory;
}

function safeToken(value, maxLength = 120) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const token = String(value);
  return token.length > 0 && token.length <= maxLength && TOKEN_CHARS.test(token) ? token : null;
}

function safeAsset(value) {
  if (typeof value !== 'string') return null;
  const base = path.basename(value.replace(/[\\/]/g, path.sep));
  return base.length <= 180 && ASSET_CHARS.test(base) ? base : null;
}

/** Keep only app-relative source paths or npm package identities. */
function safeModuleLabel(rawIdentifier, context) {
  if (typeof rawIdentifier !== 'string' || rawIdentifier.length > 16_384) return '[unidentified]';

  // A webpack identifier may include `loader!resource?options`. Keep only the
  // resource. Loader requests and resource queries can contain local paths or
  // sensitive build parameters, so they are never serialized.
  const resourceRequest = rawIdentifier.slice(rawIdentifier.lastIndexOf('!') + 1);
  const resource = resourceRequest.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  if (!resource || /^(?:data:|webpack:|javascript:)/i.test(resource)) return '[virtual]';

  const normalizedContext = path.resolve(context).replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedResource = path.posix.normalize(resource);
  const nodeModulesMarker = '/node_modules/';
  const packageIndex = normalizedResource.lastIndexOf(nodeModulesMarker);
  if (packageIndex >= 0) {
    const parts = normalizedResource.slice(packageIndex + nodeModulesMarker.length).split('/').filter(Boolean);
    const packageParts = parts[0]?.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1);
    if (packageParts.length && packageParts.every((part) => /^[A-Za-z0-9@._+-]+$/.test(part))) {
      const packageName = packageParts.join('/');
      const tail = parts.slice(packageParts.length).filter((part) => /^[A-Za-z0-9@._+-]+$/.test(part)).slice(0, 4);
      return `npm:${packageName}${tail.length ? `/${tail.join('/')}` : ''}`;
    }
    return 'npm:[package]';
  }

  const prefix = `${normalizedContext}/`;
  if (normalizedResource.startsWith(prefix)) {
    const relative = normalizedResource.slice(prefix.length);
    if (relative && APP_PATH_CHARS.test(relative) && !relative.split('/').includes('..')) return `app:${relative}`;
  }
  return '[external-or-virtual]';
}

function moduleSizeEstimate(module) {
  try {
    const size = module?.size?.();
    return Number.isFinite(size) && size >= 0 ? Math.round(size) : null;
  } catch {
    return null;
  }
}

function nestedModuleIterable(module) {
  // Webpack's ConcatenatedModule exposes its constituent modules as `modules`.
  // Treat it as optional so ordinary modules and other webpack versions work.
  const nested = module?.modules;
  return nested && typeof nested[Symbol.iterator] === 'function' ? nested : [];
}

function moduleRecord(module, compilation, context, seen, parentLabel = null, depth = 0) {
  if (!module || seen.has(module) || depth > 12) return null;
  seen.add(module);

  const { chunkGraph, moduleGraph } = compilation;
  let issuer = null;
  try { issuer = moduleGraph?.getIssuer?.(module) ?? null; } catch { /* ModuleGraph may omit a synthetic issuer. */ }
  let id = null;
  try { id = safeToken(chunkGraph?.getModuleId?.(module)); } catch { /* Concatenated child modules may not have assigned IDs. */ }

  let rawIdentifier = null;
  try { rawIdentifier = module.identifier?.() ?? null; } catch { /* Keep an unreadable module opaque. */ }
  const label = safeModuleLabel(rawIdentifier, context);
  const nestedModules = [];
  for (const child of nestedModuleIterable(module)) {
    const record = moduleRecord(child, compilation, context, seen, label, depth + 1);
    if (record) nestedModules.push(record);
  }

  const type = safeToken(module.type, 80);
  let issuerLabel = null;
  if (issuer) {
    try { issuerLabel = safeModuleLabel(issuer.identifier?.(), context); } catch { /* Keep an unreadable issuer opaque. */ }
  }
  return {
    id,
    label,
    type,
    estimatedBytes: moduleSizeEstimate(module),
    issuer: issuerLabel,
    concatenatedInto: parentLabel,
    ...(nestedModules.length ? { nestedModules } : {}),
  };
}

function createReport(compilation, context) {
  const chunks = [];
  for (const chunk of compilation.chunks ?? []) {
    let modules = [];
    try {
      modules = Array.from(compilation.chunkGraph.getChunkModulesIterable(chunk) ?? []);
    } catch {
      try { modules = Array.from(compilation.chunkGraph.getChunkModules(chunk) ?? []); } catch { modules = []; }
    }
    const seen = new WeakSet();
    const moduleRecords = modules.map((module) => moduleRecord(module, compilation, context, seen)).filter(Boolean);
    const assets = Array.from(chunk.files ?? []).map(safeAsset).filter(Boolean).sort();
    let initial = null;
    try { initial = typeof chunk.canBeInitial === 'function' ? Boolean(chunk.canBeInitial()) : null; } catch { /* Older chunk implementations may not expose it. */ }
    chunks.push({
      id: safeToken(chunk.id),
      name: safeToken(chunk.name),
      initial,
      assets,
      modules: moduleRecords,
    });
  }
  chunks.sort((a, b) => String(a.name ?? a.id ?? '').localeCompare(String(b.name ?? b.id ?? '')));
  return {
    schemaVersion: 1,
    scope: 'webpack-client-compilation',
    estimates: 'Webpack Module.size() estimates; no module source text is serialized.',
    hasErrors: Boolean(compilation.errors?.length),
    chunks,
  };
}

function assertNoSymlinkInPrivatePath(appRoot, reportDirectory) {
  const relative = path.relative(appRoot, reportDirectory);
  let current = appRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = require('node:fs').lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error('Private webpack attribution path must not traverse a symlink.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function assertReportDestinationNotSymlink(reportPath, lstat = fsSync.lstatSync) {
  try {
    if (lstat(reportPath).isSymbolicLink()) {
      throw new Error('Private webpack attribution report must not replace or follow a symlink.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

class WebpackModuleAttributionPlugin {
  apply(compiler) {
    compiler.hooks.done.tapPromise(PLUGIN_NAME, async (stats) => {
      const compilation = stats.compilation;
      const appRoot = path.resolve(compiler.context);
      const outputPath = path.resolve(compilation.outputOptions?.path ?? compiler.options?.output?.path ?? path.join(appRoot, 'dist'));
      const reportDirectory = privateReportDirectory(appRoot, outputPath);
      assertNoSymlinkInPrivatePath(appRoot, reportDirectory);
      await fs.mkdir(reportDirectory, { recursive: true });
      const reportPath = path.join(reportDirectory, 'client-module-attribution.json');
      assertReportDestinationNotSymlink(reportPath);
      const report = createReport(compilation, appRoot);
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    });
  }
}

function isEnabled(env = process.env, isServer = false) {
  return !isServer && env.FX_WEBPACK_ATTRIBUTION === '1';
}

function installOptInPlugin(config, options = {}) {
  if (!isEnabled(options.env, options.isServer)) return false;
  if (!Array.isArray(config.plugins)) config.plugins = [];
  config.plugins.push(new WebpackModuleAttributionPlugin());
  return true;
}

module.exports = {
  WebpackModuleAttributionPlugin,
  createReport,
  assertReportDestinationNotSymlink,
  installOptInPlugin,
  isEnabled,
  privateReportDirectory,
  safeModuleLabel,
};
