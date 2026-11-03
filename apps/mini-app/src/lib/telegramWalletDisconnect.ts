import { launchUserId } from './telegramAdmission';

const PREFIX = 'fxaeon:telegram-wallet-disconnected:v1:';
const documentChoice = new Map<number, boolean>();
const writeFailed = new Set<number>();

/** A local opt-out only, never admission or wallet authority. Call at a
 * server-validated launch boundary; no launch data or account is persisted. */
export function telegramWalletDisconnected(launch: string): boolean {
  const user = launchUserId(launch);
  if (user === null || typeof window === 'undefined') return false;
  // Reads can succeed while writes/removals fail. Preserve either explicit
  // choice for this document until it can be durably written, including false.
  if (writeFailed.has(user)) return documentChoice.get(user)!;
  try { return window.localStorage.getItem(`${PREFIX}${user}`) === '1'; }
  catch { return documentChoice.get(user) ?? false; }
}

export function setTelegramWalletDisconnected(launch: string, disconnected: boolean): void {
  const user = launchUserId(launch);
  if (user === null || typeof window === 'undefined') return;
  documentChoice.set(user, disconnected);
  try {
    if (disconnected) window.localStorage.setItem(`${PREFIX}${user}`, '1');
    else window.localStorage.removeItem(`${PREFIX}${user}`);
    writeFailed.delete(user);
  } catch { writeFailed.add(user); /* This document's explicit choice wins. */ }
}
