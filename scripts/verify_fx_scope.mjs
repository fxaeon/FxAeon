import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { WALLET_ROUTES, BOT_ROUTES, SERVER_MODULES, walletRouteViolation, botRouteViolation, serverModuleViolations } from './verify_miniapp_scope.mjs';

const root = resolve(import.meta.dirname, '..');
const mini = join(root, 'apps', 'mini-app');
const scopeLock = JSON.parse(await readFile(join(root, 'fx-scope.lock.json'), 'utf8'));

const expectedMethods = [
  'getPositions',
  'increasePosition',
  'reducePosition',
  'adjustPositionLeverage',
  'depositAndMint',
  'repayAndWithdraw',
  'getBridgeQuote',
  'buildBridgeTx',
  'getFxSaveBalance',
  'getFxSaveConfig',
  'getFxSaveRedeemStatus',
  'getFxSaveClaimable',
  'getRedeemTx',
  'depositFxSave',
  'withdrawFxSave',
].sort();

if (JSON.stringify([...scopeLock.methods].sort()) !== JSON.stringify(expectedMethods)) {
  fail('fx-scope.lock.json does not contain the exact official method contract');
}

const allowedRoutes = new Set([
  '',
  'activity',
  'borrow',
  // User documentation is a read-only surface, not an additional SDK method.
  'docs',
  'earn',
  'history',
  // Explicit passkey browser handoff and email-verification surfaces.
  'wallet-approval',
  'invite',
  'login',
  'more',
  'move',
  'portfolio',
  'positions',
  'qr',
  // User-requested native/ERC-20 wallet transfers do not add an SDK method.
  'send',
  'settings',
  'trade',
]);

const forbiddenSourcePatterns = [
  ['legacy backend client', /@\/lib\/api|\/api\/v1\/miniapp|NEXT_PUBLIC_BOT_API_URL/],
  ['server Privy authority', /@privy-io\/server-auth|PRIVY_AUTHORIZATION_KEY|PRIVY_APP_SECRET/],
  ['server admission credentials', /\b(?:RESEND_API_KEY|MINIAPP_OPERATOR_TOKEN|TELEGRAM_BOT_TOKEN)\b/],
  ['delegated signing', /grantAuthorization|walletDelegated|PRIVY_SIGNER_ID|NEXT_PUBLIC_PRIVY_SIGNER_ID/],
  ['removed shared protocol layer', /@fxaeon\/shared/],
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function fail(message) {
  throw new Error(`FxAeon scope verification failed: ${message}`);
}

function failInstalledDependency(message) {
  fail(`${message}. Restore dependencies in a clean checkout with pnpm install --frozen-lockfile, then rerun pnpm verify:scope. An incremental install may retain unpatched files; do not hand-edit node_modules.`);
}

const packageJson = JSON.parse(await readFile(join(mini, 'package.json'), 'utf8'));
if (packageJson.dependencies?.['@aladdindao/fx-sdk'] !== '1.0.5') {
  fail('@aladdindao/fx-sdk must remain exactly pinned to 1.0.5');
}
for (const [name, version] of Object.entries({
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
})) {
  if (typeof version !== 'string' || /^[~^*]|\bx\b|latest/i.test(version)) {
    fail(`dependency ${name} must use an exact reviewed version`);
  }
}

const declarationPath = join(mini, 'node_modules', '@aladdindao', 'fx-sdk', 'dist', 'index.d.ts');
const declaration = await readFile(declarationPath, 'utf8');
const shortPoolFix = [
  'rawCollateral: this.config.isShort ? 0n : poolInfoRes[2]',
  'debtCapacity: this.config.isShort ? poolInfoRes[2] : poolInfoRes[3]',
  'debtBalance: this.config.isShort ? poolInfoRes[3] : poolInfoRes[4]',
];
const debtRatioPackingFix = [
  'const min = BigInt(minDebtRatio);',
  'const max = BigInt(maxDebtRatio);',
  'const limit = 1n << 60n;',
  'return ((max << 60n) | min).toString();',
  'Debt ratio bounds must be unsigned integer strings',
  'Debt ratio bounds must fit uint60',
  'Minimum debt ratio cannot exceed maximum debt ratio',
];
const fxSaveDepositFloorFix = [
  'const scaledSlippage = slippage * 1000000;',
  'const tolerance = Math.round(scaledSlippage);',
  'Deposit slippage supports at most six decimal places',
  'const minShares = (basePoolSharesOut * BigInt(100000000 - tolerance) + 99999999n) / 100000000n;',
];
// A correct patch file/lock hash does not prove the installed files were
// patched. Check both entry points used by browser builds and Node tooling.
for (const bundle of ['index.js', 'index.cjs']) {
  const sdkRuntime = await readFile(
    join(mini, 'node_modules', '@aladdindao', 'fx-sdk', 'dist', bundle),
    'utf8',
  ).catch(() => failInstalledDependency(`the installed SDK ${bundle} could not be inspected`));
  if (shortPoolFix.some((required) => !sdkRuntime.includes(required))) {
    failInstalledDependency(`the installed SDK ${bundle} is missing the audited short-pool tuple fix`);
  }
  if (debtRatioPackingFix.some((required) => !sdkRuntime.includes(required))
    || sdkRuntime.includes('return cBN(maxDebtRatio).times(cBN(2).pow(60)).plus(minDebtRatio).toFixed(0);')) {
    failInstalledDependency(`the installed SDK ${bundle} is missing exact integer debt-ratio packing`);
  }
  if (fxSaveDepositFloorFix.some((required) => !sdkRuntime.includes(required))
    || sdkRuntime.includes('const minShares = indexRes > 0n ? basePoolSharesOut * 10n ** 18n * 9996n / indexRes / 10000n : basePoolSharesOut;')) {
    failInstalledDependency(`the installed SDK ${bundle} is missing the selected-slippage fxSAVE deposit floor`);
  }
  if (/console\.log\("(?:err------|poolData-->|poolInfo-->)"/.test(sdkRuntime)) {
    failInstalledDependency(`the installed SDK ${bundle} still contains audited-out production diagnostic logs`);
  }
}
const classStart = declaration.indexOf('declare class FxSdk');
const classEnd = declaration.indexOf('\n}\n\ndeclare const tokens', classStart);
if (classStart < 0 || classEnd < 0) fail('could not inspect the installed FxSdk class');
const methods = [...declaration.slice(classStart, classEnd).matchAll(/^\s{4}([A-Za-z]\w*)\(/gm)]
  .map((match) => match[1])
  .filter((method) => method !== 'constructor')
  .sort();
if (JSON.stringify(methods) !== JSON.stringify(expectedMethods)) {
  fail(`SDK method surface changed. Expected ${expectedMethods.join(', ')}; received ${methods.join(', ')}`);
}

const patch = await readFile(join(root, 'patches', '@aladdindao__fx-sdk@1.0.5.patch'), 'utf8');
for (const required of shortPoolFix) {
  if (!patch.includes(required)) fail('the audited upstream short-pool fix is missing');
}
for (const required of debtRatioPackingFix) {
  if (!patch.includes(required)) fail('the local exact debt-ratio packing fix is missing');
}
for (const required of fxSaveDepositFloorFix) {
  if (!patch.includes(required)) fail('the selected-slippage fxSAVE deposit floor fix is missing');
}

if (JSON.parse(await readFile(join(mini, 'package.json'), 'utf8')).dependencies['@privy-io/react-auth']) {
  fail('native Privy browser authentication must not return as an app dependency');
}

const staticHeaders = await readFile(join(mini, 'public', '_headers'), 'utf8');
const scriptDirective = staticHeaders.match(/script-src\s+([^;]+)/)?.[1];
if (!scriptDirective || scriptDirective.includes("'unsafe-inline'")) {
  fail("the production script-src policy must be hash-based and cannot allow 'unsafe-inline'");
}
const scriptSources = new Set(scriptDirective.split(/\s+/));
const frameSources = new Set(staticHeaders.match(/frame-src\s+([^;]+)/)?.[1].split(/\s+/) ?? []);
const childSources = new Set(staticHeaders.match(/child-src\s+([^;]+)/)?.[1].split(/\s+/) ?? []);
const connectSources = new Set(staticHeaders.match(/connect-src\s+([^;]+)/)?.[1].split(/\s+/) ?? []);
if ([...scriptSources, ...frameSources, ...childSources, ...connectSources].some(source => /privy\.(?:io|systems)|privy\.fxaeon\.com/.test(source))) {
  fail('native Privy browser authentication origins must not return');
}
if (connectSources.has('https:') || connectSources.has('wss:')) {
  fail('connect-src contains a broad scheme source instead of reviewed hosts');
}
for (const removedLog of ['console.log("err------"', 'console.log("poolData-->"', 'console.log("poolInfo-->"']) {
  if (!patch.includes(`-${'      '}${removedLog}`) && !patch.includes(`-${'    '}${removedLog}`)) {
    fail(`the SDK diagnostic-log removal is missing for ${removedLog}`);
  }
}

const config = await readFile(join(mini, 'src', 'lib', 'fx', 'config.ts'), 'utf8');
if (!config.includes(scopeLock.sdkCommit)) {
  fail('the audited upstream commit is not recorded in the client scope contract');
}

const appDirectory = join(mini, 'src', 'app');
for (const entry of await readdir(appDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const page = join(appDirectory, entry.name, 'page.tsx');
  const hasPage = await stat(page).then((value) => value.isFile()).catch(() => false);
  if (hasPage && !allowedRoutes.has(entry.name)) fail(`unsupported active route /${entry.name}`);
}

const sourceFiles = (await walk(join(mini, 'src')))
  .filter((file) => /\.(?:ts|tsx)$/.test(file));
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const [label, pattern] of forbiddenSourcePatterns) {
    if (pattern.test(source)) fail(`${label} remains in ${relative(root, file)}`);
  }
}

// The gas oracle and legacy admission route keep their existing boundaries.
// Two exact adapters expose the separately audited durable/passkey package.
const functionsDirectory = join(root, 'functions');
const functionFiles = await walk(functionsDirectory).catch(() => []);
const gasFunction = join(functionsDirectory, 'api', 'gas.ts');
const admissionFunction = join(functionsDirectory, 'api', 'telegram-admission.ts');
const signingAuthority = /PRIVATE_KEY|privateKey|\bsigner\b|walletClient|sendTransaction|subtle\.sign\b|generateKey/i;
for (const file of functionFiles) {
  const source = await readFile(file, 'utf8');
  if (file === gasFunction) {
    for (const [label, pattern] of [
      ['function private-key authority', /PRIVATE_KEY|privateKey|sign(?:er|ature)|walletClient|sendTransaction/i],
      ['function arbitrary proxy', /fetch(?:Impl)?\([^)]*(?:request\.url|searchParams\.get|target|endpoint)/is],
    ]) {
      if (pattern.test(source)) fail(`${label} remains in ${relative(root, file)}`);
    }
    if (!source.includes('ETHERSCAN_API_KEY') || !source.includes('ETHEREUM_CHAIN_ID')) {
      fail(`the gas Pages Function must use its fixed secret binding and chain: ${relative(root, file)}`);
    }
  } else if (file === admissionFunction) {
    if (signingAuthority.test(source)) fail(`function signing authority remains in ${relative(root, file)}`);
    if (/\bfetch\s*\(/.test(source)) fail(`the admission Pages Function must not make outbound requests: ${relative(root, file)}`);
    if (!source.includes('ADMISSION_DB') || !source.includes('TELEGRAM_BOT_ID') || !source.includes('crypto.subtle.verify')) {
      fail(`the admission Pages Function must verify launch data against its fixed bindings: ${relative(root, file)}`);
    }
  } else if (WALLET_ROUTES.has(relative(root, file).replaceAll('\\', '/'))) {
    const violation = walletRouteViolation(relative(root, file).replaceAll('\\', '/'), source);
    if (violation) fail(`${violation}: ${relative(root, file)}`);
  } else if (BOT_ROUTES.has(relative(root, file).replaceAll('\\', '/'))) {
    const violation = botRouteViolation(relative(root, file).replaceAll('\\', '/'), source);
    if (violation) fail(`${violation}: ${relative(root, file)}`);
  } else {
    fail(`unsupported Pages Function: ${relative(root, file)}`);
  }
}

for (const route of [...WALLET_ROUTES.keys(), ...BOT_ROUTES.keys()]) {
  if (!functionFiles.includes(join(root, route))) fail(`missing reviewed Pages Function: ${route}`);
}
const serverDirectory = join(root, 'server', 'miniapp-access');
const serverFiles = (await walk(serverDirectory)).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
for (const file of serverFiles) {
  const name = relative(serverDirectory, file).replaceAll('\\', '/');
  for (const violation of serverModuleViolations(name, await readFile(file, 'utf8'))) fail(`${violation}: ${relative(root, file)}`);
}
for (const name of SERVER_MODULES) {
  if (!serverFiles.includes(join(serverDirectory, name))) fail(`missing reviewed server module: ${name}`);
}
const serverPackage = JSON.parse(await readFile(join(serverDirectory, 'package.json'), 'utf8'));
if (serverPackage.name !== '@fxaeon/miniapp-access' || serverPackage.private !== true) fail('the server package must remain private');
for (const [name, version] of Object.entries({ ...serverPackage.dependencies, ...serverPackage.devDependencies })) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) fail(`server dependency ${name} must use an exact reviewed version`);
}

const workflowDirectory = join(root, '.github', 'workflows');
const workflowFiles = (await walk(workflowDirectory)).filter((file) => /\.ya?ml$/.test(file));
for (const file of workflowFiles) {
  const workflow = await readFile(file, 'utf8');
  for (const match of workflow.matchAll(/\buses:\s*[^\s@]+@([^\s#]+)/g)) {
    if (!/^[0-9a-f]{40}$/i.test(match[1])) {
      fail(`workflow action is not pinned to a full commit SHA in ${relative(root, file)}: ${match[0]}`);
    }
  }
}

console.log(`FxAeon scope verified: ${expectedMethods.length} official methods, ${allowedRoutes.size} routes; frontend authority, gas, admission, two wallet adapters, and the Telegram-only bot adapter are bounded.`);
