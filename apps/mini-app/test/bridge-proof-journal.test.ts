import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import {
  clearPendingHashJournalForTests,
  readPendingBridgeDeliveryProof,
  readPendingHashJournal,
  recordPendingHash,
  updatePendingBridgeDeliveryProof,
  updatePendingHashRecord,
} from "../src/lib/fx/journal";
import { parsePendingBridgeDeliveryProof } from "../src/lib/fx/bridgeProof";
import { reconcileWalletJournal, selectRecoveryRecords } from "../src/lib/fx/recovery";
import type { FxPublicClient, PendingBridgeContext, PendingBridgeDeliveryProof } from "../src/lib/fx/types";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
const bridge: PendingBridgeContext = {
  destinationChainId: 8453,
  sourceOftAddress: "0x3333333333333333333333333333333333333333",
  destinationOftAddress: "0x4444444444444444444444444444444444444444",
  recipient: "0x5555555555555555555555555555555555555555",
  amountLD: "3127736306528800000000",
  minAmountLD: "3127736300000000000000",
  destinationBaselineBlock: "1000",
  bridgeToken: "fxUSD",
};
const identity = { walletAddress: wallet, chainId: 1 as const, hash, bridge };
const makeProof = (): PendingBridgeDeliveryProof => ({
  guid: `0x${"b".repeat(64)}`,
  sourceTxHash: hash,
  sourceAmountSentLD: "3127736300000000000000",
  sourceAmountReceivedLD: "3127736300000000000000",
  destinationTxHash: `0x${"c".repeat(64)}`,
  destinationAmountReceivedLD: "3127736300000000000000",
  destinationBlockNumber: "1010",
  destinationBlockHash: `0x${"d".repeat(64)}`,
  verifiedAt: Date.now(),
});

function addRecord(options: { confirmed?: boolean; stepKind?: "action" | "approval"; proof?: PendingBridgeDeliveryProof } = {}) {
  const record = recordPendingHash({
    operation: "buildBridgeTx",
    stepKind: options.stepKind ?? "action",
    walletAddress: wallet,
    chainId: 1,
    hash,
    to: bridge.sourceOftAddress,
    nonce: 1,
    data: "0x12345678",
    value: 100000000000000n,
    bridge: { ...bridge, ...(options.proof ? { deliveryProof: options.proof } : {}) },
  });
  if (options.confirmed !== false) updatePendingHashRecord(record, "confirmed");
  return readPendingHashJournal()[0];
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const values = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
} as Storage;

test.beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  clearPendingHashJournalForTests();
});
test.afterEach(() => {
  clearPendingHashJournalForTests();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

/** Drop module memory while retaining the JSON persisted by the prior page. */
function reload() {
  const persisted = new Map(values);
  clearPendingHashJournalForTests();
  for (const [key, value] of persisted) values.set(key, value);
}

test("canonical actual source and destination amounts survive a JSON reload without replacing the reviewed input", () => {
  addRecord();
  const proof = makeProof();
  assert.equal(updatePendingBridgeDeliveryProof(identity, proof), true);
  reload();
  assert.deepEqual(readPendingBridgeDeliveryProof(identity), proof);
  const record = readPendingHashJournal()[0];
  assert.equal(record.bridge?.amountLD, bridge.amountLD);
  assert.notEqual(record.bridge?.amountLD, record.bridge?.deliveryProof?.sourceAmountSentLD, "shared-decimal dust is not a debit");
  assert.equal(record.status, "confirmed", "status remains source receipt status, never destination success");
  assert.deepEqual(selectRecoveryRecords([record], wallet, 0), [record], "stored destination evidence never ages bridge verification out of recovery");
});

test("legacy source-confirmed records stay recoverable with no invented proof or received amount", () => {
  addRecord();
  reload();
  assert.equal(readPendingHashJournal().length, 1);
  assert.equal(readPendingBridgeDeliveryProof(identity), undefined);
  assert.equal(readPendingHashJournal()[0].bridge?.deliveryProof, undefined);
});

test("a later source revert removes cached delivery evidence before and after reload", () => {
  const record = addRecord();
  assert.equal(updatePendingBridgeDeliveryProof(identity, makeProof()), true);
  updatePendingHashRecord(record, "failed");
  assert.equal(readPendingHashJournal()[0].bridge?.deliveryProof, undefined);
  reload();
  assert.equal(readPendingHashJournal()[0].status, "failed");
  assert.equal(readPendingHashJournal()[0].bridge?.deliveryProof, undefined);
  assert.equal(readPendingBridgeDeliveryProof(identity), undefined);
});

test("proof cannot be attached to pending source, approval, failed source, or new submission", () => {
  let record = addRecord({ confirmed: false, proof: makeProof() });
  assert.equal(record.bridge?.deliveryProof, undefined);
  assert.equal(updatePendingBridgeDeliveryProof(identity, makeProof()), false);
  updatePendingHashRecord(record, "failed");
  assert.equal(updatePendingBridgeDeliveryProof(identity, makeProof()), false);
  clearPendingHashJournalForTests();
  record = addRecord({ stepKind: "approval" });
  assert.equal(updatePendingBridgeDeliveryProof(identity, makeProof()), false);
  assert.equal(record.bridge?.deliveryProof, undefined);
});

test("proof writes require the exact wallet, source hash, source chain, and immutable bridge context", () => {
  addRecord();
  const variations = [
    { ...identity, walletAddress: bridge.recipient },
    { ...identity, hash: `0x${"e".repeat(64)}` },
    { ...identity, chainId: 8453 as const },
    { ...identity, bridge: { ...bridge, recipient: wallet } },
    { ...identity, bridge: { ...bridge, amountLD: "9999999999999999999999" } },
    { ...identity, bridge: { ...bridge, destinationBaselineBlock: "999" } },
    { ...identity, bridge: { ...bridge, destinationOftAddress: wallet } },
    { ...identity, bridge: { ...bridge, bridgeToken: "fxSAVE" } },
  ];
  for (const wrong of variations) assert.equal(updatePendingBridgeDeliveryProof(wrong, makeProof()), false);
  assert.equal(readPendingBridgeDeliveryProof(identity), undefined);
});

test("malformed cached evidence is removed without dropping the original source recovery entry", () => {
  const record = addRecord();
  const malformed = [
    null, {},
    { ...makeProof(), guid: `0x${"0".repeat(64)}` },
    { ...makeProof(), sourceTxHash: `0x${"e".repeat(64)}` },
    { ...makeProof(), destinationTxHash: "not-a-hash" },
    { ...makeProof(), sourceAmountSentLD: bridge.amountLD + "0" },
    { ...makeProof(), sourceAmountSentLD: "0" },
    { ...makeProof(), sourceAmountReceivedLD: "1", destinationAmountReceivedLD: "1" },
    { ...makeProof(), destinationAmountReceivedLD: "1" },
    { ...makeProof(), destinationAmountReceivedLD: "03127736300000000000000" },
    { ...makeProof(), destinationBlockNumber: "999" },
    { ...makeProof(), destinationBlockHash: `0x${"0".repeat(64)}` },
    { ...makeProof(), verifiedAt: Date.now() + 60_000 },
    { ...makeProof(), verifiedAt: record.submittedAt - 1 },
    { ...makeProof(), sourceAmountSentLD: "9".repeat(100_000) },
  ];
  for (const proof of malformed) {
    clearPendingHashJournalForTests();
    localStorage.setItem("fxaeon:pending-hashes:v4", JSON.stringify([{ ...record, bridge: { ...bridge, deliveryProof: proof } }]));
    const read = readPendingHashJournal();
    assert.equal(read.length, 1);
    assert.equal(read[0].hash, hash);
    assert.equal(read[0].bridge?.deliveryProof, undefined);
  }
});

test("well-formed cached delivery cannot make a reloaded source receipt outage look confirmed", async () => {
  addRecord();
  assert.equal(updatePendingBridgeDeliveryProof(identity, makeProof()), true);
  reload();
  const [view] = await reconcileWalletJournal({
    walletAddress: wallet,
    getClient: () => ({
      getChainId: async () => 1,
      getTransactionReceipt: async () => { throw new Error("RPC unavailable"); },
    }) as unknown as FxPublicClient,
  });
  assert.equal(view.status, "pending");
  assert.equal(view.verification, "rpc-error");
  assert.equal(view.receiptTransfers, undefined);
});

test("proof parser keeps event-derived debit and receive values distinct and strips unknown metadata", () => {
  const proof = { ...makeProof(), sourceAmountSentLD: bridge.amountLD, quotedUsd: "3127.74" };
  const parsed = parsePendingBridgeDeliveryProof(proof, { hash, bridge, submittedAt: proof.verifiedAt });
  assert.ok(parsed);
  assert.notEqual(parsed.sourceAmountSentLD, parsed.destinationAmountReceivedLD);
  assert.equal("quotedUsd" in parsed, false);
});
