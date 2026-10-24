import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
assert.match(workspace, /'zod@3\.22\.4': '3\.25\.76'/);
assert.match(workspace, /'zod@4\.4\.3': '4\.6\.7'/);
assert.match(workspace, /zod@3\.25\.76: patches\/zod@3\.25\.76\.patch/);
assert.match(workspace, /zod@4\.6\.7: patches\/zod@4\.6\.7\.patch/);
const packageVersions = [...lock.matchAll(/^  zod@([^:]+):$/gm)].map((match) => match[1]);
assert.deepEqual(packageVersions.sort(), ['3.25.76', '4.6.7'], 'Re-review all resolved Zod versions');
assert.match(lock, /^  zod@3\.25\.76: f2cc235a1c60e57a7eddf149dd5478b5718dbae033ca1483805099bb371fef9f$/m);
assert.match(lock, /^  zod@4\.6\.7: 535b41d8a1d7656e8a072d730e3541ac5fee84d0d7da95fa1db8f648c6e40759$/m);

const expected = {
  '3.25.76': {
    'src/v3/types.ts': '43e7d808270d2521f9969d81fcddce1df165618483454b72d0c19df98f6e61f3',
    'src/v4/core/checks.ts': '272d9ac8c08d7775d65ab7eda663004920ed4e687c4093aaac24c7468849669d',
    'src/v4/core/schemas.ts': '8643ad3337964b6b93d538b4155b0b84085d649e2c10a36ee754cd3d787f40ff',
    'v3/types.cjs': 'f4597f1b60eac1287f0549d1285653429d1f73695261f8c6367cd30d2810b08e',
    'v3/types.js': '46f45bebd1f349bc340c77ae973e22b0a5a184f3683a39cc88e3f4e13c2c21b3',
    'v4/core/checks.cjs': '5a9c0cb8672b56e943a487addeee963b26b45d7f62a1b6b1f47d3ea47e7ac425',
    'v4/core/checks.js': '2904b783a6cd7c3edbe42a0db914d24f172951d0fcfe47601af8d517b52e8426',
    'v4/core/schemas.cjs': '950fe8d397473ad5ff9c985a38b68f75864811b2f2ef69e8abb2b68684b7e73e',
    'v4/core/schemas.js': 'cd4a117a266a4d30601902bce9d3706f97b70bc89fff2541545a44e0b804d022',
  },
  '4.6.7': {
    'src/v3/types.ts': '6951412f7d0ac358d141ab62ba9a02d771ca2afb9b8035e97f842670e40ad7e8',
    'v3/types.cjs': '99170c934876b4ae77ec976b2ecc9ef46beace793675f8cf11f90b5395d95a03',
    'v3/types.js': 'e1fffb0c76dd1cd8c6e17562faf94e5f3c216c6a8dda087392c5641c9e8c38d4',
  },
};

const miniAppRequire = createRequire(resolve(root, 'apps/mini-app/package.json'));
function packageFromConsumer(packageRequire, version) {
  const entry = packageRequire.resolve('zod');
  const packageRoot = dirname(entry);
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version, `Unexpected Zod consumer version at ${packageRoot}`);
  for (const [file, hash] of Object.entries(expected[version])) {
    const source = readFileSync(resolve(packageRoot, file));
    assert.equal(createHash('sha256').update(source).digest('hex'), hash, `Unverified zod@${version} ${file}`);
  }
  return { packageRoot, require: createRequire(entry) };
}

// Verify each package path the app uses for Zod 3, then the Zod 4 path reached
// through Wagmi's connector stack. This guards the active virtual-store links,
// not merely patch files or stale package directories left by older installs.
const zod3Roots = new Set();
let zod3Require;
for (const dependency of ['viem', '@aladdindao/fx-sdk', '@privy-io/react-auth', 'wagmi']) {
  const { packageRoot, require } = packageFromConsumer(createRequire(miniAppRequire.resolve(dependency)), '3.25.76');
  zod3Roots.add(packageRoot);
  zod3Require ??= require;
}
assert.equal(zod3Roots.size, 1, 'Zod 3 consumers must share the single patched lockfile instance');

const wagmiRequire = createRequire(miniAppRequire.resolve('wagmi'));
const portoRequire = createRequire(wagmiRequire.resolve('porto'));
const { packageRoot: zod4Root, require: zod4Require } = packageFromConsumer(portoRequire, '4.6.7');
assert.ok(zod4Root !== [...zod3Roots][0], 'Zod 3 and Zod 4 must remain separate package instances');

async function assertBoundedArrayAndSet(z, name) {
  for (const [kind, build, input] of [
    ['array', (element, later) => z.array(z.number().refine(() => { element(); return true; })).min(1).max(1).refine(() => { later(); return true; }), [1, 2]],
    ['set', (element, later) => z.set(z.number().refine(() => { element(); return true; })).min(1).max(1).refine(() => { later(); return true; }), new Set([1, 2])],
  ]) {
    let elements = 0;
    let later = 0;
    const schema = build(() => elements++, () => later++);
    const result = schema.safeParse(input);
    assert.equal(result.success, false, `${name} ${kind} must reject oversized input`);
    assert.equal(result.error.issues.length, 1, `${name} ${kind} must report one bound error`);
    assert.equal(elements, 0, `${name} ${kind} must reject before parsing elements`);
    assert.equal(later, 0, `${name} ${kind} must skip later collection refinements`);
    elements = later = 0;
    const asyncResult = await schema.safeParseAsync(input);
    assert.equal(asyncResult.success, false, `${name} async ${kind} must reject oversized input`);
    assert.equal(asyncResult.error.issues.length, 1, `${name} async ${kind} must report one bound error`);
    assert.equal(elements, 0, `${name} async ${kind} must reject before parsing elements`);
    assert.equal(later, 0, `${name} async ${kind} must skip later collection refinements`);
  }
  let boundaryVisits = 0;
  const boundary = z.array(z.number().refine(() => { boundaryVisits++; return true; })).max(2).safeParse([1, 2]);
  assert.equal(boundary.success, true, `${name} valid boundary must remain accepted`);
  assert.equal(boundaryVisits, 2, `${name} valid boundary must still parse its elements`);
}

async function assertBoundedMap(z, name) {
  for (const asyncMode of [false, true]) {
    let elements = 0;
    let later = 0;
    const schema = z.map(z.string(), z.number().refine(() => { elements++; return true; }))
      .check(z.minSize(1), z.maxSize(1)).refine(() => { later++; return true; });
    const input = new Map([['a', 1], ['b', 2]]);
    const result = asyncMode ? await schema.safeParseAsync(input) : schema.safeParse(input);
    assert.equal(result.success, false, `${name} ${asyncMode ? 'async ' : ''}map must reject oversized input`);
    assert.equal(result.error.issues.length, 1, `${name} map must report one bound error`);
    assert.equal(elements, 0, `${name} map must reject before parsing values`);
    assert.equal(later, 0, `${name} map must skip later collection refinements`);
  }
}

function assertBackportCompatibility(z, name) {
  const transformed = z.array(z.string().transform((value) => value.toLowerCase()))
    .max(1, { when: (payload) => payload.value[0] === 'A' }).safeParse(['A', 'B']);
  assert.equal(transformed.success, true, `${name} custom when must retain transformed-value semantics`);
  assert.deepEqual(transformed.data, ['a', 'b']);
}

function assertOverwriteCompatibility(z, name) {
  const overwritten = z.array(z.string()).overwrite((values) => values.slice(0, 1)).max(1).safeParse(['a', 'b']);
  assert.equal(overwritten.success, true, `${name} overwrite before max must remain valid`);
  assert.deepEqual(overwritten.data, ['a']);
}

const zod3 = zod3Require('zod');
const zod3V4 = zod3Require('zod/v4');
const zod4V3 = zod4Require('zod/v3');
const zod4 = zod4Require('zod');
for (const [z, name] of [
  [zod3, 'Zod 3 public API'],
  [zod3V4, 'Zod 3 bundled v4'],
  [zod4V3, 'Zod 4 bundled v3'],
  [zod4, 'Zod 4 public API'],
]) await assertBoundedArrayAndSet(z, name);
await assertBoundedMap(zod3V4, 'Zod 3 bundled v4');
await assertBoundedMap(zod4, 'Zod 4 public API');
assertBackportCompatibility(zod3V4, 'Zod 3 bundled v4');
assertOverwriteCompatibility(zod3V4, 'Zod 3 bundled v4');
assertOverwriteCompatibility(zod4, 'Zod 4 public API');

console.log('[audit] Verified patched Zod 3/4 package hashes and active app consumer paths; Zod 3 APIs remain separate from Zod 4.');
