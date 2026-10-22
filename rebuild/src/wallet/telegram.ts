import type { ManagedWalletPort } from './management.ts';
import { createPrivyWallet } from './privy.ts';

export interface TelegramWalletOptions {
  readonly appId?: string;
  readonly clientId?: string;
  readonly theme?: 'dark' | 'light';
}

/** Host detection is not authentication. No ID means no SDK import or login. */
export function createTelegramWallet(options: TelegramWalletOptions): ManagedWalletPort {
  const appId = typeof options.appId === 'string' && /^[a-z0-9_-]{1,128}$/i.test(options.appId) ? options.appId : null;
  const clientId = typeof options.clientId === 'string' && /^[a-z0-9_-]{1,128}$/i.test(options.clientId) ? options.clientId : undefined;
  const adapter = createPrivyWallet({ configured: appId !== null });
  let disposed = false;
  let remove: (() => void) | undefined;
  if (appId && typeof document !== 'undefined') {
    void import('./privy-react.tsx').then(module => {
      if (!disposed) remove = module.mountPrivyWallet(adapter, { appId, clientId, theme: options.theme });
    }).catch(() => { if (!disposed) adapter.unavailable(); });
  }
  const dispose = adapter.dispose.bind(adapter);
  adapter.dispose = () => { if (disposed) return; disposed = true; dispose(); remove?.(); };
  return adapter;
}
