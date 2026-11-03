import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'apps', 'mini-app', 'src');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function fail(message) {
  throw new Error(`FxAeon architecture verification failed: ${message}`);
}

// Inspect the TypeScript syntax tree instead of searching raw text. Product
// copy and comments can name the SDK; only module syntax or a runtime module
// load escapes the audited boundary.
export function moduleSpecifiers(source, fileName = 'architecture-contract.ts') {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const record = node => { if (node && ts.isStringLiteralLike(node)) found.push(node.text); };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node)) record(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)) record(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)) record(node.argument.literal);
    else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(expression) && expression.text === 'require')) record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function hasDirectSdkImport(source, fileName) {
  return moduleSpecifiers(source, fileName).includes('@aladdindao/fx-sdk');
}

export function hasServerImport(source, fileName = 'apps/mini-app/src/contract.ts') {
  return moduleSpecifiers(source, fileName).some(specifier => {
    const name = specifier.replaceAll('\\', '/');
    if (/^(?:@fxaeon\/miniapp-access|@simplewebauthn\/server|@privy-io\/(?:server-auth|node)|server-only)(?:\/|$)/.test(name)) return true;
    const target = name.startsWith('@/') ? posix.normalize(`apps/mini-app/src/${name.slice(2)}`)
      : name.startsWith('.') ? posix.normalize(posix.join(posix.dirname(fileName.replaceAll('\\', '/')), name)) : name;
    return /(?:^|\/)(?:server|functions)(?:\/|$)/.test(target);
  });
}

const directSdkAllowlist = new Set([
  'apps/mini-app/src/app/trade/fxUi.ts',
  'apps/mini-app/src/app/trade/canonicalPositionReader.ts',
  'apps/mini-app/src/components/BridgeTracker.tsx',
  'apps/mini-app/src/lib/confirmedPositions.ts',
]);

export async function verifyArchitecture() {
for (const file of await walk(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  const isFacade = name.startsWith('apps/mini-app/src/lib/fx/');
  if (hasServerImport(source, name)) fail(`frontend import crosses the server boundary: ${name}`);
  if (hasDirectSdkImport(source)
    && !isFacade && !directSdkAllowlist.has(name)) {
    fail(`direct SDK import must stay behind the fx façade or an audited display adapter: ${name}`);
  }
  if (/from\s+["']@\/lib\/fx\/sdk["']/.test(source) && !isFacade) {
    fail(`SDK singleton import escaped the fx façade: ${name}`);
  }
  // Keep the process-wide SDK singleton private even when a route tries to
  // reach it through the barrel export (`@/lib/fx`). Product code should use
  // the typed read façade or the service boundary instead.
  if (/\b(?:getFxSdk|createFxSdkFacade)\s*\(/.test(source) && !isFacade) {
    fail(`SDK singleton construction escaped the fx façade: ${name}`);
  }
  if (/\bnew\s+(?:Shared)?Worker\s*\(|navigator\.serviceWorker\.register\s*\(|\bimportScripts\s*\(/.test(source)
    && !isFacade) {
    fail(`runtime worker authority is not allowed in the app layer: ${name}`);
  }
}

console.log('FxAeon architecture verified: SDK access is bounded, server modules stay outside the frontend, and no app-layer worker authority is active.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await verifyArchitecture();
