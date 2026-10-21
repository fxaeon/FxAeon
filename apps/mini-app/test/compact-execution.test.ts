import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactExecutionStatus } from '../src/components/review/compactExecution';
import type { TransactionStepResult } from '../src/lib/fx/types';
const step = (changes: Partial<TransactionStepResult> = {}) => ({ index:0, transaction:{kind:'action'}, hash:`0x${'a'.repeat(64)}`,status:'submitted', ...changes }) as TransactionStepResult;
test('pending labels preserve wallet approval versus action and no submission is called success', () => {
 assert.equal(compactExecutionStatus('awaiting-user',[],false,'approval').label,'Approve in wallet');
 assert.equal(compactExecutionStatus('awaiting-user',[],false,'action').label,'Confirm in wallet');
 assert.deepEqual(compactExecutionStatus('submitted',[step()]),{label:'Submitted',warning:'Do not resubmit'});
 assert.equal(compactExecutionStatus('submitted',[],true).label,'Switching network');
});
test('confirmation counts are shown only when actually supplied, never inferred from inclusion', () => {
 assert.equal(compactExecutionStatus('included',[step({status:'included'})]).label,'Included');
 assert.equal(compactExecutionStatus('confirming',[step({status:'confirming'})]).label,'Confirming');
 assert.equal(compactExecutionStatus('confirming',[step({status:'confirming',confirmations:0,requiredConfirmations:2})]).label,'Confirming · 0/2');
 assert.equal(compactExecutionStatus('confirming',[step({status:'confirming',confirmations:1,requiredConfirmations:2})]).label,'Confirming · 1/2');
});
test('uncertain submitted and unverified receipt states retain no-repeat warning', () => {
 assert.deepEqual(compactExecutionStatus('failed',[step({status:'failed'})]),{label:'Confirmation unknown',warning:'Do not resubmit'});
 assert.deepEqual(compactExecutionStatus('failed',[step({status:'failed',receipt:{status:'success'} as any})]),{label:'Verification incomplete',warning:'Do not resubmit'});
});
