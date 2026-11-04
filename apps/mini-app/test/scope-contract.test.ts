import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OFFICIAL_FX_METHODS } from "../src/lib/fx/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCOPE_FILE = join(HERE, "..", "..", "..", "fx-scope.lock.json");

const EXPECTED_METHODS = [
  "getPositions",
  "increasePosition",
  "reducePosition",
  "adjustPositionLeverage",
  "depositAndMint",
  "repayAndWithdraw",
  "getBridgeQuote",
  "buildBridgeTx",
  "getFxSaveBalance",
  "getFxSaveConfig",
  "getFxSaveRedeemStatus",
  "getFxSaveClaimable",
  "getRedeemTx",
  "depositFxSave",
  "withdrawFxSave",
] as const;

test("the client exposes exactly the 15 official fx-sdk capabilities", () => {
  assert.deepEqual([...OFFICIAL_FX_METHODS], [...EXPECTED_METHODS]);
  assert.equal(new Set(OFFICIAL_FX_METHODS).size, EXPECTED_METHODS.length);
});

test("the checked-in scope lock agrees with the runtime capability contract", () => {
  const lock = JSON.parse(readFileSync(SCOPE_FILE, "utf8")) as {
    sdkPackage: string;
    sdkCommit: string;
    methods: string[];
  };
  assert.equal(lock.sdkPackage, "@aladdindao/fx-sdk@1.0.5");
  assert.equal(lock.sdkCommit, "53c0b9805a169e75ad375c92c241e1292b66405f");
  assert.deepEqual([...lock.methods].sort(), [...EXPECTED_METHODS].sort());
});

for (const bundle of ['index.js', 'index.cjs']) {
  test(`scope rejects a stale installed ${bundle} fxSAVE floor before later gates`, () => {
    const root = resolve(HERE, '../../..');
    // Copy only public manifests, verifier code and SDK distribution files.
    // The installed dependency is read-only; the stale file is a disposable fixture.
    const parent = join(root, 'output', 'scope-contract');
    mkdirSync(parent, { recursive: true });
    const fixture = mkdtempSync(join(parent, 'sdk-'));
    try {
      const files = ['fx-scope.lock.json', 'apps/mini-app/package.json',
        'scripts/verify_fx_scope.mjs', 'scripts/verify_miniapp_scope.mjs', 'scripts/verify_architecture.mjs',
        ...['index.js', 'index.cjs', 'index.d.ts'].map(name => `apps/mini-app/node_modules/@aladdindao/fx-sdk/dist/${name}`)];
      for (const relative of files) {
        const destination = join(fixture, relative);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(root, relative), destination);
      }
      const installed = join(fixture, 'apps/mini-app/node_modules/@aladdindao/fx-sdk/dist', bundle);
      const current = 'const minShares = (basePoolSharesOut * BigInt(100000000 - tolerance) + 99999999n) / 100000000n;';
      const stale = 'const minShares = indexRes > 0n ? basePoolSharesOut * 10n ** 18n * 9996n / indexRes / 10000n : basePoolSharesOut;';
      const source = readFileSync(installed, 'utf8');
      assert.ok(source.includes(current), 'the verified installed SDK is the fixture baseline');
      writeFileSync(installed, source.replace(current, stale));
      const result = spawnSync(process.execPath, [join(fixture, 'scripts/verify_fx_scope.mjs')], {
        cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 30_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(`installed SDK ${bundle} is missing the selected-slippage fxSAVE deposit floor`), result.stderr);
      assert.match(result.stderr, /pnpm install --frozen-lockfile/);
    } finally {
      assert.equal(dirname(fixture), parent);
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
