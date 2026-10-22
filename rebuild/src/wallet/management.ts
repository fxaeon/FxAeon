import type { WalletPort } from '../domain/ports.ts';

export interface WalletAuthStatus {
  readonly state: 'unavailable' | 'loading' | 'signed-out' | 'hydrating' | 'choose-wallet' | 'connected';
  readonly message: string;
  readonly canLogin: boolean;
  readonly canConnectAnother: boolean;
  readonly canCreateWallet: boolean;
  readonly canExportWallet: boolean;
  readonly modalOpen: boolean;
}

/** Account controls never continue a transaction that previously needed login. */
export interface WalletManagement {
  status(): WalletAuthStatus;
  login(): Promise<void>;
  connectAnother(): Promise<void>;
  createWallet(): Promise<void>;
  /** Opens the selected embedded wallet's isolated SDK export UI. */
  exportWallet(): Promise<void>;
  setTheme(theme: 'dark' | 'light'): void;
  logout(): Promise<void>;
}

export interface ManagedWalletPort extends WalletPort {
  readonly management: WalletManagement;
}

export function getWalletManagement(wallet: WalletPort): WalletManagement | null {
  return 'management' in wallet ? (wallet as ManagedWalletPort).management : null;
}
