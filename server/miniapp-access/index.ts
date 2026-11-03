import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { verifyTelegramLaunchData } from '../../functions/api/telegram-admission';
import { Store, type DB, type Enrollment, type Challenge } from './store';
import { NotificationStore, type NotificationEnv } from './notifications';
import { Operations } from './operations';
import { PrivyWalletApi, type PreparedTransaction } from './privy';
import { registrationOptions, verifyRegistration, verifyApproval, type Passkey } from './passkeys';
import { AccessError, exactKeys, json, readJson, textField } from './http';

export interface Env extends NotificationEnv {
  ADMISSION_DB?: DB;
  TELEGRAM_BOT_ID?: string;
  MINIAPP_ORIGIN?: string;
  MINIAPP_ACCESS_MODE?: string;
  MINIAPP_LEGACY_USERS?: string;
  MINIAPP_OPERATOR_TOKEN?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_PUBLIC_SIGNUP_DISABLED?: string;
}
interface Context { request: Request; env: Env; waitUntil?: (work: Promise<unknown>) => void }
interface Dependencies { publicKey?: Uint8Array<ArrayBuffer>; fetch?: typeof fetch }
interface RegistrationPayload { options: Awaited<ReturnType<typeof registrationOptions>> }
interface SigningPayload { prepared: PreparedTransaction; options: Record<string, unknown>; transaction: unknown }
const initialized = new WeakMap<DB, Map<string, Promise<void>>>();

function configuration(env: Env) {
  const origin = env.MINIAPP_ORIGIN;
  if (!env.ADMISSION_DB || !origin || !/^https:\/\/[^/?#:@]+$/.test(origin)
    || !/^\d{1,20}$/.test(env.TELEGRAM_BOT_ID ?? '')
    || !/^(?:0|[1-9]\d{0,2})$/.test(env.MINIAPP_LEGACY_USERS ?? '') || Number(env.MINIAPP_LEGACY_USERS) > 480
    || !['waitlist', 'passkey'].includes(env.MINIAPP_ACCESS_MODE ?? '')) throw new AccessError('access_unavailable', 503);
  return { origin, db: env.ADMISSION_DB, legacy: Number(env.MINIAPP_LEGACY_USERS) };
}
function walletApi(env: Env, dependencies: Dependencies) {
  if (env.MINIAPP_ACCESS_MODE !== 'passkey' || env.PRIVY_PUBLIC_SIGNUP_DISABLED !== 'yes'
    || !env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new AccessError('wallet_unavailable', 503);
  return new PrivyWalletApi(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET, dependencies.fetch);
}
function approved(row: Enrollment | null): asserts row is Enrollment & { externalId: string } {
  if (!row?.externalId) throw new AccessError('approval_required', 403);
}
function existingPasskey(row: Enrollment): Passkey {
  const c = row.credential;
  if (!c || !c.backedUp) throw new AccessError('passkey_required', 403);
  return { id: c.credentialID, publicKey: c.publicKey, ownerPublicKey: c.ownerSPKI, counter: c.counter, backedUp: true };
}
const exposedErrors = new Set(['passkey_backup_required', 'passkey_rejected', 'passkey_algorithm_rejected',
  'notification_unavailable', 'notification_rate_limited', 'notification_input_invalid']);
function publicFailure(error: unknown): AccessError {
  if (error instanceof AccessError) return error;
  if (error instanceof Error && exposedErrors.has(error.message)) {
    return new AccessError(error.message, error.message === 'notification_unavailable' ? 503
      : error.message === 'notification_rate_limited' ? 429 : 400);
  }
  return new AccessError('access_unavailable', 503);
}
async function init(db: DB, legacy: number, store: Store, notifications: NotificationStore, operations: Operations) {
  let byBaseline = initialized.get(db);
  if (!byBaseline) { byBaseline = new Map(); initialized.set(db, byBaseline); }
  const key = String(legacy);
  let ready = byBaseline.get(key);
  if (!ready) {
    ready = (async () => { await store.init(legacy); await notifications.init(); await operations.init(); })();
    byBaseline.set(key, ready);
    ready.catch(() => byBaseline!.delete(key));
  }
  await ready;
}
async function publicStatus(store: Store, notifications: NotificationStore, userId: number) {
  const [row, capacity, contact] = await Promise.all([store.status(userId), store.capacity(), notifications.contactStatus(userId)]);
  return { state: row?.state ?? 'new', cohortFull: capacity.used >= capacity.max,
    telegramNotify: row?.telegramNotify ?? false, emailVerified: contact.verified,
    hasCredential: Boolean(row?.credential),
    ...(row?.state === 'ready' ? { wallet: { id: row.walletId, address: row.walletAddress } } : {}) };
}
async function provision(store: Store, userId: number, api: PrivyWalletApi) {
  const row = await store.status(userId); approved(row);
  const passkey = existingPasskey(row);
  const wallet = await api.provision({ externalId: row.externalId, ownerPublicKey: passkey.ownerPublicKey });
  if (row.walletId && (row.walletId !== wallet.id || row.walletAddress !== wallet.address.toLowerCase())) {
    throw new AccessError('wallet_owner_mismatch', 503);
  }
  if (!row.walletId) await store.saveWallet(userId, wallet);
  return { state: 'ready', wallet: { id: wallet.id, address: wallet.address } };
}

async function complete(store: Store, operations: Operations, userId: number, challenge: Challenge,
  response: unknown, origin: string, api: PrivyWalletApi) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new AccessError('request_invalid');
  const claimed = await store.consumeChallenge(userId, challenge.id, challenge.kind);
  if (!claimed) throw new AccessError('approval_expired', 403);
  const row = await store.status(userId); approved(row);
  if (challenge.kind === 'register') {
    let key: Passkey;
    try { key = await verifyRegistration(response as RegistrationResponseJSON, claimed.challenge, origin); }
    catch (error) {
      if (error instanceof Error && error.message === 'passkey_backup_required') throw error;
      throw new AccessError('passkey_rejected', 403);
    }
    const bound = await store.bindCredential(userId, { credentialID: key.id, publicKey: key.publicKey,
      ownerSPKI: key.ownerPublicKey, counter: key.counter, backedUp: true });
    if (!bound) throw new AccessError('passkey_already_registered', 409);
    return provision(store, userId, api);
  }
  if (!row.walletId || !row.walletAddress) throw new AccessError('wallet_unavailable', 503);
  const payload = claimed.payload as SigningPayload;
  const key = existingPasskey(row);
  let assertion: Awaited<ReturnType<typeof verifyApproval>>;
  try { assertion = await verifyApproval(response as AuthenticationResponseJSON, key, claimed.challenge, origin); }
  catch { throw new AccessError('passkey_rejected', 403); }
  if (!await store.updateCounter(userId, key.id, key.counter, assertion.counter)) throw new AccessError('passkey_rejected', 403);
  // Ownership is rechecked; an app-secret alone cannot authorize this action.
  const wallet = await api.provision({ externalId: row.externalId, ownerPublicKey: key.ownerPublicKey });
  if (wallet.id !== row.walletId || wallet.address.toLowerCase() !== row.walletAddress) throw new AccessError('wallet_owner_mismatch', 503);
  const operationContext = api.validatePrepared(payload.prepared, row.walletId);
  await operations.claim(userId, claimed.id, operationContext);
  try {
    const hash = await api.submit(payload.prepared, row.walletId, assertion.authorization);
    await operations.complete(claimed.id, hash);
    return { hash };
  } catch (error) {
    if (error instanceof AccessError && error.code === 'approval_expired') {
      await operations.rejectBeforeDispatch(claimed.id);
      throw error;
    }
    await operations.unknown(claimed.id);
    throw new AccessError('transaction_unknown', 503);
  }
}

/** No browser-returned identity, admission flag, wallet ID, owner key or recipient chooses authority. */
export function createAccessHandler(dependencies: Dependencies = {}) {
  return async (context: Context): Promise<Response> => {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    try {
      const { origin, db, legacy } = configuration(env);
      const url = new URL(request.url);
      if (url.origin !== origin || request.headers.get('origin') !== origin || url.search) throw new AccessError('origin_rejected', 403);
      const body = await readJson(request);
      const action = textField(body.action, 40);
      // Reject unauthenticated Telegram traffic before any database setup/read.
      const capabilityAction = ['email/confirm', 'handoff/read', 'handoff/complete'].includes(action);
      const launch = capabilityAction ? undefined : await verifyTelegramLaunchData(textField(body.launchData), env.TELEGRAM_BOT_ID!, { publicKey: dependencies.publicKey });
      if (launch && !launch.ok) throw new AccessError(launch.reason === 'expired' ? 'launch_expired' : 'launch_rejected', 403);
      const store = new Store(db); const notifications = new NotificationStore(db, env, { fetch: dependencies.fetch });
      const operations = new Operations(db);
      await init(db, legacy, store, notifications, operations);
      const dispatch = () => {
        const work = notifications.dispatch().catch(() => undefined);
        if (context.waitUntil) context.waitUntil(work);
        return work;
      };
      if (action === 'email/confirm') {
        exactKeys(body, ['action', 'token']);
        const userId = await notifications.confirmContact(textField(body.token, 128));
        if (!userId) throw new AccessError('confirmation_expired', 400);
        const row = await store.status(userId);
        if (row?.externalId) await notifications.enqueueInvitation(userId, row.telegramNotify);
        await dispatch();
        return json({ verified: true });
      }
      if (action === 'handoff/read' || action === 'handoff/complete') {
        exactKeys(body, action === 'handoff/read' ? ['action', 'token'] : ['action', 'token', 'response']);
        const token = textField(body.token, 128);
        const api = walletApi(env, dependencies);
        const handoff = action === 'handoff/read' ? await store.readHandoff(token) : await store.claimHandoff(token);
        if (!handoff) throw new AccessError('approval_expired', 403);
        if (action === 'handoff/read') {
          const payload = handoff.challenge.payload as RegistrationPayload & SigningPayload;
          return json({ kind: handoff.challenge.kind, options: payload.options,
            ...(handoff.challenge.kind === 'sign' ? { transaction: payload.transaction } : {}) });
        }
        try {
          const result = await complete(store, operations, handoff.userId, handoff.challenge, body.response, origin, api);
          await store.finishHandoff(token, { status: 'done', result });
          return json(result);
        } catch (error) {
          const failure = publicFailure(error);
          await store.finishHandoff(token, { status: 'error', result: { error: failure.code } });
          throw failure;
        }
      }
      if (!launch?.ok) throw new AccessError('launch_rejected', 403);
      const userId = launch.userId;
      if (action === 'status') {
        exactKeys(body, ['action', 'launchData']);
        return json(await publicStatus(store, notifications, userId));
      }
      if (action === 'join' || action === 'notify') {
        exactKeys(body, ['action', 'launchData', action === 'join' ? 'notify' : 'allowed']);
        const notify = action === 'join' ? body.notify : body.allowed;
        if (typeof notify !== 'boolean') throw new AccessError('request_invalid');
        const row = await store.join(userId, notify);
        if (row.externalId) await notifications.enqueueInvitation(userId, row.telegramNotify);
        await dispatch();
        return json(await publicStatus(store, notifications, userId));
      }
      if (action === 'email/request') {
        exactKeys(body, ['action', 'launchData', 'email']);
        if (!await store.status(userId)) throw new AccessError('join_required', 403);
        const result = await notifications.setContact(userId, textField(body.email, 254));
        await dispatch();
        return json(result);
      }
      if (action === 'handoff/status') {
        exactKeys(body, ['action', 'launchData', 'challengeId']);
        const result = await store.pollHandoff(userId, textField(body.challengeId, 100));
        if (!result) throw new AccessError('approval_expired', 403);
        return json({ state: result.status, result: result.result,
          ...(result.status === 'error' ? { error: (result.result as { error?: string })?.error ?? 'wallet_unavailable' } : {}) });
      }
      const api = walletApi(env, dependencies);
      const row = await store.status(userId); approved(row);
      if (action === 'transaction/status') {
        exactKeys(body, ['action', 'launchData', 'id']);
        const operationId = body.id === undefined ? undefined : textField(body.id, 100);
        let operation = operationId ? await operations.result(userId, operationId) : await operations.pending(userId);
        if (operation && (operation.state === 'dispatching' || operation.state === 'unknown')) {
          const hash = await api.reconcile(operation.context);
          if (hash) {
            await operations.recoverUnknown(userId, operation.id, hash);
            operation = operationId ? await operations.result(userId, operationId) : await operations.pending(userId);
          }
        }
        return json({ operation: operation ? { id: operation.id, state: operation.state,
          hash: operation.hash, acknowledged: operation.acknowledged,
          chainId: operation.context.caip2 === 'eip155:1' ? 1 : 8453 } : null });
      }
      if (action === 'transaction/ack') {
        exactKeys(body, ['action', 'launchData', 'id', 'hash']);
        if (!await operations.acknowledge(userId, textField(body.id, 100), textField(body.hash, 66))) {
          throw new AccessError('transaction_unresolved', 409);
        }
        return json({ acknowledged: true });
      }
      if (action === 'wallet/retry') {
        exactKeys(body, ['action', 'launchData']);
        return json(await provision(store, userId, api));
      }
      if (action === 'register/options') {
        exactKeys(body, ['action', 'launchData']);
        if (Date.now() / 1000 - launch.authDate > 15 * 60) throw new AccessError('launch_expired', 403);
        if (row.credential) throw new AccessError('passkey_already_registered', 409);
        const options = await registrationOptions(new URL(origin).hostname, row.externalId);
        const challenge = await store.issueChallenge(userId, 'register', { options }, Date.now(), options.challenge);
        return json({ challengeId: challenge.id, options });
      }
      if (action === 'sign/options') {
        exactKeys(body, ['action', 'launchData', 'transaction']);
        if (await operations.pending(userId)) throw new AccessError('transaction_unresolved', 409);
        if (!row.walletId || !row.walletAddress) throw new AccessError('wallet_unavailable', 503);
        const key = existingPasskey(row);
        const prepared = api.prepare({ id: row.walletId, address: row.walletAddress, verified: true }, body.transaction, crypto.randomUUID());
        const options = { challenge: prepared.challenge, rpId: new URL(origin).hostname,
          allowCredentials: [{ id: key.id, type: 'public-key' }], userVerification: 'required', timeout: 120_000 };
        const challenge = await store.issueChallenge(userId, 'sign', { prepared, options, transaction: body.transaction }, Date.now(), prepared.challenge);
        return json({ challengeId: challenge.id, options });
      }
      if (action === 'handoff/create') {
        exactKeys(body, ['action', 'launchData', 'challengeId']);
        const token = await store.issueHandoff(userId, textField(body.challengeId, 100));
        return json({ url: `${origin}/wallet-approval#token=${token}` });
      }
      if (action === 'register/complete' || action === 'sign/complete') {
        exactKeys(body, ['action', 'launchData', 'challengeId', 'response']);
        const id = textField(body.challengeId, 100);
        if (action === 'sign/complete') {
          const result = await operations.result(userId, id);
          if (result?.state === 'submitted') return json({ hash: result.hash });
          if (result?.state === 'rejected') throw new AccessError('approval_expired', 403);
          if (result) throw new AccessError('transaction_unknown', 409);
        }
        const challenge = await store.readChallenge(userId, id);
        if (!challenge || challenge.kind !== (action === 'register/complete' ? 'register' : 'sign')) throw new AccessError('approval_expired', 403);
        return json(await complete(store, operations, userId, challenge, body.response, origin, api));
      }
      throw new AccessError('request_invalid');
    } catch (error) {
      const failure = publicFailure(error);
      return json({ error: failure.code }, failure.status);
    }
  };
}

async function operatorAuthorized(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) return false;
  const received = request.headers.get('authorization') ?? '';
  if (received.length > 512) return false;
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(received), digest(`Bearer ${secret}`)]);
  let different = 0; for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
export function createOperatorHandler(dependencies: Dependencies = {}) {
  return async ({ request, env }: Context): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!await operatorAuthorized(request, env.MINIAPP_OPERATOR_TOKEN)) return json({ error: 'unauthorized' }, 401);
    try {
      const { db, legacy, origin } = configuration(env);
      if (new URL(request.url).origin !== origin || new URL(request.url).search) throw new AccessError('request_invalid');
      const body = await readJson(request, 8192); exactKeys(body, ['action', 'userIds']);
      const store = new Store(db); const notifications = new NotificationStore(db, env, { fetch: dependencies.fetch });
      await init(db, legacy, store, notifications, new Operations(db));
      if (body.action === 'list') {
        const rows = await store.enrollments();
        return json({ capacity: await store.capacity(), users: rows.map(row => ({ userId: row.userId, state: row.state, joinedAt: row.joinedAt })) });
      }
      if (body.action === 'approve') {
        // An invitation must not promise a wallet while the passkey service is disabled.
        walletApi(env, dependencies);
        if (!Array.isArray(body.userIds) || body.userIds.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) throw new AccessError('request_invalid');
        let rows: Enrollment[];
        try { rows = await store.approve(body.userIds); }
        catch { throw new AccessError('approval_not_applied', 409); }
        for (const row of rows) await notifications.enqueueInvitation(row.userId, row.telegramNotify);
        return json({ approved: rows.map(row => row.userId), capacity: await store.capacity(), notifications: await notifications.dispatch() });
      }
      if (body.action === 'dispatch') {
        // Reconcile a crash after durable approval but before outbox insertion.
        for (const row of await store.enrollments()) {
          if (row.externalId) await notifications.enqueueInvitation(row.userId, row.telegramNotify);
        }
        return json(await notifications.dispatch());
      }
      throw new AccessError('request_invalid');
    } catch (error) { const failure = publicFailure(error); return json({ error: failure.code }, failure.status); }
  };
}
