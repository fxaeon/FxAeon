import assert from "node:assert/strict";
import { test } from "node:test";
import { tokens as sdkTokens } from "@aladdindao/fx-sdk";
import type { Address } from "viem";
import {
  planDepositAndMint,
  planIncreasePosition,
  planReducePosition,
  planRepayAndWithdraw,
} from "../src/lib/fx/service";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const ARBITRARY_TOKEN = "0x2222222222222222222222222222222222222222" as Address;

test("position planners reject arbitrary protocol tokens before calling the SDK", async () => {
  await assert.rejects(
    planIncreasePosition({
      market: "ETH",
      type: "long",
      positionId: 0,
      userAddress: WALLET,
      leverage: 2,
      inputTokenAddress: ARBITRARY_TOKEN,
      amount: 1n,
      slippage: 1,
    }),
    /not supported by the official SDK capability/,
  );
  await assert.rejects(
    planReducePosition({
      market: "BTC",
      type: "short",
      positionId: 1,
      userAddress: WALLET,
      outputTokenAddress: ARBITRARY_TOKEN,
      amount: 1n,
      slippage: 1,
      isClosePosition: false,
    }),
    /not supported by the official SDK capability/,
  );
});

test("ETH short rejects stETH input and output before attempting an unsupported SDK route", async () => {
  await assert.rejects(
    planIncreasePosition({
      market: "ETH",
      type: "short",
      positionId: 0,
      userAddress: WALLET,
      leverage: 2,
      inputTokenAddress: sdkTokens.stETH as Address,
      amount: 1n,
      slippage: 1,
    }),
    /position input token is not supported/,
  );
  await assert.rejects(
    planReducePosition({
      market: "ETH",
      type: "short",
      positionId: 1,
      userAddress: WALLET,
      outputTokenAddress: sdkTokens.stETH as Address,
      amount: 1n,
      slippage: 1,
      isClosePosition: false,
    }),
    /not supported by the official SDK capability/,
  );
});

test("long-pool collateral planners reject stablecoins and arbitrary addresses", async () => {
  await assert.rejects(
    planDepositAndMint({
      market: "ETH",
      positionId: 0,
      userAddress: WALLET,
      depositTokenAddress: sdkTokens.usdc as Address,
      depositAmount: 1n,
      mintAmount: 0n,
    }),
    /not supported by the official SDK capability/,
  );
  await assert.rejects(
    planRepayAndWithdraw({
      market: "BTC",
      positionId: 1,
      userAddress: WALLET,
      repayAmount: 0n,
      withdrawAmount: 1n,
      withdrawTokenAddress: ARBITRARY_TOKEN,
    }),
    /not supported by the official SDK capability/,
  );
});
