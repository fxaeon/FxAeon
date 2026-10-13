import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const harness = readFileSync(new URL("./run_anvil_tests.mjs", import.meta.url), "utf8");
const browserProof = readFileSync(new URL("../apps/mini-app/e2e/fork/positions.browser.ts", import.meta.url), "utf8");
const protocolProof = readFileSync(new URL("../apps/mini-app/test/anvil.integration.test.ts", import.meta.url), "utf8");
const earnProof = readFileSync(new URL("../apps/mini-app/test/earn.anvil.test.ts", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../apps/mini-app/next.config.js", import.meta.url), "utf8");
const staticServer = readFileSync(new URL("../apps/mini-app/e2e/serve.mjs", import.meta.url), "utf8");

test("fork harness enables deterministic idle blocks for strict finality", () => {
  assert.match(harness, /ANVIL_BLOCK_TIME \?\? "1"/);
  assert.match(harness, /"--block-time", String\(blockTime\)/);
  assert.match(harness, /ANVIL_BLOCK_TIME must be a positive number/);
});

test("manual funded preview is isolated from the hidden automation defaults", () => {
  assert.match(harness, /FX_FORK_PREVIEW_ANVIL_PORT \?\? "8548"/);
  assert.match(harness, /ANVIL_PORT \?\? "8547"/);
  assert.match(harness, /FX_FORK_PREVIEW_BROWSER_PORT \?\? "4326"/);
  assert.match(harness, /FX_FORK_BROWSER_PORT \?\? "4325"/);
  assert.match(harness, /dist-fork-preview-\$\{browserPort\}/);
  assert.match(harness, /previewMode\) \{/);
  assert.match(harness, /else if \(previewMode\)/);
  assert.match(nextConfig, /distDir: configuredDistDir/);
  assert.match(staticServer, /const DIST = join\(ROOT, DIST_DIR\)/);
  assert.match(browserProof, /headless: !previewMode/);
  assert.match(browserProof, /LOCAL FORK PREVIEW/);
  assert.match(browserProof, /transactions stay on 127\.0\.0\.1/);
  assert.match(browserProof, /browser\.once\('disconnected', \(\) => resolveDisconnected\(\)\)/);
  assert.match(browserProof, /page\.waitForEvent\('close', \{ timeout: 0 \}\)/);
  assert.match(browserProof, /submitted\.push\(\{ hash, to: tx\.to, data: tx\.data \?\? '0x'/);
  assert.match(browserProof, /const discoverPreviewCandidates = async/);
  assert.match(browserProof, /positionRouterEventMatchesRecipient\(event, log, receipt\.logs, account\)/);
  assert.match(browserProof, /owner\.toLowerCase\(\) === account\.toLowerCase\(\)/);
  assert.match(browserProof, /if \(!previewMode\) \{\s*heldReceipts\.set/);
  assert.match(browserProof, /if \(!previewMode\) await context\.tracing\.start/);
  assert.match(browserProof, /if \(!previewMode\) await context\.tracing\.stop/);
  assert.match(browserProof, /if \(previewMode\) return;/);
  assert.match(browserProof, /if \(!previewMode\) \{\s*let nextGroup = 0;/);
});

test("fork proofs validate the configured base through Anvil metadata", () => {
  for (const proof of [browserProof, protocolProof, earnProof]) {
    assert.match(proof, /anvil_metadata/);
    assert.match(proof, /forkedNetwork\?\.forkBlockNumber/);
    assert.match(proof, /forkHead >= forkBlock/);
    assert.doesNotMatch(proof, /assert\.equal\(forkHead,\s*BigInt\(process\.env\.ANVIL_FORK_BLOCK/);
  }
});

test("browser proof revalidates changed quotes before the first signature", () => {
  assert.match(browserProof, /for \(let attempt = 0; attempt < 3 && !firstSignatureObserved; attempt \+= 1\)/);
  assert.match(browserProof, /name: 'Review updated quote'/);
  assert.match(browserProof, /reviewedTransactions = await readReviewedTransactions\(\);/);
  assert.match(browserProof, /timed out waiting for the first signature or quote expiry/);
  assert.match(browserProof, /reviewed quote expired repeatedly before the first signature/);
  assert.match(browserProof, /firstSignatureObserved/);
  assert.match(browserProof, /driveDirectAction/);
  assert.match(browserProof, /readReviewedTransactions/);
  assert.match(browserProof, /read-only action details must never request a signature/);
  assert.match(browserProof, /read-only alternate session must never send/);
  assert.match(browserProof, /tx\.from\.toLowerCase\(\), wallet\.toLowerCase\(\)/);
  assert.match(browserProof, /target differs from action details/);
  assert.match(browserProof, /calldata differs from action details/);
  assert.match(browserProof, /actual signatures must match the reviewed transaction count/);
  assert.match(browserProof, /no later step may sign before this receipt is delivered/);
  assert.match(browserProof, /only the real submitted receipt may be delayed/);
  assert.match(browserProof, /await Promise\.all\(held\.map\(\(\{ hold \}\) => hold\.waiting\)\)/);
  assert.match(browserProof, /hold\.release\(\);/);
  assert.doesNotMatch(browserProof, /Quote updated—review again\./);
});

test("browser proof accepts honest partial-empty state only after exhaustive close proof", () => {
  const allClosed = browserProof.indexOf("assert.equal(closedPositions.length, scenarios.length");
  const partialState = browserProof.indexOf("const partialEmpty =", allClosed);
  assert.ok(allClosed >= 0 && partialState > allClosed, "partial-empty acceptance must follow every canonical close assertion");
  assert.match(browserProof, /normal ready-empty presentation/);
});
