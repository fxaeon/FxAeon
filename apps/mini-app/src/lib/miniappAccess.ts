import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { currentTelegramLaunchData, launchUserId } from './telegramAdmission';
import { asHexQuantity } from './wallet/helpers';
import type { FxWalletTransaction } from './wallet/types';

export const TELEGRAM_PASSKEY_MODE = (() => {
  try { return process.env.NEXT_PUBLIC_TELEGRAM_WALLET_MODE === 'passkey'; } catch { return false; }
})();
export const MINIAPP_ACCESS_ENDPOINT = '/api/telegram-wallet';
export const HANDOFF_TIMEOUT_MS = 5 * 60_000;
export type MiniappWallet = { id: string; address: `0x${string}` };
export type MiniappAccessStatus = {
  state: 'new' | 'waiting' | 'approved' | 'ready';
  telegramNotify: boolean;
  emailVerified: boolean;
  cohortFull: boolean;
  hasCredential: boolean;
  wallet?: MiniappWallet;
};
export type MiniappTransaction = { from: string; to: string; chainId: 1 | 8453; value: string; data: string } & Partial<Record<'nonce' | 'gasLimit' | 'gasPrice' | 'maxFeePerGas' | 'maxPriorityFeePerGas', string>>;
export type WalletResult = { wallet: MiniappWallet };
export type SignResult = { hash: `0x${string}` };
export type HandoffRead =
  | { kind: 'register'; options: PublicKeyCredentialCreationOptionsJSON }
  | { kind: 'sign'; options: PublicKeyCredentialRequestOptionsJSON; transaction: MiniappTransaction };
export type HandoffStatus = { state: 'pending' | 'done' | 'error'; result?: WalletResult | SignResult; error?: string };
export type TransactionOperation = {
  id: string; state: 'dispatching' | 'submitted' | 'unknown' | 'rejected'; hash: `0x${string}` | null; chainId: 1 | 8453; acknowledged: boolean;
};
type SigningContext = { walletId: string; referenceId: string; caip2: 'eip155:1' | 'eip155:8453'; expiresAt: number };
export type PendingOperationHint = {
  challengeId: string; phase: 'prepared' | 'dispatching' | 'handoff' | 'submitted' | 'acknowledging';
};

type AccessActions = {
  status: { input: Record<string, never>; output: MiniappAccessStatus };
  join: { input: { notify: boolean }; output: MiniappAccessStatus };
  notify: { input: { allowed: boolean }; output: MiniappAccessStatus };
  'email/request': { input: { email: string }; output: { status: 'verification_requested' } };
  'email/confirm': { input: { token: string }; output: { verified: true } };
  'register/options': { input: Record<string, never>; output: { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } };
  'register/complete': { input: { challengeId: string; response: RegistrationResponseJSON }; output: WalletResult & { state: 'ready' } };
  'wallet/retry': { input: Record<string, never>; output: WalletResult & { state: 'ready' } };
  'sign/options': { input: { transaction: MiniappTransaction }; output: { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON } };
  'sign/complete': { input: { challengeId: string; response: AuthenticationResponseJSON }; output: SignResult };
  'handoff/create': { input: { challengeId: string }; output: { url: string } };
  'handoff/status': { input: { challengeId: string }; output: HandoffStatus };
  'handoff/read': { input: { token: string }; output: HandoffRead };
  'handoff/complete': { input: { token: string; response: RegistrationResponseJSON | AuthenticationResponseJSON }; output: WalletResult | SignResult };
  'transaction/status': { input: { id?: string }; output: { operation: TransactionOperation | null } };
  'transaction/ack': { input: { id: string; hash: string }; output: { acknowledged: true } };
};

const PUBLIC_ACTIONS = new Set<keyof AccessActions>(['email/confirm', 'handoff/read', 'handoff/complete']);
const MESSAGES: Record<string, string> = {
  launch_expired: 'Reopen FxAeon from Telegram and try again.',
  launch_rejected: 'Open FxAeon from its Telegram bot.',
  approval_required: 'Your access is awaiting approval.',
  passkey_disabled: 'Wallet setup is not available yet.',
  challenge_expired: 'This approval expired. Return to Telegram.',
  challenge_used: 'This approval has already been used. Return to Telegram.',
  handoff_expired: 'This approval link expired. Return to Telegram.',
  handoff_invalid: 'This approval link is unavailable. Return to Telegram.',
  credential_exists: 'Your passkey is already registered. Retry wallet setup.',
  invalid_email: 'Enter a valid email address.',
  email_token_invalid: 'This confirmation link is invalid or expired.',
  rate_limited: 'Please wait before trying again.',
  approval_expired: 'This approval expired. Return to Telegram.',
  passkey_backup_required: 'Use a synced or backed-up passkey to finish setup.',
  passkey_already_registered: 'Your passkey is already registered. Retry wallet setup.',
  passkey_rejected: 'Passkey approval could not be verified. Please try again.',
  confirmation_expired: 'This confirmation link is invalid or expired.',
  notification_unavailable: 'Email notifications are unavailable right now. Your place is still saved.',
  notification_rate_limited: 'Please wait before requesting another confirmation email.',
  notification_input_invalid: 'Enter a valid email address.',
  transaction_unknown: 'The transaction result is unknown. Check your wallet activity before continuing.',
  transaction_unresolved: 'Review your previous transaction before continuing.',
  storage_unavailable: 'This device couldn’t save approval progress. Allow site storage and try again.',
};
export class MiniappAccessError extends Error {
  constructor(readonly code: string, readonly uncertain = false) {
    super(Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code]
      : uncertain ? 'The result could not be confirmed. Check your wallet activity before trying again.' : 'Couldn’t complete this request. Please try again.');
    this.name = 'MiniappAccessError';
  }
}
export function accessErrorMessage(error: unknown): string {
  if (error instanceof MiniappAccessError) return error.message;
  if (error instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.name)) return 'Passkey approval was cancelled.';
  return 'Couldn’t complete this request. Please try again.';
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function isMiniappWallet(value: unknown): value is MiniappWallet {
  return record(value) && typeof value.id === 'string' && value.id.length > 0 && typeof value.address === 'string' && /^0x[0-9a-f]{40}$/i.test(value.address);
}
export function isSignResult(value: unknown): value is SignResult {
  return record(value) && typeof value.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(value.hash);
}
export function isWalletResult(value: unknown): value is WalletResult { return record(value) && isMiniappWallet(value.wallet); }
function validStatus(value: Record<string, unknown>): boolean {
  return ['new', 'waiting', 'approved', 'ready'].includes(String(value.state))
    && ['telegramNotify', 'emailVerified', 'cohortFull', 'hasCredential'].every(key => typeof value[key] === 'boolean')
    && (value.wallet === undefined || isMiniappWallet(value.wallet))
    && (value.state !== 'ready' || isMiniappWallet(value.wallet));
}
function validOptions(value: unknown): boolean {
  return record(value) && typeof value.challenge === 'string' && value.challenge.length > 0;
}
function validOperation(value: unknown): value is TransactionOperation {
  return record(value) && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.id)
    && ['dispatching', 'submitted', 'unknown', 'rejected'].includes(String(value.state)) && (value.chainId === 1 || value.chainId === 8453)
    && typeof value.acknowledged === 'boolean'
    && (value.state !== 'rejected' || value.acknowledged === true)
    && (value.state === 'submitted' ? isSignResult(value) : value.hash === null);
}
function validResponse(action: keyof AccessActions, value: unknown): boolean {
  if (!record(value)) return false;
  switch (action) {
    case 'status': case 'join': case 'notify': return validStatus(value);
    case 'register/options': case 'sign/options': return typeof value.challengeId === 'string' && value.challengeId.length > 0 && validOptions(value.options);
    case 'register/complete': case 'wallet/retry': return value.state === 'ready' && isWalletResult(value);
    case 'sign/complete': return isSignResult(value);
    case 'handoff/create': return typeof value.url === 'string';
    case 'handoff/complete': return isWalletResult(value) || isSignResult(value);
    case 'handoff/read': {
      if (!validOptions(value.options)) return false;
      if (value.kind === 'register') return true;
      if (value.kind !== 'sign' || !record(value.transaction)) return false;
      try { validateApprovalTransaction(value.transaction); return true; } catch { return false; }
    }
    case 'handoff/status': return value.state === 'pending' || value.state === 'error'
      || (value.state === 'done' && (isWalletResult(value.result) || isSignResult(value.result)));
    case 'email/request': return value.status === 'verification_requested';
    case 'email/confirm': return value.verified === true;
    case 'transaction/status': return value.operation === null || validOperation(value.operation);
    case 'transaction/ack': return value.acknowledged === true;
  }
}

/** Same-origin POSTs only. Browser tickets never inherit Telegram launch data. */
export async function miniappAccess<A extends keyof AccessActions>(
  action: A, input: AccessActions[A]['input'], options: { signal?: AbortSignal; launchData?: string; timeoutMs?: number } = {},
): Promise<AccessActions[A]['output']> {
  const launchData = PUBLIC_ACTIONS.has(action) ? undefined : options.launchData ?? currentTelegramLaunchData();
  if (!PUBLIC_ACTIONS.has(action) && !launchData) throw new MiniappAccessError('launch_rejected');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 20_000);
  const mayHaveCompleted = action === 'sign/complete' || action === 'handoff/complete' || action === 'register/complete' || action === 'wallet/retry';
  let dispatched = false;
  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    dispatched = true;
    const response = await fetch(MINIAPP_ACCESS_ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, action, ...(launchData ? { launchData } : {}) }),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > 262_144) throw new Error('Invalid response');
    const value: unknown = JSON.parse(text);
    if (!response.ok) throw new MiniappAccessError(record(value) && typeof value.error === 'string' ? value.error : 'unavailable', mayHaveCompleted && response.status >= 500);
    if (!validResponse(action, value)) throw new Error('Invalid response');
    return value as AccessActions[A]['output'];
  } catch (error) {
    if (error instanceof MiniappAccessError) throw error;
    if (!dispatched && controller.signal.aborted) throw error;
    throw new MiniappAccessError('unavailable', dispatched && mayHaveCompleted);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Snapshot the exact reviewed transaction; never retain caller-owned mutable objects. */
export function miniappTransaction(transaction: FxWalletTransaction, address: string): MiniappTransaction {
  if (!/^0x[0-9a-f]{40}$/i.test(address) || !/^0x[0-9a-f]{40}$/i.test(transaction.to)) throw new Error('Invalid transaction address.');
  if (transaction.from && transaction.from.toLowerCase() !== address.toLowerCase()) throw new Error('Transaction sender does not match the selected wallet.');
  if (transaction.chainId !== 1 && transaction.chainId !== 8453) throw new Error('Unsupported network.');
  if (transaction.data !== undefined && !/^0x(?:[0-9a-f]{2})*$/i.test(transaction.data)) throw new Error('Invalid transaction data.');
  const value: MiniappTransaction = { from: address, to: transaction.to, chainId: transaction.chainId, value: asHexQuantity(transaction.value ?? 0)!, data: transaction.data ?? '0x' };
  for (const key of ['nonce', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const) {
    if (transaction[key] !== undefined) value[key] = asHexQuantity(transaction[key]);
  }
  return Object.freeze(value);
}

/** Reject unsupported or malformed handoff payloads before showing an approval button. */
export function validateApprovalTransaction(value: Record<string, unknown>): MiniappTransaction {
  exactFields(value, ['from', 'to', 'chainId', 'value', 'data', 'nonce', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'], ['from', 'to', 'chainId', 'value', 'data']);
  const chainId = typeof value.chainId === 'number' ? value.chainId : Number(value.chainId);
  if (chainId !== 1 && chainId !== 8453) throw new Error('Unsupported network.');
  for (const key of ['value', 'nonce', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string' && typeof value[key] !== 'number') throw new Error('Invalid transaction quantity.');
  }
  if (typeof value.from !== 'string' || typeof value.to !== 'string' || typeof value.data !== 'string' || value.value === undefined) throw new Error('Incomplete transaction.');
  return miniappTransaction({ ...value, chainId } as FxWalletTransaction, value.from);
}

function exactFields(value: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) throw new Error('Unexpected approval fields.');
}
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The WebAuthn challenge is the authorization, not an opaque server nonce.
 * Compare its canonical UTF-8 JSON bytes to the immutable transaction accepted
 * locally before invoking WebAuthn OR issuing a browser handoff.
 */
export function verifySigningChallenge(challenge: string, transaction: MiniappTransaction, walletId?: string,
  appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '', now = Date.now()): { walletId: string; transaction: MiniappTransaction; context: SigningContext } {
  const reject = () => new Error('The approval does not match the reviewed transaction.');
  try {
    if (!/^[a-z0-9]{20,40}$/.test(appId) || !/^[A-Za-z0-9_-]+$/.test(challenge) || challenge.length > 32_000) throw reject();
    const bytes = Uint8Array.from(atob(challenge.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const envelope: unknown = JSON.parse(text);
    if (!record(envelope) || canonicalJSON(envelope) !== text || text.length > 24_000) throw reject();
    exactFields(envelope, ['version', 'method', 'url', 'headers', 'body']);
    if (envelope.version !== 1 || envelope.method !== 'POST' || typeof envelope.url !== 'string') throw reject();
    const match = /^https:\/\/api\.privy\.io\/v1\/wallets\/([A-Za-z0-9_-]{1,100})\/rpc$/.exec(envelope.url);
    if (!match || (walletId !== undefined && match[1] !== walletId)) throw reject();
    const headers = envelope.headers;
    if (!record(headers)) throw reject();
    exactFields(headers, ['privy-app-id', 'privy-idempotency-key', 'privy-request-expiry']);
    if (headers['privy-app-id'] !== appId || typeof headers['privy-idempotency-key'] !== 'string'
      || !/^[A-Za-z0-9_-]{1,100}$/.test(headers['privy-idempotency-key'])
      || typeof headers['privy-request-expiry'] !== 'string' || !/^\d{13}$/.test(headers['privy-request-expiry'])) throw reject();
    const expiry = Number(headers['privy-request-expiry']);
    if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + HANDOFF_TIMEOUT_MS) throw reject();
    const body = envelope.body;
    if (!record(body)) throw reject();
    exactFields(body, ['method', 'caip2', 'params', 'chain_type', 'reference_id'], ['method', 'caip2', 'params', 'reference_id']);
    if (body.method !== 'eth_sendTransaction' || body.caip2 !== `eip155:${transaction.chainId}`
      || body.reference_id !== headers['privy-idempotency-key']
      || (body.chain_type !== undefined && body.chain_type !== 'ethereum') || !record(body.params)) throw reject();
    exactFields(body.params, ['transaction']);
    const expected: Record<string, unknown> = { to: transaction.to, chain_id: transaction.chainId, value: transaction.value, data: transaction.data };
    for (const [client, remote] of [['nonce', 'nonce'], ['gasLimit', 'gas_limit'], ['gasPrice', 'gas_price'], ['maxFeePerGas', 'max_fee_per_gas'], ['maxPriorityFeePerGas', 'max_priority_fee_per_gas']] as const) {
      if (transaction[client] !== undefined) expected[remote] = transaction[client];
    }
    if (canonicalJSON(body.params.transaction) !== canonicalJSON(expected)) throw reject();
    return { walletId: match[1], transaction: Object.freeze({ ...transaction }),
      context: { walletId: match[1], referenceId: headers['privy-idempotency-key'], caip2: `eip155:${transaction.chainId}`, expiresAt: expiry } };
  } catch { throw reject(); }
}

export function validatedHandoffUrl(value: string, origin: string): string {
  const url = new URL(value, origin);
  if (url.origin !== origin || !/^\/wallet-approval\/?$/.test(url.pathname) || url.search || url.username || url.password
    || !new URLSearchParams(url.hash.slice(1)).get('token')) throw new Error('Invalid approval destination.');
  return url.href;
}

/** The origin document commits to the decoded WebAuthn challenge bytes. This
 * fragment never goes to the API, so a substituted handoff response cannot
 * replace both the displayed transaction and its matching authorization.
 */
export async function challengeCommitment(challenge: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(challenge) || challenge.length > 32_000) throw new Error('Invalid approval challenge.');
  const bytes = Uint8Array.from(atob(challenge.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function verifyChallengeCommitment(challenge: string, commitment: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(commitment) || await challengeCommitment(challenge) !== commitment) {
    throw new Error('This browser approval does not match the request from Telegram.');
  }
}

/** Consume secret links once per document; StrictMode re-renders keep them only in memory. */
let consumedToken: { path: string; token: string; commitment: string } | undefined;
export function consumeAccessToken(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname;
  if (consumedToken?.path === path) return consumedToken.token;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token') ?? '';
  window.history.replaceState(window.history.state, '', path);
  consumedToken = { path, token, commitment: fragment.get('commitment') ?? '' };
  return token;
}
export function consumeApprovalTicket(): { token: string; commitment: string } {
  const token = consumeAccessToken();
  return { token, commitment: consumedToken?.commitment ?? '' };
}
export function forgetAccessToken(): void { consumedToken = undefined; }

/** Device hints locate recovery only; the authenticated server is always the
 * source of ownership, result, and acknowledgment. Never persist a launch secret.
 */
function operationHintKey(walletId: string, launchData: string): string {
  const userId = launchUserId(launchData);
  if (userId === null || !/^[A-Za-z0-9_-]{1,100}$/.test(walletId)) throw new MiniappAccessError('launch_rejected');
  return `fxaeon:passkey-operation:v1:${userId}:${walletId}`;
}
export function readPendingOperation(walletId: string, launchData: string): PendingOperationHint | null {
  try {
    const raw = localStorage.getItem(operationHintKey(walletId, launchData));
    if (!raw) return null;
    const hint: unknown = JSON.parse(raw);
    if (!record(hint) || typeof hint.challengeId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(hint.challengeId)
      || !['prepared', 'dispatching', 'handoff', 'submitted', 'acknowledging'].includes(String(hint.phase))) return null;
    return hint as PendingOperationHint;
  } catch { return null; }
}
export function savePendingOperation(walletId: string, launchData: string, hint: PendingOperationHint): void {
  try {
    const key = operationHintKey(walletId, launchData);
    localStorage.setItem(key, JSON.stringify(hint));
    if (localStorage.getItem(key) !== JSON.stringify(hint)) throw new Error('Storage did not retain progress.');
  } catch { throw new MiniappAccessError('storage_unavailable'); }
}
export function clearPendingOperation(walletId: string, launchData: string, challengeId: string): void {
  try {
    if (readPendingOperation(walletId, launchData)?.challengeId === challengeId) localStorage.removeItem(operationHintKey(walletId, launchData));
  } catch { /* A retained hint cannot authorize a transaction. */ }
}

export function telegramReturnUrl(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot');
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password) throw new Error('Invalid Telegram URL');
    url.hash = '';
    // The return destination never carries ticket or invitation secrets.
    url.search = '';
    return url.href;
  } catch { return 'https://t.me/FxAeonBot'; }
}

export async function pollHandoff(challengeId: string, options: { signal: AbortSignal; launchData: string; assertCurrent: () => void }): Promise<WalletResult | SignResult> {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    options.assertCurrent();
    const result = await miniappAccess('handoff/status', { challengeId }, { ...options, timeoutMs: Math.min(20_000, deadline - Date.now()) });
    options.assertCurrent();
    if (result.state === 'done' && result.result) return result.result;
    if (result.state === 'error') throw new MiniappAccessError(result.error ?? 'unavailable');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { options.signal.removeEventListener('abort', abort); resolve(); }, Math.min(1500, deadline - Date.now()));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw new MiniappAccessError('unavailable', true);
}
