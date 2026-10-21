export type PendingPositionRead<T> = { current: { address: string; promise: Promise<T> } | null };

/** Ordinary refreshes coalesce. A receipt-following refresh must start a new
 * read, because a pending read may have begun before the confirmed action. */
export function loadPositionRefresh<T>(pending: PendingPositionRead<T>, address: string, load: (address: string) => Promise<T>, afterConfirmation = false): Promise<T> {
  const normalized = address.toLowerCase();
  if (!afterConfirmation && pending.current?.address === normalized) return pending.current.promise;
  const promise = load(address).finally(() => {
    if (pending.current?.promise === promise) pending.current = null;
  });
  pending.current = { address: normalized, promise };
  return promise;
}
