export type NavigationInputPage = 'trade' | 'earn' | 'borrow' | 'move';
export type NavigationInputs = Record<string, string | number | boolean>;
const enumValue = (...values: string[]) => (value: unknown) => typeof value === 'string' && values.includes(value);
const decimal = (value: unknown) => typeof value === 'string' && value.length <= 120 && /^(?:[0-9]*)(?:\.[0-9]*)?$/.test(value);
const addressInput = (value: unknown) => typeof value === 'string' && value.length <= 42 && /^(?:0x[0-9a-fA-F]*|)$/.test(value);
const boolean = (value: unknown) => typeof value === 'boolean';
const market = enumValue('ETH', 'BTC');
const token = enumValue('ETH', 'WETH', 'stETH', 'wstETH', 'WBTC', 'fxUSD', 'USDC', 'USDT');
const schemas: Record<NavigationInputPage, Record<string, (value: unknown) => boolean>> = {
  trade: { market, side: enumValue('long', 'short'), token, amount: decimal, leverage: value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000, slippage: decimal },
  earn: { mode: enumValue('deposit', 'withdraw'), token: enumValue('fxUSD', 'usdc', 'fxUSDBasePool'), amount: decimal, shares: decimal, instant: boolean, slippage: decimal },
  borrow: { mode: enumValue('mint', 'manage'), market, selectedKey: value => typeof value === 'string' && /^(?:new|(?:ETH|BTC):long:[0-9]+|)$/.test(value), token, deposit: decimal, mint: decimal, repay: decimal, withdraw: decimal, managementAction: enumValue('none', 'add', 'borrow', 'repay', 'withdraw', 'combined') },
  move: { direction: enumValue('ethereum_to_base', 'base_to_ethereum'), mode: enumValue('canonical', 'advanced'), token: enumValue('fxUSD', 'fxSAVE'), amount: decimal, sourceOft: addressInput, destinationOft: addressInput, approvalToken: addressInput, recipientInput: addressInput, customRecipient: boolean },
};

export function validateNavigationInputs(page: NavigationInputPage, input: unknown): input is NavigationInputs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const fields = Object.entries(input);
  const schema = schemas[page];
  return fields.length === Object.keys(schema).length && fields.every(([key, value]) => Object.hasOwn(schema, key) && schema[key](value));
}

/** Editable primitives only. A route, quote, calldata or signature cannot enter this cache. */
export function createNavigationInputMemory() {
  const values = new Map<string, NavigationInputs>();
  const key = (page: NavigationInputPage, identity: string) => page + ':' + identity.toLowerCase();
  return {
    read(page: NavigationInputPage, identity: string): NavigationInputs | null {
      const value = values.get(key(page, identity));
      return value && validateNavigationInputs(page, value) ? { ...value } : null;
    },
    save(page: NavigationInputPage, identity: string, value: unknown) {
      const id = key(page, identity);
      if (!validateNavigationInputs(page, value)) { values.delete(id); return; }
      values.delete(id);
      values.set(id, { ...value });
      while (values.size > 16) values.delete(values.keys().next().value!);
    },
    clear(page: NavigationInputPage, identity: string) { values.delete(key(page, identity)); },
  };
}
export const navigationInputMemory = createNavigationInputMemory();
