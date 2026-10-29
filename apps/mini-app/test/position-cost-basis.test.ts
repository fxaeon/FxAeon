import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INDEX_MATCH_TOLERANCE,
  averagePriceWad,
  formatCostBasisPrice,
  formatPnlPercent,
  formatPositionPnl,
  indexMatchesChain,
  indexedOrderPrice,
  orderDeltaScale,
  parseLeverageWad,
  positionEntryPrice,
  positionPnl,
  sortIndexedOrders,
  type CostBasisMarket,
  type CostBasisSide,
  type IndexedOrder,
} from '../src/lib/positionCostBasis';

const E18 = 10n ** 18n;
/** A decimal as 1e18 fixed point. */
const wad = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  return sign * (BigInt(whole.replace('-', '')) * E18 + BigInt(fraction.padEnd(18, '0')));
};

let sequence = 0;
function order(type: string, fields: Partial<IndexedOrder> = {}): IndexedOrder {
  sequence += 1;
  return {
    id: `1_${String(sequence).padStart(6, '0')}`, type, blockNumber: BigInt(sequence), logIndex: 1,
    deltaColls: 0n, deltaDebts: 0n, positionColls: 0n, positionDebts: 0n, oldPositionColls: null,
    execPrice: 0n, price: 0n, priceRate: E18, protocolFees: null, ...fields,
  };
}

const entry = (market: CostBasisMarket, side: CostBasisSide, orders: IndexedOrder[]) => positionEntryPrice({ market, side, orders });
const dollars = (value: bigint | null) => value === null ? null : Number(value) / 1e18;

test('a long’s entry is what its collateral cost per stETH: each wstETH added at its swap price', () => {
  // 1 wstETH at 3,000 fxUSD per wstETH enters as 1.2 stETH: 2,500 per stETH.
  const open = order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [open]), wad('2500'));
  // Adding 0.5 wstETH at 3,600: (1.2 × 2,500 + 0.5 × 3,600) / 1.8.
  const add = order('Add', { deltaColls: wad('0.5'), positionColls: wad('1.8'), execPrice: wad('3600'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [open, add]), wad('4800') * E18 / wad('1.8'));
  // The order's own price reads per stETH: execPrice / priceRate.
  assert.equal(indexedOrderPrice(add, 'long'), wad('3000'));
});

test('reductions, rebalancing, liquidation, withdrawals and debt payments keep the entry', () => {
  const open = order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  const reduce = order('Reduce', { deltaColls: wad('-0.25'), positionColls: wad('0.9'), execPrice: wad('3300'), priceRate: wad('1.2') });
  const kept = [open, reduce,
    order('TickMovement', { positionColls: wad('0.85'), priceRate: wad('1.2') }),
    order('Liquidate', { positionColls: wad('0.8'), priceRate: wad('1.2') }),
    order('Withdraw', { deltaColls: wad('-0.05'), positionColls: wad('0.75'), priceRate: wad('1.2') }),
    // fxUSD repaid or minted moves debt, not the price paid for collateral.
    order('Repay', { deltaDebts: wad('-500'), positionColls: wad('0.75'), priceRate: wad('1.2') }),
    order('Mint', { deltaDebts: wad('800'), positionColls: wad('0.75'), priceRate: wad('1.2') }),
    order('WithdrawRepay', { deltaColls: wad('-0.15'), positionColls: wad('0.6'), priceRate: wad('1.2') }),
    order('DebtIndexChanged', { positionColls: wad('0.6'), priceRate: wad('1.2') }),
  ];
  assert.equal(entry('ETH', 'long', kept), wad('2500'));
  // The next add averages with what is left: (0.6 × 2,500 + 0.5 × 3,000) / 1.2.
  const add = order('Add', { deltaColls: wad('0.5'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [...kept, add]), wad('2500'));
  const cheaper = order('Add', { deltaColls: wad('0.5'), positionColls: wad('1.2'), execPrice: wad('2400'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [...kept, cheaper]), wad('2250'));
});

test('funding raises a long’s entry by the collateral it took, priced at that event', () => {
  const open = order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  // 0.012 stETH taken at an oracle price of 2,400: (1.188 × 2,500 + 0.012 × 2,400) / 1.188.
  const funding = order('CollIndexChanged', { oldPositionColls: wad('1.2'), positionColls: wad('1.188'), price: wad('2400'), priceRate: wad('1.2') });
  const raised = entry('ETH', 'long', [open, funding])!;
  assert.equal(raised, (wad('1.188') * wad('2500') / E18 + wad('0.012') * wad('2400') / E18) * E18 / wad('1.188'));
  assert.ok(raised > wad('2524') && raised < wad('2525'));
  // A snapshot that took nothing changes nothing.
  assert.equal(entry('ETH', 'long', [open, order('CollIndexChanged', { oldPositionColls: wad('1.2'), positionColls: wad('1.2'), price: wad('2400'), priceRate: wad('1.2') })]), wad('2500'));
  // Snapshots before anything opened set no entry.
  assert.equal(entry('ETH', 'long', [order('CollIndexChanged', { oldPositionColls: wad('1'), positionColls: wad('0.9'), price: wad('2400'), priceRate: wad('1.2') })]), null);
});

test('without a swap, an order is priced at the pool oracle', () => {
  // A deposit (execPrice 0) enters at the oracle's USD per stETH: price × rate per wstETH.
  const deposit = order('DepositMint', { deltaColls: wad('11'), positionColls: wad('13.408072131548516234'), price: wad('3479.626044819716679567'), priceRate: wad('1.218915648322592385') });
  const value = dollars(entry('ETH', 'long', [deposit]))!;
  assert.ok(Math.abs(value - 3479.626044819716) < 1e-6, String(value));
  // A short's inverse oracle quotes wstETH per dollar: 1 / (price × rate) per stETH.
  const tick = order('TickMovement', { price: 339_147_387_887_634n, priceRate: 1_246_620_093_818_911_326n });
  const perStEth = dollars(indexedOrderPrice(tick, 'short'))!;
  assert.ok(Math.abs(perStEth - 1e36 / (339_147_387_887_634 * Number('1.246620093818911326')) / 1e18) < 1e-6, String(perStEth));
});

test('a short’s entry is weighted by its debt in stETH', () => {
  // 0.5 wstETH borrowed at 3,600 fxUSD per wstETH is 0.6 stETH of debt at 3,000 per stETH.
  const open = order('Open', { deltaDebts: wad('0.5'), positionDebts: wad('0.5'), execPrice: wad('3600'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'short', [open]), wad('3000'));
  const add = order('Add', { deltaDebts: wad('0.25'), positionDebts: wad('0.75'), execPrice: wad('3000'), priceRate: wad('1.2') });
  // (0.6 × 3,000 + 0.25 × 3,000) / 0.9.
  assert.equal(entry('ETH', 'short', [open, add]), wad('2550') * E18 / wad('0.9'));
  // A rebalance or reduction keeps it, and the next add averages with the remaining debt.
  const tick = order('TickMovement', { positionDebts: wad('0.5'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'short', [open, add, tick]), wad('2550') * E18 / wad('0.9'));
});

test('BTC orders move WBTC in its 8 decimals while the position counts 18', () => {
  assert.equal(orderDeltaScale('BTC'), 10n ** 8n);
  assert.equal(orderDeltaScale('ETH'), E18);
  // BTC short #110: 0.00613099 WBTC borrowed at 81,556.85 fxUSD per WBTC.
  const execPrice = 81_556_851_720_889_583_199_287n;
  const open = order('Open', { deltaDebts: 613_099n, positionDebts: 6_130_990_000_000_000n, execPrice });
  const shortEntry = entry('BTC', 'short', [open])!;
  // Whole-wei division leaves it a hair under the swap price, within 1e-15.
  assert.ok(shortEntry <= execPrice && (execPrice - shortEntry) * 10n ** 15n < execPrice, String(shortEntry));
  // BTC long #817: 3.13894453 WBTC at 74,735.29.
  const long = order('Open', { deltaColls: 313_894_453n, positionColls: 3_138_944_529_999_999_999n, execPrice: 74_735_294_287_041_033_804_534n });
  assert.ok(Math.abs(dollars(entry('BTC', 'long', [long]))! - 74_735.294287) < 1e-3);
});

test('a close starts over, and a reopened position is priced only by its new orders', () => {
  const first = order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  const close = order('Close', { deltaColls: wad('-1'), positionColls: 0n, execPrice: wad('3300'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [first, close]), null);
  const again = order('Open', { deltaColls: wad('2'), positionColls: wad('2.4'), execPrice: wad('2400'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [first, close, again]), wad('2000'));
});

test('orders apply by block, then from the last log: an index snapshot follows the operation it reports', () => {
  // The index records a same-transaction collateral snapshot at a lower log
  // index, already holding the operation's result.
  const open = order('Open', { blockNumber: 10n, logIndex: 5, deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  const add = order('DepositMint', { blockNumber: 20n, logIndex: 222, deltaColls: wad('0.5'), positionColls: wad('1.8'), price: wad('3000'), priceRate: wad('1.2') });
  const snapshot = order('CollIndexChanged', { blockNumber: 20n, logIndex: 217, oldPositionColls: wad('1.8'), positionColls: wad('1.8'), price: wad('3000'), priceRate: wad('1.2') });
  assert.deepEqual(sortIndexedOrders([snapshot, add, open]).map((item) => item.type), ['Open', 'DepositMint', 'CollIndexChanged']);
  // (1.2 × 2,500 + 0.5 × 3,600) / 1.8, whatever order the index returned them in.
  assert.equal(entry('ETH', 'long', [snapshot, add, open]), wad('4800') * E18 / wad('1.8'));
});

test('an order of an unknown kind, or one without the price or amount it needs, gives no entry', () => {
  const open = order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') });
  assert.equal(entry('ETH', 'long', [open, order('Redeem', { positionColls: wad('1.1'), priceRate: wad('1.2') })]), null);
  assert.equal(entry('ETH', 'long', [order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), priceRate: wad('1.2') })]), null, 'no swap and no oracle price');
  assert.equal(entry('ETH', 'long', [order('Open', { deltaColls: wad('1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: 0n })]), null);
  assert.equal(entry('ETH', 'long', [order('Add', { deltaColls: wad('-1'), positionColls: wad('1.2'), execPrice: wad('3000'), priceRate: wad('1.2') })]), null);
  assert.equal(entry('ETH', 'long', []), null);
});

/**
 * The official f(x) app's order mapping and PnL hook (fx.aladdin.club bundles,
 * 29 October 2026), ported line for line in floating point as an independent
 * check. It moves a long's cost by the fxUSD of Repay and Mint orders, which
 * FxAeon does not; these fixtures have none.
 */
function officialEntry(orders: IndexedOrder[], market: CostBasisMarket, side: CostBasisSide): number {
  const precision = market === 'ETH' ? 1e18 : 1e8;
  const short = side === 'short';
  let cost = 0; let price = 0; let held = 0;
  for (const item of sortIndexedOrders(orders)) {
    if (item.type === 'DebtIndexChanged') continue;
    const [colls, old, oracle, rate, exec] = [item.positionColls, item.oldPositionColls ?? 0n, item.price, item.priceRate, item.execPrice].map(Number);
    const h = short ? 1e18 / oracle / rate * 1e36 : oracle;
    const m = exec === 0 ? h * rate / 1e18 : exec;
    const orderPrice = m / rate * 1e18;
    if (short) {
      const debts = Number(item.positionDebts) * rate / 1e18;
      if (item.type === 'Close') { cost = 0; price = 0; } else if (['Reduce', 'TickMovement', 'Rebalance', 'Liquidate', 'CollIndexChanged', 'Repay'].includes(item.type)) held = debts;
      else { cost = held * price + Number(item.deltaDebts) / precision * orderPrice * rate / 1e18; price = cost / debts; held = debts; }
    } else if (item.type === 'Close') { cost = 0; price = 0; }
    else if (['Reduce', 'TickMovement', 'Rebalance', 'Liquidate', 'CollIndexChanged', 'Withdraw', 'WithdrawRepay'].includes(item.type)) {
      held = colls;
      if (item.type === 'CollIndexChanged') { cost = held * price - (colls - old) * orderPrice / 1e18; price = cost / held; }
    } else { cost = held * price + Number(item.deltaColls) / precision * 1e18 * m / 1e18; price = cost / colls; held = colls; }
  }
  return price;
}

/** Real indexed orders (October 2026): type block logIndex deltaColls deltaDebts positionColls positionDebts oldPositionColls execPrice price priceRate. */
const REAL = {
  // Two swap-less early orders, funding snapshots with real collateral changes, rebalances, a liquidation.
  'ETH long #22': ['ETH', 'long', [
    'Open 21541451 272 1561024381035536576 2880593726908527915416 1856861764312596929 2880593726908527915416  0 3457454253251725287975 1189514902439134704',
    'Add 21541458 373 843596283004725575 1573219688329165207500 2860332114588979741 4453813415237693122916  0 3457454253251725287975 1189514902439134704',
    'Add 21619507 331 632740708430012296 2381457015215390634788 3613643002782989146 6835270430453083757704  3759953368739709825237 3140476080294122659034 1190552272293593742',
    'Add 21648070 154 1250491524544623314 5196373739007711910398 5102892714671974563 12031644169460795668102  4151309515799488339047 3468302862190135393396 1190931471871676894',
    'Add 21720555 553 1280406005563026064 4239199970434625323545 6629088977187097331 16270844139895420991647  3843528539316715537588 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21725887 447   6629058369468057497 16270844139895420991647 6629088977187097331 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21725891 378   6629026782447852126 16270844139895420991647 6629058369468057497 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21725895 311   6628994216140336785 16270844139895420991647 6629026782447852126 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21725900 134   6628960425701548962 16270844139895420991647 6628994216140336785 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21725926 396   6628920341755855269 16270844139895420991647 6628960425701548962 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21726353 100   6628815834054230909 16270844139895420991647 6628920341755855269 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21741214 21   6628601544252509979 16270844139895420991647 6628815834054230909 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21744679 175   6628465729914245138 16270844139895420991647 6628601544252509979 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21751857 506   6628304118411636939 16270844139895420991647 6628465729914245138 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21753776 243   6627860189050442659 16270844139895420991647 6628304118411636939 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21755228 236   6627524039321479662 16270844139895420991647 6627860189050442659 0 3197219885912819865251 1191962749225013727',
    'CollIndexChanged 21755249 302   6627519204536353114 16270844139895420991647 6627524039321479662 0 3197219885912819865251 1191962749225013727',
    'TickMovement 21762103 227   6617794797005574185 16244395042582166051735 6627519204536353114 0 3197219885912819865251 1192516979486748397',
    'TickMovement 21762107 259   6607775489621775862 16217133084591274366192 6607775489621775862 0 3197219885912819865251 1192516979486748397',
    'TickMovement 21762107 235   6607775489621775862 16217133084591274366192 6617794797005574185 0 3197219885912819865251 1192516979486748397',
    'TickMovement 21762488 524   6517890202268069800 15973932728742654345632 6607775489621775862 0 3197219885912819865251 1192516979486748397',
    'TickMovement 21762490 431   6364009026557574398 15556900394059870186510 6517890202268069800 0 3197219885912819865251 1192516979486748397',
    'Liquidate 21762850 511   0 0 6364009026557574398 0 2493864415684004828073 1192516979486748397',
    'DebtIndexChanged 21762850 507   6364009026557574398 15557008306079799489172 6364009026557574398 0 3197219885912819865251 1192516979486748397',
  ]],
  'ETH short #175': ['ETH', 'short', [
    'Open 26220426 172 1821609062101139818771 529760796225153774 1821609062101139818771 529760796225153774  2956246094246095493796 337951604281012 1246620093818911326',
    'Add 26221336 146 149209691710337655047 50869250225113100 1970818753811477473818 580630046450266874  2942026215271297448124 339147387887634 1246620093818911326',
    'TickMovement 26234330 1120   1813914971270986277472 530861553330305326 1970818753811477473818 0 339147387887634 1246771858911220488',
    'TickMovement 26240809 885   1804995638563794283746 528033087286100391 1813914971270986277472 0 339147387887634 1246771858911220488',
    'TickMovement 26241140 509   1765410344218158784427 515503029928098052 1804995638563794283746 0 339147387887634 1246848066199715680',
    'TickMovement 26242232 810   1399666099973409809122 401007753370873232 1451906700734197508951 0 339147387887634 1246848066199715680',
  ]],
  'BTC short #77': ['BTC', 'short', [
    'Open 24743411 737 16933378163635716052036 18674908 16933378163635716052036 186749080000000000  68191329284046642572429 14620656254664 1000000000000000000',
    'Add 24786733 189 1526971412855512653215 1693998 18460349576491228705251 203689060000000000  67982881794258512887028 14679711163064 1000000000000000000',
    'Add 24821984 240 971654323014015894038 1039677 19432003899505244599289 214085830000000000  69693282800138221126946 14294012686197 1000000000000000000',
    'Add 24874597 294 1286245124316013287535 1339400 20718249023821257886824 227479830000000000  73926213530924980421308 13473871540762 1000000000000000000',
    'Add 24959160 273 299017410344596228666 194543 21017266434165854115490 229425260000000000  77060014735118200088926 12949726605000 1000000000000000000',
    'Add 24968399 1141 498821873216830592081 316879 21516088307382684707571 232594050000000000  78955194007584449605054 12627358457457 1000000000000000000',
    'Add 25023457 149 576406874267658801679 361406 22092495181650343509250 236208110000000000  79988533539566756228175 12473069501425 1000000000000000000',
    'Add 25066729 412 157653821919959539392 97410 22250149003570303048642 237182210000000000  81141603867498203468843 12292510539124 1000000000000000000',
    'Add 25074359 194 497670889507208257333 305340 22747819893077511305975 240235610000000000  81618851934855243334970 12236844504667 1000000000000000000',
    'Reduce 25847645 1199 -4514824938414851115741 -5594792 18232994954662660190234 184287690000000000  80616225115543996356343 12394929156235 1000000000000000000',
    'Reduce 26070544 365 -9141487378368417792644 -10760086 9091507576294242397590 76686830000000000  84872424727646780656316 11820249289908 1000000000000000000',
  ]],
} as const;

function realOrders(rows: readonly string[]): IndexedOrder[] {
  return rows.map((row, index) => {
    const [type, block, log, deltaColls, deltaDebts, positionColls, positionDebts, oldPositionColls, execPrice, price, priceRate] = row.split(' ');
    return {
      id: `r_${String(index).padStart(4, '0')}`, type, blockNumber: BigInt(block), logIndex: Number(log),
      deltaColls: BigInt(deltaColls || '0'), deltaDebts: BigInt(deltaDebts || '0'), positionColls: BigInt(positionColls), positionDebts: BigInt(positionDebts),
      oldPositionColls: oldPositionColls ? BigInt(oldPositionColls) : null, execPrice: BigInt(execPrice), price: BigInt(price), priceRate: BigInt(priceRate), protocolFees: null,
    };
  });
}

test('real positions get the entry price the official f(x) app computes', () => {
  for (const [name, [market, side, rows]] of Object.entries(REAL)) {
    const orders = realOrders(rows);
    const ours = dollars(positionEntryPrice({ market, side, orders }));
    const official = officialEntry(orders, market, side);
    assert.ok(ours !== null && Number.isFinite(official) && official > 0, name);
    assert.ok(Math.abs(ours - official) / official < 1e-12, `${name}: ${ours} vs ${official}`);
  }
  // Funding raised ETH long #22's entry above what its five trades alone paid.
  const trades = realOrders(REAL['ETH long #22'][2]).filter((item) => item.type === 'Open' || item.type === 'Add');
  assert.ok(positionEntryPrice({ market: 'ETH', side: 'long', orders: realOrders(REAL['ETH long #22'][2]) })! > positionEntryPrice({ market: 'ETH', side: 'long', orders: trades })!);
});

test('figures are shown only once the index has caught up with the chain, within 1e10', () => {
  const index = { colls: wad('9.177'), debts: wad('12712.585') };
  assert.equal(indexMatchesChain(index, { rawColls: index.colls, rawDebts: index.debts }), true);
  assert.equal(indexMatchesChain(index, { rawColls: index.colls + INDEX_MATCH_TOLERANCE - 1n, rawDebts: index.debts - INDEX_MATCH_TOLERANCE + 1n }), true);
  assert.equal(indexMatchesChain(index, { rawColls: index.colls + INDEX_MATCH_TOLERANCE, rawDebts: index.debts }), false);
  assert.equal(indexMatchesChain(index, { rawColls: index.colls, rawDebts: index.debts - INDEX_MATCH_TOLERANCE }), false);
});

test('PnL is (P − entry) × side × size, and its percent applies the target leverage', () => {
  const long = { side: 'long' as const, entryWad: wad('2500'), rawColls: wad('2'), rawDebts: wad('3000'), rateWad: wad('1.2'), targetLeverageWad: wad('3') };
  assert.deepEqual(positionPnl({ ...long, priceWad: wad('2600') }), { usdCents: 20_000n, percentBps: 1_200n });
  assert.deepEqual(positionPnl({ ...long, priceWad: wad('2400') }), { usdCents: -20_000n, percentBps: -1_200n });
  // A short gains as the price falls, on its debt in stETH: 0.5 wstETH × 1.2.
  const short = { side: 'short' as const, entryWad: wad('3000'), rawColls: wad('2000'), rawDebts: wad('0.5'), rateWad: wad('1.2'), targetLeverageWad: wad('4') };
  assert.deepEqual(positionPnl({ ...short, priceWad: wad('2700') }), { usdCents: 18_000n, percentBps: 4_000n });
  assert.deepEqual(positionPnl({ ...short, priceWad: wad('3300') }), { usdCents: -18_000n, percentBps: -4_000n });
  // Half a cent rounds away from zero, either way.
  const cent = { side: 'long' as const, entryWad: E18, rawColls: E18, rawDebts: 0n, rateWad: E18, targetLeverageWad: null };
  assert.deepEqual(positionPnl({ ...cent, priceWad: wad('1.005') }), { usdCents: 1n, percentBps: null });
  assert.deepEqual(positionPnl({ ...cent, priceWad: wad('0.995') }), { usdCents: -1n, percentBps: null });
  for (const broken of [{ entryWad: 0n }, { priceWad: 0n }, { rateWad: 0n }, { rawColls: -1n }]) {
    assert.equal(positionPnl({ ...long, priceWad: wad('2600'), ...broken }), null, JSON.stringify(Object.keys(broken)));
  }
});

test('the SDK mid price, target leverage and figures parse and format exactly', () => {
  assert.equal(averagePriceWad(2n, 3n), 666_666_666_666_666_666n);
  assert.equal(averagePriceWad(0n, 3n), null);
  assert.equal(averagePriceWad(1n, 0n), null);
  assert.equal(parseLeverageWad('3.186444448365503225'), 3_186_444_448_365_503_225n);
  assert.equal(parseLeverageWad('2'), 2n * E18);
  for (const invalid of [null, undefined, '', '0', '0.0', '-1', '1e3', '3.1234567890123456789', '1234567.1']) assert.equal(parseLeverageWad(invalid), null, String(invalid));
  assert.equal(formatCostBasisPrice(2_361_238_500_000_000_000_000n, 'ETH'), '≈\u00a0$2,361.24 / stETH');
  assert.equal(formatCostBasisPrice(81_556_851_720_889_583_199_287n, 'BTC'), '≈\u00a0$81,556.85 / WBTC');
  assert.equal(formatPnlPercent(-573n), '−5.73%');
  assert.equal(formatPnlPercent(5n), '+0.05%');
  assert.equal(formatPnlPercent(0n), '0.00%');
  assert.equal(formatPnlPercent(123_456n), '+1,234.56%');
  assert.equal(formatPositionPnl({ usdCents: -45_297n, percentBps: -573n }), '≈\u00a0−$452.97 (−5.73%)');
  assert.equal(formatPositionPnl({ usdCents: 123_456_789n, percentBps: 1_200n }), '≈\u00a0+$1,234,567.89 (+12.00%)');
  assert.equal(formatPositionPnl({ usdCents: 0n, percentBps: null }), '≈\u00a0$0.00');
});
