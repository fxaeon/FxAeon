import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Check, ExternalLink, Info, RefreshCw } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { freshDisplayPrices } from '../src/lib/displayPrices';
import { fxSaveShareUsdValue } from '../src/lib/fxSaveShareValue';
import { fxSaveUsdValue, fxSaveVaultUsdValue, normalizedFxSaveAssetsWei } from '../src/lib/fxSaveUnits';
import { claimAvailability } from '../src/lib/earnState';
import { selectWalletTasks } from '../src/lib/taskState';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { formatUsd, parseUsdPriceResponse, USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '../src/lib/prices';

// Resolve esbuild through the declared tsx dependency, including strict pnpm
// layouts, without adding a new application dependency for these tests.
const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
  transformSync: (input: string, options: Record<string, string>) => { code: string };
};

const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
after(() => { if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React'); });

// Execute the actual Earn display and transition functions with deterministic,
// wallet-free bindings. These tests neither query a chain nor sign a plan.
function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}
const page = source('../src/app/earn/page.tsx');
const pageText = page;
const css = source('../src/components/SavingsWorkspace.module.css');
const presentation = Object.fromEntries([...css.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
/** These source-level functions begin in column zero. Slice between top-level
 * declarations, then let the installed esbuild parser validate/compile TSX.
 * No extraction by a nested closing brace and no alternate implementation. */
function declaration(file: string, name: string) {
  const start = new RegExp(`^(?:export (?:default )?)?function ${name}\\(`, 'm').exec(file);
  assert.ok(start, `${name} exists`);
  const rest = file.slice(start.index);
  const next = /\n(?=(?:export (?:default )?)?(?:function|type|interface|const) )/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).replace(/^export (?:default )?/, '');
}
const earn = declaration(page, 'EarnPage');
function variable(name: string) {
  const start = earn.indexOf(`  const ${name} = `);
  assert.notEqual(start, -1, `${name} declaration exists`);
  const rest = earn.slice(start);
  const next = /\n {2}(?=const |useEffect\()/.exec(rest);
  assert.ok(next, `${name} has a following declaration boundary`);
  return rest.slice(0, next.index);
}
const MetricLabel = ({ label, definition, help }: { label: string; definition?: string; help?: string }) => React.createElement('span', null,
  label, (definition || help) && React.createElement('button', { type: 'button', 'aria-label': `About ${label}`, 'data-definition': definition, 'data-help': help }, 'i'));
const TokenIcon = ({ symbol }: { symbol: string }) => React.createElement('span', { 'data-token': symbol });
const ChainIcon = () => React.createElement('span', { 'data-chain': 'Ethereum' });
const MissingValue = ({ label, status }: { label: string; status: string }) => React.createElement('span', { 'aria-label': label, 'data-value-status': status });
const ValueOrSkeleton = ({ value }: { value: React.ReactNode }) => React.createElement(React.Fragment, null, value);
function evaluate<T>(code: string, bindings: object = {}): T {
  const js = transformSync(code, { target: 'es2020', loader: 'tsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', format: 'cjs' }).code;
  return runInNewContext(js, {
    React, Check, ExternalLink, Info, RefreshCw, MetricLabel, TokenIcon, ChainIcon, MissingValue, ValueOrSkeleton,
    freshDisplayPrices, fxSaveShareUsdValue, fxSaveUsdValue, fxSaveVaultUsdValue, normalizedFxSaveAssetsWei,
    claimAvailability, selectWalletTasks, formatUsd, formatUnits, presentation, styles: {}, ...bindings,
  }) as T;
}
const helpers = ['formatDisplayAmount', 'formatVaultUsd', 'formatTimestamp', 'formatRatio', 'formatCooldown'].map(name => declaration(page, name)).join('\n')
  + '\n' + declaration(source('../src/app/trade/fxUi.ts'), 'formatAmount');
const now = 1_780_000_000_000;
const quote = (overrides: Partial<UsdPriceSnapshot> = {}): UsdPriceSnapshot => ({ status: 'ready', prices: { fxSAVE: 1.12345 }, updatedAt: now, ...overrides });

test('per-share value uses the address-matched fxSAVE quote, not fxSP or fxUSD', () => {
  const coins = {
    [`ethereum:${FX_TOKENS.fxSAVE.address.toLowerCase()}`]: { price: 1.12345, confidence: 0.99, timestamp: now / 1000 },
    [`ethereum:${FX_TOKENS.fxUSDBasePool.address.toLowerCase()}`]: { price: 1.04, confidence: 0.99, timestamp: now / 1000 },
    [`ethereum:${FX_TOKENS.fxUSD.address.toLowerCase()}`]: { price: 0.998, confidence: 0.99, timestamp: now / 1000 },
  };
  const parsed = parseUsdPriceResponse({ coins }, now / 1000);
  assert.equal(fxSaveShareUsdValue({ status: 'ready', ...parsed }, now), 1.12345);
  delete (coins as Record<string, unknown>)[`ethereum:${FX_TOKENS.fxSAVE.address.toLowerCase()}`];
  const missing = parseUsdPriceResponse({ coins }, now / 1000);
  assert.equal(fxSaveShareUsdValue({ status: 'partial', ...missing }, now), null, 'other asset quotes cannot substitute for fxSAVE');
});

test('per-share values reject missing, invalid, stale, future and failed data', () => {
  for (const invalid of [0, -1, Number.NaN, Infinity, '1.12', null, undefined]) {
    assert.equal(fxSaveShareUsdValue(quote({ prices: { fxSAVE: invalid } as UsdPriceSnapshot['prices'] }), now), null);
  }
  for (const updatedAt of [null, 0, now - USD_PRICE_MAX_AGE_MS - 1, now + 30_001]) {
    assert.equal(fxSaveShareUsdValue(quote({ updatedAt }), now), null);
  }
  for (const status of ['stale', 'unavailable'] as const) assert.equal(fxSaveShareUsdValue(quote({ status }), now), null);
  assert.equal(fxSaveShareUsdValue(quote({ status: 'loading', prices: {} }), now), null);
  assert.equal(fxSaveShareUsdValue(quote({ prices: { fxUSD: 1, fxUSDBasePool: 1.25 } }), now), null);
});

test('per-asset validation time, not a fresher unrelated quote, controls fxSAVE freshness', () => {
  assert.equal(fxSaveShareUsdValue(quote({ updatedAts: { fxSAVE: now - USD_PRICE_MAX_AGE_MS - 1, fxUSD: now } }), now), null);
  assert.equal(fxSaveShareUsdValue(quote({ status: 'partial', updatedAt: now - USD_PRICE_MAX_AGE_MS - 1, updatedAts: { fxSAVE: now } }), now), 1.12345);
});

const pending = { hasPendingRedeem: true, pendingSharesWei: 50n * 10n ** 18n, isCooldownComplete: false, redeemableAt: 2_000 };
const ready = { ...pending, isCooldownComplete: true };
function summary({ claimable = ready as typeof ready | null, redeemStatus = pending, readWarnings = [] as string[], snapshot = quote({ updatedAt: Date.now() }), connected = true } = {}) {
  const data = connected ? { walletAddress: '0x1111111111111111111111111111111111111111',
    balance: { balanceWei: 1000n * 10n ** 18n, assetsWei: 1100n * 10n ** 18n }, claimable, redeemStatus } : null;
  const props = { data, connected, loading: false, onRefresh: async () => {}, readWarnings, config: null,
    fxSaveApy: null, fxSaveApyStatus: 'unavailable', onClaim: () => {}, claimTriggerRef: { current: null } };
  const before = structuredClone(data);
  const html = renderToStaticMarkup(evaluate<React.ReactNode>([
    helpers, declaration(page, 'ReadyClaimBanner'), declaration(source('../src/components/ProductUI.tsx'), 'StatusNotice'),
    declaration(page, 'SavingsSummary'), 'SavingsSummary(props);',
  ].join('\n'), { props, useUsdPrices: () => snapshot }));
  assert.deepEqual(data, before, 'summary rendering must not mutate a wallet/claim read');
  return html;
}

test('ready banner keeps one review action and drops only repetitive explanation', () => {
  const html = summary();
  assert.match(html, /class="readyClaim" role="status"/);
  assert.match(html, /Ready to claim/);
  assert.equal((html.match(/>Review claim<\/button>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Review the verified assets available|Withdrawal ready to claim|No payout yet/);
  assert.match(css, /\.readyClaim button \{[^}]*min-height: 44px/);
  assert.doesNotMatch(css, /\.readyClaim[^}]*height: 140px/);
});

test('pending, unavailable and fallback redemption reads never gain a ready action', () => {
  const waiting = summary({ claimable: pending });
  assert.match(waiting, /Withdrawal pending/);
  assert.match(waiting, /Available after/);
  assert.doesNotMatch(waiting, /class="readyClaim"|>Review claim</);
  const missing = summary({ claimable: null, redeemStatus: ready });
  assert.doesNotMatch(missing, /class="readyClaim"|>Review claim</);
  for (const warning of ['claim status', 'redemption status']) {
    const html = summary({ readWarnings: [warning] });
    assert.match(html, /Withdrawal status unavailable/);
    assert.match(html, /Refresh to check the current withdrawal status/);
    assert.doesNotMatch(html, /class="readyClaim"|>Review claim</);
  }
});

test('overview omits per-share row and retains connected vault holdings', () => {
  assert.doesNotMatch(summary(), /Value per fxSAVE/);
  assert.match(summary(), /Vault holdings/);
  assert.doesNotMatch(summary({ connected: false }), /Value per fxSAVE/);
  assert.match(summary({ connected: false }), /Vault holdings/);
});

function transitions(mode = 'withdraw', token = 'fxUSD') {
  const writes: Record<string, unknown> = {};
  const setters = Object.fromEntries(['Mode', 'Token', 'Amount', 'Shares', 'Instant', 'ReviewStage', 'ReviewRevision', 'ResumeReview'].map(key => [`set${key}`, (value: unknown) => { writes[key] = value; }]));
  const code = [variable('resetEarnContext'), variable('changeMode'), variable('changeToken'), '({ resetEarnContext, changeMode, changeToken });'].join('\n');
  const actions = evaluate<{ resetEarnContext: () => void; changeMode: (mode: string) => void; changeToken: (token: string) => void }>(code,
    { ...setters, useCallback: (callback: unknown) => callback, resetTransactionAmounts: () => ({ amount: '', shares: '' }), mode, token });
  return { writes, ...actions };
}

test('fresh withdrawal uses cooldown, but mode/token changes do not overwrite selected Instant', () => {
  const initial = /^ {2}const \[instant, setInstant\] = useState\([^;]+;/m.exec(earn);
  assert.ok(initial);
  assert.equal(evaluate<boolean>(`${initial[0]}\ninstant;`, { useState: (value: unknown) => [value, () => {}] }), false);
  const reset = transitions(); reset.resetEarnContext();
  assert.equal(reset.writes.Instant, false);
  for (const action of [(t: ReturnType<typeof transitions>) => t.changeMode('withdraw'), (t: ReturnType<typeof transitions>) => t.changeToken('usdc')]) {
    const t = transitions(); action(t);
    assert.equal(Object.hasOwn(t.writes, 'Instant'), false, 'an explicit method must survive tab/asset changes');
    if (t.writes.Mode) {
      assert.equal(t.writes.Amount, '');
      assert.equal(t.writes.Shares, '');
    } else {
      assert.equal(Object.hasOwn(t.writes, 'Shares'), false, 'receive-asset changes preserve fxSAVE input');
      assert.equal(t.writes.ReviewStage, 'input');
      assert.equal(t.writes.ResumeReview, 0);
    }
  }
});

test('same Earn asset is a no-op, while actual deposit input-unit changes reset amounts', () => {
  const unchanged = transitions(); unchanged.changeToken('fxUSD');
  assert.deepEqual(unchanged.writes, {});
  const changed = transitions('deposit'); changed.changeToken('usdc');
  assert.equal(changed.writes.Amount, ''); assert.equal(changed.writes.Shares, '');
  assert.equal(changed.writes.ReviewStage, 'input');
});

test('signature-required drafts preserve explicit method, amounts, token and slippage', () => {
  const marker = earn.indexOf('restoredDraftIdRef.current = draftId');
  assert.notEqual(marker, -1);
  const start = earn.lastIndexOf('  useEffect(() => {', marker);
  const end = earn.indexOf('\n  }, [', marker);
  assert.ok(start >= 0 && end > marker);
  const effect = earn.slice(start, earn.indexOf(');', end) + 2);
  for (const instant of [true, false]) {
    const writes: Record<string, unknown> = {};
    const state = { mode: 'withdraw', token: 'usdc', amount: '7.5', shares: '12.345', instant, slippage: '0.8' };
    const setters = Object.fromEntries(['Mode', 'Token', 'Amount', 'Shares', 'Instant', 'Slippage', 'ReviewStage', 'ReviewRevision', 'ResumeReview'].map(key => [`set${key}`, (value: unknown) => { writes[key] = value; }]));
    evaluate([declaration(page, 'isEarnMode'), declaration(page, 'isSaveToken'), effect].join('\n'), {
      ...setters, useEffect: (callback: () => void) => callback(), reviewStage: 'input', wallet: { address: '0x1111111111111111111111111111111111111111', chainId: 1 },
      signatureDraftIdFromSearch: () => 'draft-id', restoredDraftIdRef: { current: null }, restoreEarnDraft: () => state,
      window: { location: { search: '?fxDraft=draft-id', href: 'https://fxaeon.local/earn?fxDraft=draft-id' }, history: { state: null, replaceState() {} } }, URL,
    });
    for (const [name, value] of Object.entries(state)) assert.equal(writes[name[0].toUpperCase() + name.slice(1)], value);
  }
});

function editor(token: 'fxUSD' | 'fxUSDBasePool', instant: boolean, config: object | null) {
  const props = { mode: 'withdraw', token, instant, shares: '2', amount: '', config, estimateConfig: config, walletData: null,
    configLoading: false, onRetryConfig() {}, onTokenChange() {}, onAmountChange() {}, onSharesChange() {}, onWithdrawalMethodChange() {}, onDeposit() {}, balanceUnavailable: false };
  const ChoiceCards = ({ options }: { options: { value: string; label: string; description: string }[] }) => React.createElement('fieldset', null, options.map(option => React.createElement('label', { key: option.value }, option.label, ' ', option.description)));
  return renderToStaticMarkup(evaluate<React.ReactNode>([helpers, declaration(page, 'directFxSaveEstimate'), declaration(page, 'EstimateRow'), declaration(page, 'VaultTermsStatus'), declaration(page, 'EarnActionEditor'), 'EarnActionEditor(props);'].join('\n'), {
    props, ChoiceCards, AmountField: () => null, TokenSelect: () => null, labelToken: (key: string) => key === 'fxUSDBasePool' ? 'fxSP' : key,
    parseAmount: (value: string) => value ? parseUnits(value, 18) : null,
  }));
}
const config = { cooldownPeriodSeconds: 5400n, instantRedeemFeeRatio: 2n * 10n ** 16n, totalAssetsWei: 12n * 10n ** 18n, totalSupplyWei: 10n * 10n ** 18n };

test('Earn keeps deposit and withdrawal presets visible while preserving disconnected balance authority', () => {
  for (const mode of ['deposit', 'withdraw']) {
    const fields: Record<string, unknown>[] = [];
    const props = { mode, token: 'fxUSD', instant: false, shares: '', amount: '', config, estimateConfig: null, walletData: null,
      configLoading: false, onRetryConfig() {}, onTokenChange() {}, onAmountChange() {}, onSharesChange() {}, onWithdrawalMethodChange() {}, onDeposit() {}, balanceUnavailable: false };
    renderToStaticMarkup(evaluate<React.ReactNode>([helpers, declaration(page, 'directFxSaveEstimate'), declaration(page, 'EstimateRow'), declaration(page, 'VaultTermsStatus'), declaration(page, 'EarnActionEditor'), 'EarnActionEditor(props);'].join('\n'), {
      props, ChoiceCards: () => null, AmountField: (field: Record<string, unknown>) => { fields.push(field); return null; }, TokenSelect: () => null,
      labelToken: (key: string) => key, parseAmount: (value: string) => value ? parseUnits(value, 18) : null,
    }));
    assert.equal(fields.length, 1);
    assert.equal(fields[0].showShortcuts, true);
    assert.equal((fields[0].balanceState as { status: string }).status, 'disconnected');
    assert.equal(fields[0].value, '');
    assert.equal(fields[0].allowAll, mode === 'withdraw' ? true : undefined, 'withdrawal retains its exact whole-share sentinel');
    assert.equal(fields[0].maxAmount, undefined, 'visibility introduces no guessed spending maximum');
  }
});
test('withdrawal fees, configured cooldown, queued payout units and unknown terms stay visible', () => {
  const queued = editor('fxUSD', false, config);
  assert.match(queued, /90m/);
  assert.match(queued, /Instant/);
  assert.match(queued, /Claim assets/);
  assert.match(queued, /fxUSD \/ USDC/);
  assert.match(queued, /Network fees apply to the withdrawal request and claim/);
  const missing = editor('fxUSD', false, null);
  assert.match(missing, /Cooldown and fee unavailable/);
  assert.equal((missing.match(/unavailable/g) ?? []).length, 1, 'missing terms have one shared explanation');
  assert.match(missing, /aria-label="Retry vault terms"/);
  assert.doesNotMatch(missing, /24h|1% fee|0% fee/);
});

test('direct fxSP redemption keeps no-cooldown terms visible outside optional estimate help', () => {
  const html = editor('fxUSDBasePool', false, config);
  assert.match(html, /Estimated fxSP received/);
  assert.match(html, /≈ 2\.4 fxSP/);
  assert.match(html, /Direct redemption to fxSP has no cooldown or queued claim/);
  assert.match(html, /data-help="Based on current vault assets and share supply\."/);
  assert.doesNotMatch(html, /data-help="[^"]*no cooldown|24h|Instant 2% fee/);
});

test('direct withdrawal omits token-only receive fallback without an estimate', () => {
  const html = editor('fxUSDBasePool', false, null);
  assert.doesNotMatch(html, />Receive<|Estimated fxSP received/);
  assert.match(html, /Direct redemption to fxSP/);
});

test('risk and audit access stays outside collapsed help and makes no UI audit claim', () => {
  const html = renderToStaticMarkup(evaluate<React.ReactNode>(`${declaration(page, 'VaultRiskNotice')}\nVaultRiskNotice();`));
  assert.match(html, /aria-label="fxSAVE risks"/);
  assert.match(html, /aria-label="Protocol risk and audit resources"/);
  assert.match(html, /https:\/\/fxprotocol\.gitbook\.io\/fx-docs\/risk-management\/audit-reports/);
  assert.match(html, /https:\/\/fxprotocol\.gitbook\.io\/fx-docs\/f-x-protocol-mechanisms\/stability-pool/);
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details|100% audited|guaranteed/);
  assert.match(pageText, /<VaultRiskNotice \/>/);
});

test('optional help does not introduce signing authority, price-oracle derivation or local-clock readiness', () => {
  const helper = readFileSync(new URL('../src/lib/fxSaveShareValue.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /planWithdraw|planRedeem|balanceWei|totalSupplyWei|totalAssetsWei|tvlUsd|fetch\(/);
  const summarySource = declaration(page, 'SavingsSummary');
  assert.match(summarySource, /!claimUnavailable && claim.status === 'ready'/);
  assert.match(pageText, /definition="fxSaveApy"/);
  assert.doesNotMatch(pageText, /label="Value per fxSAVE"/);
  assert.doesNotMatch(declaration(page, 'VaultDetails'), /InfoHelp|MetricLabel/, 'no help buried inside vault details');
  assert.match(pageText, /config=\{activeReadWarnings.includes\('vault configuration'\) \? null : config\}/, 'stale configuration cannot appear current in choices');
});

test('large vault totals keep whole-unit display precision and exact title values', () => {
  const totalAssetsWei = parseUnits('70893681.65091987654321', 18);
  const props = { data: null, connected: false, loading: false, onRefresh: async () => {}, readWarnings: [], config: { totalAssetsWei },
    fxSaveApy: null, fxSaveApyStatus: 'unavailable', onClaim: () => {}, claimTriggerRef: { current: null } };
  const html = renderToStaticMarkup(evaluate<React.ReactElement>([
    helpers, declaration(page, 'SavingsSummary'), 'SavingsSummary(props);',
  ].join('\n'), { props, useUsdPrices: () => quote({ prices: { fxSAVE: 1.12, fxUSDBasePool: 1.01 }, updatedAt: Date.now() }) }));
  assert.match(html, /title="70893681\.65091987654321 fxSP"/);
  assert.match(html, /≈ 70,893,681 fxSP<\/small>/);
  assert.doesNotMatch(html, />70,893,681\.65091 fxSP</);
});
