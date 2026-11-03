export type PortfolioConnection = 'unknown' | 'disconnected' | 'connected';
export type PortfolioState = 'unknown' | 'disconnected' | 'connected-loading' | 'connected-ready' | 'connected-error' | 'connected-empty';

export function portfolioConnectionState(wallet: { ready: boolean; restoring?: boolean; authenticated: boolean; address?: string }): PortfolioConnection {
  if (!wallet.ready || wallet.restoring) return 'unknown';
  return wallet.authenticated && wallet.address ? 'connected' : 'disconnected';
}

export function portfolioState({ connection, pending = false, failed = false, hasHoldings = false }: {
  connection: PortfolioConnection; pending?: boolean; failed?: boolean; hasHoldings?: boolean;
}): PortfolioState {
  if (connection !== 'connected') return connection;
  if (failed) return 'connected-error';
  if (pending) return 'connected-loading';
  return hasHoldings ? 'connected-ready' : 'connected-empty';
}
