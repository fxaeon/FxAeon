export type PendingPositionRead<T> = { current: { address: string; promise: Promise<T> } | null };

export const EMPTY_POSITION_BLOCK_REFRESH_MS = 15_000;

/** An empty, fully verified wallet cannot need another full discovery on each
 * nearby block. Occupied or uncertain snapshots still refresh every block. */
export function positionBlockRefreshDue(snapshot: {
  walletAddress: string | null;
  status: string;
  positions: readonly unknown[];
  lastVerifiedAt: number | null;
}, address: string, now: number): boolean {
  if (snapshot.walletAddress?.toLowerCase() !== address.toLowerCase()
    || snapshot.status !== 'ready' || snapshot.positions.length !== 0
    || snapshot.lastVerifiedAt === null) return true;
  const age = now - snapshot.lastVerifiedAt;
  return age < 0 || age >= EMPTY_POSITION_BLOCK_REFRESH_MS;
}

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
