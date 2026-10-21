import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Check, Info } from 'lucide-react';
import ts from 'typescript';
import { formatUnits } from 'viem';
import TokenIcon, { ChainIcon } from '../src/components/TokenIcon';
import { claimAvailability, type ClaimableLike } from '../src/lib/earnState';
import { isReviewInputStage, type ActionReviewStage } from '../src/components/review/actionReviewTypes';

const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
after(() => { if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React'); });

// Execute the actual card, formatters and account/freshness projection without
// mounting a page's wallet/RPC hooks. These are render tests, not live claims.
function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
}
const page = source('../src/app/earn/page.tsx');
function declaration(file: ts.SourceFile, name: string) {
  const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `${name} exists`);
  return node.getText(file).replace(/^export /, '');
}
const css = readFileSync(new URL('../src/components/SavingsWorkspace.module.css', import.meta.url), 'utf8');
const presentation = Object.fromEntries([...css.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
const functions = [
  declaration(page, 'ClaimState'), declaration(page, 'formatDisplayAmount'), declaration(page, 'formatTimestamp'),
  declaration(source('../src/app/trade/fxUi.ts'), 'formatAmount'),
  declaration(source('../src/components/ProductUI.tsx'), 'StatusNotice'),
].join('\n');
function evaluate<T>(code: string, bindings: object): T {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(js, { React, Check, Info, TokenIcon, ChainIcon, claimAvailability, formatUnits, presentation, styles: {}, ...bindings }) as T;
}

type ClaimRead = ClaimableLike & { previewReceive?: { amountYieldOutWei: bigint; amountStableOutWei: bigint } };
const pending: ClaimRead = {
  hasPendingRedeem: true, pendingSharesWei: 2_345678900000000000n,
  isCooldownComplete: false, redeemableAt: 2_000,
};
function render(claimable: ClaimRead | null, redeemStatus: ClaimableLike | null = null) {
  const data = { walletAddress: '0x1111111111111111111111111111111111111111', balance: null, claimable, redeemStatus };
  const before = structuredClone(data);
  const result = renderToStaticMarkup(evaluate<React.ReactNode>(`${functions}\nClaimState({ data });`, { data }));
  assert.deepEqual(data, before, 'a display card must not change claim data');
  assert.doesNotMatch(result, /<button|<a\b|View transaction|Original request|Gas fee|Transaction confirmed/,
    'the editor reuses the existing review action and has no invented receipt evidence');
  return result;
}

test('queued card groups the real fxSP amount and waiting status without local-clock promotion', () => {
  const html = render(pending);
  assert.match(html, /aria-label="Withdrawal details" data-claim-status="cooldown"/);
  assert.match(html, /<h3>Withdrawal queued<\/h3>/);
  assert.match(html, /<dt>Amount queued<\/dt><dd title="2\.3456789 fxSP">≈ 2\.34567 fxSP<\/dd>/);
  assert.match(html, /<dt>Claim status<\/dt><dd>Waiting<\/dd>/);
  assert.match(html, /Available to claim/);
  assert.match(html, /No payout yet/);
  assert.match(html, /fresh contract reads before review/);
  assert.match(html, /\/token-icons\/fxsave\.svg/);
  assert.match(html, /\/chain-icons\/ethereum\.png/);
  assert.doesNotMatch(html, /200 fxSAVE|2\.34567 fxSAVE|Ready to claim|Withdrawal ready/);
  assert.equal(claimAvailability(pending).canReview, false, 'a timestamp in the past is not readiness evidence');
});

test('queued shares retain exact units and full precision when the compact amount is shortened', () => {
  const exact = render({ ...pending, pendingSharesWei: 2_000n * 10n ** 18n });
  assert.match(exact, /<dd title="2000 fxSP">2,000 fxSP<\/dd>/);
  const tiny = render({ ...pending, pendingSharesWei: 1n });
  assert.match(tiny, /<dd title="0\.000000000000000001 fxSP">≈ 0 fxSP<\/dd>/);
  assert.doesNotMatch(tiny, /<dd[^>]*>0 fxSP<\/dd>/);
});

test('ready card preserves separate approximate fxUSD and USDC amounts and final-amount caveat', () => {
  const html = render({ ...pending, isCooldownComplete: true, previewReceive: { amountYieldOutWei: 3_125000000000000000n, amountStableOutWei: 750_000n } });
  assert.match(html, /data-claim-status="ready"/);
  assert.match(html, /<h3>Withdrawal ready<\/h3>/);
  assert.match(html, /Claimable assets<\/dt><dd>fxUSD \/ USDC/);
  assert.match(html, /class="claimReady">Ready to claim/);
  assert.match(html, /fxUSD to receive<\/dt><dd>≈ 3\.125 fxUSD/);
  assert.match(html, /USDC to receive<\/dt><dd>≈ 0\.75 USDC/);
  assert.match(html, /Amounts are estimates/);
  assert.match(html, /Final amounts may change/);
  assert.doesNotMatch(html, /Available to claim|No payout yet|Minimum|received<\/dt>/);
});

test('a zero individual payout asset stays explicit and never becomes a fake combined payout', () => {
  for (const previewReceive of [
    { amountYieldOutWei: 0n, amountStableOutWei: 750_000n },
    { amountYieldOutWei: 3_125000000000000000n, amountStableOutWei: 0n },
  ]) {
    const html = render({ ...pending, isCooldownComplete: true, previewReceive });
    assert.match(html, previewReceive.amountYieldOutWei === 0n ? /≈ 0 fxUSD/ : /≈ 0 USDC/);
    assert.match(html, /fxUSD to receive/);
    assert.match(html, /USDC to receive/);
    assert.doesNotMatch(html, /Minimum|Total payout/);
  }
});

test('missing amounts and unknown unlock time remain unknown, not zero or ready', () => {
  const ready = render({ ...pending, isCooldownComplete: true });
  assert.match(ready, /Claimable amounts require fresh contract reads/);
  assert.doesNotMatch(ready, /fxUSD to receive|USDC to receive|≈ 0/);
  const queued = render({ ...pending, redeemableAt: null });
  assert.match(queued, /Waiting for the configured cooldown/);
  assert.doesNotMatch(queued, /Available to claim|Ready to claim/);
});

test('unavailable or empty authoritative reads never expose fallback pending amounts or payout previews', () => {
  const unavailable = render(null, { ...pending, isCooldownComplete: true });
  assert.match(unavailable, /Claim status unavailable/);
  assert.match(unavailable, /Refresh to try again/);
  assert.doesNotMatch(unavailable, /Withdrawal ready|Withdrawal queued|fxSP|fxUSD|USDC|<dl/);
  for (const empty of [{ ...pending, hasPendingRedeem: false }, { ...pending, pendingSharesWei: 0n }]) {
    const html = render({ ...empty, previewReceive: { amountYieldOutWei: 9n, amountStableOutWei: 1n } });
    assert.match(html, /No withdrawal queued/);
    assert.doesNotMatch(html, /Withdrawal ready|Withdrawal queued|fxUSD|USDC|<dl/);
  }
});

test('existing Earn account and freshness projection discards stale or account-switched claim data', () => {
  const earn = page.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'EarnPage');
  assert.ok(earn && ts.isFunctionDeclaration(earn) && earn.body);
  const projection = ['walletDataBase', 'walletData'].map(name => {
    const node = earn.body!.statements.find(node => ts.isVariableStatement(node)
      && node.declarationList.declarations.some(declaration => declaration.name.getText(page) === name));
    assert.ok(node, `${name} projection exists`);
    return node.getText(page);
  }).join('\n');
  const data = { walletAddress: '0x1111111111111111111111111111111111111111', claimable: { ...pending, isCooldownComplete: true } };
  for (const status of ['loading', 'unavailable']) {
    const result = evaluate<{ claimable: null }>(`${projection}\nwalletData;`, {
      data, wallet: { address: data.walletAddress }, claimableQuery: { status, data: data.claimable }, useMemo: (read: () => unknown) => read(),
    });
    assert.equal(result.claimable, null);
    assert.equal(claimAvailability(result.claimable).canReview, false);
  }
  const changedWallet = evaluate<null>(`${projection}\nwalletData;`, {
    data, wallet: { address: '0x2222222222222222222222222222222222222222' }, claimableQuery: { status: 'ready', data: data.claimable }, useMemo: (read: () => unknown) => read(),
  });
  assert.equal(changedWallet, null);
});

test('the claim flow retains one sheet owner and the same action child across every stage', () => {
  // Inspect the actual wrapper's element contract. MobileFlowSheet owns the
  // platform-specific portal, focus trap and nested-sheet suppression; those
  // browser behaviours still require mounted interaction coverage.
  const MobileFlowSheet = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const child = React.createElement('div', { 'data-existing-action-review': true });
  const triggerRef = { current: null };
  let closeCount = 0;
  const onClose = () => { closeCount += 1; };
  const titles: Record<ActionReviewStage, string> = {
    input: 'Withdrawal details', planning: 'Withdrawal details', review: 'Review claim', executing: 'Review claim', result: 'Transaction details',
  };
  for (const stage of Object.keys(titles) as ActionReviewStage[]) {
    const element = evaluate<React.ReactElement<{ title: string; dismissible: boolean; triggerRef: typeof triggerRef; children: React.ReactNode; onClose: () => void }>>(
      `${declaration(page, 'EarnClaimSheet')}\nEarnClaimSheet({ mode: 'claim', stage, children, onClose, triggerRef });`,
      { MobileFlowSheet, isReviewInputStage, stage, children: child, onClose, triggerRef },
    );
    assert.equal(element.type, MobileFlowSheet);
    assert.equal(element.key, null, 'stage changes do not key/remount the sheet');
    assert.equal(element.props.children, child, 'the existing ActionReview is not cloned or replaced');
    assert.equal(element.props.triggerRef, triggerRef, 'focus returns to the original savings-summary control');
    assert.equal(element.props.title, titles[stage]);
    assert.equal(element.props.dismissible, stage !== 'planning' && stage !== 'executing');
    assert.equal(element.props.onClose, onClose);
  }
  assert.equal(closeCount, 0, 'rendering a stage does not dismiss or reset the claim');
});

test('deposit and withdrawal keep the existing inline action instead of opening a claim sheet', () => {
  const child = React.createElement('div', { 'data-existing-action-review': true });
  for (const mode of ['deposit', 'withdraw']) {
    const element = evaluate<React.ReactElement<{ children: React.ReactNode }>>(
      `${declaration(page, 'EarnClaimSheet')}\nEarnClaimSheet({ mode, stage: 'input', children, onClose, triggerRef });`,
      { isReviewInputStage, mode, children: child, onClose: () => { throw new Error('Must not close while rendering'); }, triggerRef: { current: null } },
    );
    assert.equal(element.type, React.Fragment);
    assert.equal(element.props.children, child);
  }
});
