import { parseAbi, parseAbiParameters } from 'viem';

/** Pinned SDK 1.0.5 contract/route facts; these are not a replacement planner. */
export const ETHEREUM = 1 as const;
export const ADDRESSES = Object.freeze({
  native: '0x0000000000000000000000000000000000000000',
  router: '0x33636d49fbefbe798e15e7f356e8dbef543cc708',
  converter: '0x12af4529129303d7fbd2563e242c4a2890525912',
  pool: '0x6ecfa38fee8a5277b91efda204c235814f0122e8',
  manager: '0x250893ca4ba5d05626c785e8da758026928fcd24',
  configuration: '0x16b334f2644cc00b85db1a1eff0c2c395e00c28d',
  oracle: '0x0c5c61025f047cb7e3e85852dc8eafd7b9a4abfb',
  wstEth: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
  fxUsd: '0x085780639cc2cacd35e474e71f4d000e2405d8f6',
} as const);

export const OPEN_ABI = parseAbi([
  'function openOrAddPositionFlashLoanV2((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 borrowAmount,bytes data) payable',
]);
export const CONVERTER_ABI = parseAbi([
  'function convert(address tokenIn,uint256 amount,uint256 encoding,uint256[] routes) payable returns (uint256 amountOut)',
  'function queryConvert(uint256 amount,uint256 encoding,uint256[] routes) returns (uint256 amountOut)',
]);
export const FLASH_DATA = parseAbiParameters('uint256 misc,uint256 debt,address converter,bytes conversion');
export const POOL_ABI = parseAbi([
  'function getDebtRatioRange() view returns (uint256 minimum,uint256 maximum)',
  'function getPosition(uint256 id) view returns (uint256 collateral,uint256 debt)',
  'function ownerOf(uint256 id) view returns (address)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
export const MANAGER_ABI = parseAbi([
  'function getPoolInfo(address pool) view returns (uint256 collateralCapacity,uint256 collateralBalance,uint256 rawCollateral,uint256 debtCapacity,uint256 debtBalance)',
  'function paused() view returns (bool)',
]);
export const FEE_ABI = parseAbi([
  'function getPoolFeeRatio(address pool,address recipient) view returns (uint256 supply,uint256 withdraw,uint256 borrow,uint256 repay)',
]);
export const ORACLE_ABI = parseAbi([
  'function getPrice() view returns (uint256 anchor,uint256 minimum,uint256 maximum)',
]);
export const WRAPPING_ABI = parseAbi(['function stEthPerToken() view returns (uint256)']);

// uint256 converter hints from the pinned SDK's WETH→wstETH and fxUSD→wstETH
// route registry. Native input is represented by zero in the convert call.
export const INPUT_ROUTE = Object.freeze([
  BigInt('0x2b9eae5948378e863978446d7aaac254c4b5ffa110a'),
  BigInt('0x1fce71607d656d4f172c66f42cfe369b24d78b2810a'),
]);
export const DEBT_ROUTE = Object.freeze([
  BigInt('0x254062fa20b733978fcbcec244eb8825ae6cfed87c0c'),
  BigInt('0x040007d2239a830b7749bfbad93c0e68b104a5bf2cfd590001'),
  BigInt('0x02b9eae5948378e863978446d7aaac254c4b5ffa110a'),
  BigInt('0x01fce71607d656d4f172c66f42cfe369b24d78b2810a'),
]);
export const INPUT_ENCODING = 1048575n + (2n << 20n);
export const DEBT_ENCODING = 1048575n + (4n << 20n);
export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const FEE_SCALE = 1_000_000_000n;
export const MAX_UINT = (1n << 256n) - 1n;
export const MIN_PRODUCT_LEVERAGE = 11_000;
export const MAX_PRODUCT_LEVERAGE = 50_000;
