import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { borrowLtvCeiling, formatBorrowBasisPoints } from '../src/components/review/borrowLimitPresentation';
import { borrowCapacity } from '../src/lib/fx/borrowLimits';
test('the buffered 83.79% boundary is not displayed as 83.7% against 83.8% LTV', () => {
 const col=10000n*10n**18n, limit=8379n*10n**18n;
 assert.equal(formatBorrowBasisPoints(8379n),'83.79%');
 assert.equal(borrowLtvCeiling(limit-1n,col),'≤ 83.79%');
 assert.equal(borrowLtvCeiling(limit,col),'83.79%');
 assert.equal(borrowLtvCeiling(limit+1n,col),'≤ 83.8%');
 const cap=borrowCapacity({collateralUsd:col,existingDebt:0n,range:{min:25600000000000000n,max:855000000000000000n,source:'live'} as any});
 assert.equal(cap.maxAdditional,limit); // capacity unchanged, above limit remains blocked
 assert.ok(limit+1n>cap.maxAdditional);
});
test('zero, tiny nonzero and unavailable LTV remain truthful without financial Number parsing', () => {
 assert.equal(borrowLtvCeiling(0n,10000n),'0%');
 assert.equal(borrowLtvCeiling(1n,1000000000000000000n),'≤ 0.01%');
 assert.equal(borrowLtvCeiling(1n,0n),'Unavailable');
 assert.equal(borrowLtvCeiling(-1n,100n),'Unavailable');
 const source=readFileSync(new URL('../src/components/review/borrowLimitPresentation.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/Number\(|parseFloat|toFixed/);
 const page=readFileSync(new URL('../src/app/borrow/page.tsx',import.meta.url),'utf8');
 assert.equal((page.match(/label: 'Estimated debt', value:/g)||[]).length,2);
 assert.match(page,/mintWei > capacity.maxAdditional/);
});
