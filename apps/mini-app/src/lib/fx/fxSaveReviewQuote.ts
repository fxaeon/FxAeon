import { FX_TOKENS } from './tokens';
import { ROUTE_PREFETCH_TTL_MS } from './routePrefetch';
import type { PlannedRoute } from './types';

const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
const WAD = 10n ** 18n;
const uint = (raw: unknown): raw is string => typeof raw === 'string' && /^\d{1,78}$/.test(raw) && BigInt(raw) < 1n << 256n;
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Only accepted action metadata is eligible; unrelated config reads cannot
 * replace the fee or output that produced this route's converter minimums. */
export function acceptedFxSaveQuote(route: PlannedRoute, now = Date.now()) {
  const intent = route.policy?.reviewedAction;
  const quote = route.details?.fxSaveQuote;
  if (route.chainId !== 1 || !quote || !intent || !Number.isSafeInteger(now)
    || !Number.isSafeInteger(quote.readAt) || quote.readAt <= 0 || now < quote.readAt || now - quote.readAt >= ROUTE_PREFETCH_TTL_MS
    || !uint(quote.inputAmount) || BigInt(quote.inputAmount) !== ('amount' in intent ? intent.amount : -1n)) return undefined;
  const actions = route.transactions.filter(tx => tx.kind !== 'approval');
  if (actions.length !== 1 || !same(actions[0].to, quote.actionTo) || !same(actions[0].data, quote.actionData)) return undefined;
  const selector = actions[0].data.slice(0, 10).toLowerCase();
  if (quote.kind === 'deposit') {
    if (route.operation !== 'depositFxSave' || intent.kind !== 'fxsave-deposit' || !same(quote.tokenAddress, intent.tokenInAddress)
      || (intent.directBasePool ? !same(quote.actionTo, FX_TOKENS.fxSAVE.address) || selector !== '0x6e553f65'
        : !same(quote.actionTo, ROUTER) || selector !== '0x3ea34dc0')) return undefined;
  } else {
    if (route.operation !== 'withdrawFxSave' || intent.kind !== 'fxsave-withdraw' || !same(quote.tokenAddress, intent.tokenOutAddress)) return undefined;
    if (quote.kind === 'direct-withdraw') {
      if (!intent.directBasePool || intent.instant || !same(quote.actionTo, FX_TOKENS.fxSAVE.address) || selector !== '0xba087652') return undefined;
    } else if (quote.kind === 'instant-withdraw') {
      if (intent.directBasePool || !intent.instant || !same(quote.actionTo, ROUTER) || selector !== '0x6d701088'
        || ![FX_TOKENS.USDC.address, FX_TOKENS.fxUSD.address].some(token => same(token, quote.tokenAddress))
        || !uint(quote.instantFeeRatio) || BigInt(quote.instantFeeRatio) > WAD
        || !uint(quote.grossFxUSD) || !uint(quote.grossUSDC) || !uint(quote.netFxUSD) || !uint(quote.netUSDC)) return undefined;
      const afterFee = (amount: string) => BigInt(amount) * (WAD - BigInt(quote.instantFeeRatio!)) / WAD;
      if (afterFee(quote.grossFxUSD) !== BigInt(quote.netFxUSD) || afterFee(quote.grossUSDC) !== BigInt(quote.netUSDC)) return undefined;
    } else return undefined;
  }
  if (quote.estimatedOutput !== undefined && !uint(quote.estimatedOutput)) return undefined;
  return quote;
}
