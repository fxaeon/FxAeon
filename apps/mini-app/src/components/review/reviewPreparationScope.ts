/** One bounded, cancellable budget for quote, simulation and fee preparation.
 * Cancelling stops this consumer from accepting late shared RPC work. */
export const REVIEW_PREPARATION_TIMEOUT_MS = 45_000;

export function createReviewPreparationScope(timeoutMs = REVIEW_PREPARATION_TIMEOUT_MS) {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const wait = <T>(work: PromiseLike<T> | T): Promise<T> => new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new Error('Review preparation cancelled.')); };
    const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Review preparation timed out. Check the network and try again.'));
    }, Math.max(0, deadline - Date.now()));
    controller.signal.addEventListener('abort', cancel, { once: true });
    // Observe the source even after cancellation so a late rejection cannot
    // become an unhandled rejection or update the abandoned review.
    Promise.resolve(work).then(value => {
      cleanup();
      if (Date.now() >= deadline) reject(new Error('Review preparation timed out. Check the network and try again.'));
      else resolve(value);
    }, error => { cleanup(); reject(error); });
    if (controller.signal.aborted) cancel();
  });
  return { wait, cancel: () => controller.abort() };
}
