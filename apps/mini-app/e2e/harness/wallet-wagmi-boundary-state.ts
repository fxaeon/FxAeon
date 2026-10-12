/** Synthetic identities only. No wallet, credential, signature, or live funds. */
export const EMBEDDED_ADDRESS = '0x00000000000000000000000000000000000000ee';
export const BROWSER_ADDRESS = '0x00000000000000000000000000000000000000bb';
export const DECOY_ADDRESS = '0x00000000000000000000000000000000000000dd';
export const EMBEDDED_BALANCE = '3000000000000000000';
export type BoundaryMode = 'telegram' | 'web' | 'late-host' | 'bridge-wait';
type Request = { method: string; params?: unknown[] };
export type BoundaryProvider = {
  request: (request: Request) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type WagmiBoundarySnapshot = {
  mode: BoundaryMode;
  discoveryRequests: number;
  configCreates: number;
  connectorCreates: number;
  wagmiConnections: Array<{ status: string; accounts: string[]; connectorId?: string }>;
  privyModuleLoads: number;
  privyMounts: number;
  privyUnmounts: number;
  privyHookCalls: number;
  routeMounts: number;
  routeUnmounts: number;
  childMounts: number;
  childUnmounts: number;
  browserCalls: Request[];
  decoyCalls: Request[];
  embeddedCalls: Request[];
  forbiddenCalls: string[];
  errors: string[];
};
export type WagmiBoundaryState = WagmiBoundarySnapshot & {
  embeddedProvider: BoundaryProvider;
  installTelegram: () => void;
  announceBrowser: () => void;
  navigate?: (route: string) => void;
  snapshot: () => WagmiBoundarySnapshot;
};
declare global { var __wagmiBoundaryHarness: WagmiBoundaryState; }
