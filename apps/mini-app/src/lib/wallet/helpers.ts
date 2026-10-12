export function asChainNumber(chainId: string | undefined): number | undefined {
  if (!chainId) return undefined;
  const value = chainId.startsWith('eip155:') ? chainId.slice(7) : chainId;
  const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function asHexQuantity(value: string | number | bigint | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (!/^0x[0-9a-f]+$/i.test(value) && !/^\d+$/.test(value)) {
      throw new Error('Transaction quantity is not a valid non-negative integer.');
    }
    const normalized = BigInt(value);
    return `0x${normalized.toString(16)}`;
  }
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Transaction quantity is not a valid non-negative integer.');
  }
  if (typeof value === 'bigint' && value < 0n) {
    throw new Error('Transaction quantity is not a valid non-negative integer.');
  }
  return `0x${BigInt(value).toString(16)}`;
}
