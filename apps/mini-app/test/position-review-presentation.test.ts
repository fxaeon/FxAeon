import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, after } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { positionCollateralDecimals, positionDebtDecimals, type UiPosition } from '../src/app/trade/fxUi';
import { positionCollateralSymbol } from '../src/lib/positionUnits';
import { positionTokenPresentation } from '../src/lib/positionPresentation';
import { pairVerifiedPositionFacts } from '../src/components/review/actionReviewModel';

const require=createRequire(import.meta.url), previousCss=require.extensions['.css'];
require.extensions['.css']=(module,file)=>{module.exports=Object.fromEntries([...readFileSync(file,'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match=>[match[1],match[1]]));};
const oldReact=(globalThis as any).React;(globalThis as any).React=React;
after(()=>{if(previousCss)require.extensions['.css']=previousCss;else delete require.extensions['.css'];(globalThis as any).React=oldReact;});
const {ReviewFactValue}=require('../src/components/review/ReviewFactValue');
const {BorrowPositionAmount}=require('../src/components/review/BorrowPositionAmount');
const source=readFileSync(new URL('../src/app/borrow/page.tsx',import.meta.url),'utf8');
// Compile the actual small source expressions, not a parallel formatting copy.
// This is a render check, not whole-page/native interaction evidence.
function evaluate<T>(snippet:string,bindings:object):T{
 const js=transpileModule(snippet,{compilerOptions:{target:ScriptTarget.ES2020,jsx:JsxEmit.React},fileName:'source-expression.tsx'}).outputText;
 return runInNewContext(js,{React,ReviewFactValue,positionTokenPresentation,positionCollateralDecimals,positionDebtDecimals,positionCollateralSymbol,...bindings}) as T;
}
function position():UiPosition{return {market:'ETH',side:'long',info:{positionId:42,rawColls:10n**12n,rawDebts:10n**15n,rawCollsDecimals:18,rawDebtsDecimals:18,rawCollsToken:'ETH',rawDebtsToken:'fxUSD',currentLeverage:0,lsdLeverage:0}};}
test('Borrow review-before and repay source formatters preserve exact units without changing position state',()=>{
 const declarations=['formatPositionCollateral','formatPositionDebt'].map(name=>{
  const expression=source.match(new RegExp(`^function ${name}\\([^\\n]+$`,'m'))?.[0];assert.ok(expression,`${name} exists`);return expression;
 });
 const p=position(),before=structuredClone(p);
 const [collateral,debt]=evaluate<string[]>(`${declarations.join('\n')}\n[formatPositionCollateral(position),formatPositionDebt(position)];`,{position:p});
 assert.equal(collateral,'0.000001 stETH');assert.equal(debt,'0.001 fxUSD');assert.deepEqual(p,before);
 const paired=pairVerifiedPositionFacts([{label:'Collateral',value:collateral},{label:'Debt',value:debt}],[{label:'Estimated collateral',value:'0.000001 stETH'},{label:'Estimated debt',value:'0.0005 fxUSD'}]);
 assert.equal(paired.paired[0].before,'0.000001 stETH');assert.equal(paired.paired[1].before,'0.001 fxUSD');
 const tiny={...p,market:'BTC' as const,info:{...p.info,rawColls:1n,rawDebts:1n,rawCollsToken:'WBTC'}};
 const exact=evaluate<string[]>(`${declarations.join('\n')}\n[formatPositionCollateral(position),formatPositionDebt(position)];`,{position:tiny});
 assert.equal(exact[0],'0.000000000000000001 WBTC');assert.equal(exact[1],'0.000000000000000001 fxUSD');
});
test('actual Borrow input and repay outcome rows show static compact values while preserving exact model decimals',()=>{
 const rows=[...source.matchAll(/<div><dt>Total debt<\/dt>[^\n]+?<\/div>/g)].map(match=>match[0]);assert.equal(rows.length,2);
 const inputs={existingDebt:721132791793066406250n,debtAfter:720891476593066406250n,repayPreviewWei:241315200000000n};const before=structuredClone(inputs);
 assert.equal(positionTokenPresentation(inputs.existingDebt,18).exact,'721.13279179306640625');
 assert.equal(positionTokenPresentation(inputs.debtAfter,18).exact,'720.89147659306640625');
 const markup=rows.map(row=>renderToStaticMarkup(evaluate<React.ReactNode>(`(${row});`,inputs)));
 for(const html of markup){assert.match(html,/≈ 721.13 fxUSD/);assert.doesNotMatch(html,/<details|<button|<summary|721\.13279179306640625/);}
 assert.match(markup[0],/≈ 720.89 fxUSD/);assert.doesNotMatch(markup[0],/720\.89147659306640625/);assert.deepEqual(inputs,before);
 const tiny=renderToStaticMarkup(evaluate<React.ReactNode>(`(${rows[0]});`,{existingDebt:0n,debtAfter:1n}));assert.match(tiny,/0.000000000000000001 fxUSD/);
});
test('Borrow manager summaries match review precision without nested disclosure controls',()=>{
 const html=renderToStaticMarkup(React.createElement(BorrowPositionAmount,{raw:720891476593066406250n,decimals:18,symbol:'fxUSD'}));
 assert.match(html,/≈ 720.89 fxUSD/);assert.doesNotMatch(html,/720\.89147659306640625|title=|<details|<button|<summary/);
 const manager=readFileSync(new URL('../src/components/BorrowPositionCards.tsx',import.meta.url),'utf8');
 assert.match(manager,/<details className=\{styles.details\}/);assert.match(manager,/<dt>Outstanding debt<\/dt><dd><PositionTokenAmount[^>]+symbol=\{position.info.rawDebtsToken\} \/>/);
});
