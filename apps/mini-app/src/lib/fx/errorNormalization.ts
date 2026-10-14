import { decodeErrorResult, type Hex } from "viem";
import { userSafeError } from "../errors";
import type { OfficialFxMethod } from "./types";

const BORROW_PROTOCOL_ERROR_ABI = [
  { type: "error", name: "ErrorDebtRatioTooSmall", inputs: [] },
  { type: "error", name: "ErrorDebtRatioTooLarge", inputs: [] },
] as const;

const ERROR_NESTING_KEYS = ["cause", "error", "originalError"] as const;
const ERROR_DATA_KEYS = ["data", "raw"] as const;
const MAX_ERROR_DEPTH = 8;

type DebtRatioContext = "borrow" | "leverage" | "position";

function debtRatioContext(operation?: OfficialFxMethod): DebtRatioContext {
  if (operation === "depositAndMint") return "borrow";
  if (operation === "increasePosition" || operation === "adjustPositionLeverage") return "leverage";
  return "position";
}

function isErrorData(value: unknown): value is Hex {
  return typeof value === "string"
    && /^0x(?:[0-9a-f]{2})+$/i.test(value)
    && value.length >= 10;
}

function debtRatioErrorMessage(data: Hex, context: DebtRatioContext): string | undefined {
  try {
    const decoded = decodeErrorResult({ abi: BORROW_PROTOCOL_ERROR_ABI, data });
    if (decoded.errorName === "ErrorDebtRatioTooSmall") {
      if (context === "borrow") return "Borrow amount is too low for this collateral.";
      if (context === "leverage") return "Increase leverage to meet the minimum debt ratio.";
      return "Debt is below the allowed range for this collateral.";
    }
    if (decoded.errorName === "ErrorDebtRatioTooLarge") {
      if (context === "borrow") return "Reduce the borrow amount or add collateral.";
      if (context === "leverage") return "Lower leverage or add collateral.";
      return "Debt is above the allowed range for this collateral.";
    }
  } catch {
    // Unknown selectors remain on the normal safe-error path.
  }
  return undefined;
}

/**
 * Map verified protocol debt-ratio ABI errors and typed native-funds/RPC
 * failures. Structured errors retain actionable reasons without exposing
 * provider URLs or request bodies; raw text is never used as ABI evidence.
 */
export function normalizeFxProtocolError(
  cause: unknown,
  fallback: string,
  operation?: OfficialFxMethod,
): string {
  const context = debtRatioContext(operation);
  const pending: Array<{ value: unknown; depth: number }> = [{ value: cause, depth: 0 }];
  const visited = new Set<object>();

  while (pending.length) {
    const current = pending.shift()!;
    if (current.depth > MAX_ERROR_DEPTH || !current.value || typeof current.value !== "object") continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);

    const record = current.value as Record<string, unknown>;
    if (record.name === 'InsufficientFundsError') {
      return operation === 'buildBridgeTx'
        ? 'Not enough ETH on the source network to pay the bridge fee and transaction gas.'
        : 'Not enough ETH to pay the transaction value and network fees.';
    }
    if (record.name === 'MethodNotFoundRpcError' || record.name === 'MethodNotSupportedRpcError'
      || record.code === -32601 || record.code === -32004) {
      return /simulat/i.test(fallback)
        ? 'The RPC provider does not support transaction simulation. Try again later.'
        : 'The RPC provider does not support this request. Try again later.';
    }
    if (record.name === 'TimeoutError' || record.name === 'AbortError') {
      return 'The request timed out or was interrupted. Try again.';
    }
    for (const key of ERROR_DATA_KEYS) {
      const data = record[key];
      if (isErrorData(data)) {
        const mapped = debtRatioErrorMessage(data, context);
        if (mapped) return mapped;
      } else if (data && typeof data === "object") {
        pending.push({ value: data, depth: current.depth + 1 });
      }
    }
    for (const key of ERROR_NESTING_KEYS) {
      const nested = record[key];
      if (nested && typeof nested === "object") {
        pending.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }

  return userSafeError(cause, fallback);
}
