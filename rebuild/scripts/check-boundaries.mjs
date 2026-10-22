import { readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('package.json'));
const surface = JSON.parse(read('protocol-surface.json'));
const approved = ['getPositions', 'increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw', 'getBridgeQuote', 'buildBridgeTx', 'getFxSaveBalance', 'getFxSaveConfig', 'getFxSaveRedeemStatus', 'getFxSaveClaimable', 'getRedeemTx', 'depositFxSave', 'withdrawFxSave'];
assert.deepEqual(surface.methods, approved, 'The reviewed 15-method surface changed');
assert.equal(surface.sdkCommit, '53c0b9805a169e75ad375c92c241e1292b66405f');
assert.equal(surface.sdkPackage, '@aladdindao/fx-sdk@1.0.5');
assert.equal(manifest.dependencies['@aladdindao/fx-sdk'], '1.0.5');
const provenance = JSON.parse(read('vendor/PROVENANCE.json'));
assert.equal(sha256(read('vendor/fx-sdk-1.0.5.patch')), provenance.patchSha256, 'Reviewed vendor patch drift');
const require = createRequire(import.meta.url);
const vendorRoot = dirname(dirname(realpathSync(require.resolve('@aladdindao/fx-sdk'))));
for (const [file, expected] of Object.entries(provenance.installed)) assert.equal(sha256(readFileSync(resolve(vendorRoot, file))), expected, `Installed reviewed SDK drift: ${file}`);

function walk(path) { return readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(resolve(path, item.name)) : [resolve(path, item.name)]); }
const source = walk(resolve(root, 'src')).filter(path => /\.(tsx?|css)$/.test(path));
const signingSites = [];
const sdkMethods = [];
for (const path of source) {
  const name = relative(root, path);
  const content = readFileSync(path, 'utf8');
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(content), `Possible secret in ${name}`);
  if (!/\.tsx?$/.test(path)) continue;
  const ast = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function inspect(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text === 'eth_sendTransaction') signingSites.push(name);
      assert.ok(!['eth_sendRawTransaction', 'eth_sign', 'personal_sign'].includes(node.text), `Unexpected signing surface in ${name}`);
      if (node.text === '@aladdindao/fx-sdk') assert.equal(name, 'src/protocol/index.ts', 'SDK import escaped the protocol boundary');
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      assert.ok(!specifier.startsWith('node:'), `Server-only import in ${name}`);
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(path), specifier);
        assert.ok(target.startsWith(resolve(root, 'src') + '/'), `Application imported old code or tests: ${name}`);
      }
      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) {
        assert.ok(!['privateKeyToAccount', 'mnemonicToAccount', 'generatePrivateKey', 'createWalletClient'].includes(item.propertyName?.text ?? item.name.text), `Application signer import in ${name}`);
      }
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'SdkPort') for (const method of node.members) {
      assert.ok(ts.isMethodSignature(method) && ts.isIdentifier(method.name), 'SDK facade must use explicit named methods');
      sdkMethods.push(method.name.text);
    }
    if (ts.isJsxAttribute(node)) assert.notEqual(node.name.getText(ast), 'dangerouslySetInnerHTML', `Unreviewed raw HTML in ${name}`);
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
}
assert.deepEqual(signingSites, ['src/wallet/browser.ts'], 'The selected wallet must own the single application send site');
assert.deepEqual(sdkMethods.sort(), [...surface.checkpointImplementedMethods].sort(), 'Checkpoint method declarations drifted');
assert.ok(sdkMethods.every(method => approved.includes(method)));
const production = walk(resolve(root, 'dist'));
assert.ok(production.every(file => !file.endsWith('.map')), 'Production source maps are not part of this release policy');
for (const path of production.filter(path => /\.(js|html)$/.test(path))) {
  const content = readFileSync(path, 'utf8');
  assert.ok(!['__fxaeonTest', 'The simulation build may run only on loopback.', 'Fixture reviewed/send mismatch', 'Unsupported fixture wallet method'].some(marker => content.includes(marker)), `Fixture code leaked into ${relative(root, path)}`);
}
const headers = read('public/_headers');
for (const expected of ["object-src 'none'", "base-uri 'none'", "form-action 'none'", 'Referrer-Policy: no-referrer', 'X-Content-Type-Options: nosniff']) assert.ok(headers.includes(expected), `Missing security policy: ${expected}`);
assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline|connect-src[^;]*\*/.test(headers.replaceAll('https://*.g.alchemy.com', 'https://eth-mainnet.g.alchemy.com').replaceAll('https://*.infura.io', 'https://mainnet.infura.io')), 'Unexpected broad execution/connection policy');
const report = { generatedAt: new Date().toISOString(), sourceFiles: source.length, vendorHashes: 'match', sdkPin: surface.sdkPackage, approvedMethods: approved.length, implementedMethods: sdkMethods, signingSites, fixtureIsolation: 'passed', securityHeaders: 'passed', limitation: 'Static boundary checks supplement behavioral tests; they do not prove absence of every possible secret or vulnerability.' };
mkdirSync(resolve(root, 'test-results'), { recursive: true });
writeFileSync(resolve(root, 'test-results/boundaries.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`Boundary checks passed: ${source.length} source files; exact installed SDK hashes; ${approved.length} pinned methods; ${sdkMethods.length} used in checkpoint; one wallet send site; no fixture in production.\n`);
