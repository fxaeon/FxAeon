// Used only by the local-fork proof build. Production renders no transaction
// payloads; the proof still compares the accepted route with wallet requests.
module.exports = function reviewEvidenceLoader(source) {
  const marker = '<header data-review-header';
  if (source.split(marker).length !== 2) throw new Error('Expected one ActionReview header for fork evidence');
  return source.replace(marker, `${marker} data-fork-reviewed-transactions={stage === 'review' && route ? JSON.stringify(route.transactions.map((transaction, index) => ({ heading: stepTitle(transaction) + ' ' + (index + 1), status: '', contract: transaction.to, calldata: transaction.data, valueWei: String(transaction.value ?? 0n) }))) : undefined}`);
};
