/* Presentation-only account and execution fixtures. NEVER use for transaction construction. */
(function (root) {
  'use strict';
  const VERSION = 4;
  const PRICES = Object.freeze({ ETH: 2400, BTC: 60000, fxUSD: 1, fxSAVE: 1.125, USDC: 1 });
  const copy = value => JSON.parse(JSON.stringify(value));
  const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  function amount(value) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(value))) throw new Error('Enter a positive amount with up to 6 decimals.');
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 10000000) throw new Error('Enter an amount greater than zero.');
    return n;
  }
  function initial() {
    return { version: VERSION, serial: 102, wallet: { ETH: 2.5, fxUSD: 8000, fxSAVE: 4000, USDC: 0 },
      positions: [{ id: '101', asset: 'ETH', equity: 1200, debt: 2400, exposure: 3600 }],
      loan: { collateral: 1.5, debt: 1200 }, queue: null, operations: [] };
  }
  function leverage(p) { return p.equity > 0 ? p.exposure / p.equity : 0; }
  function ltv(p) { return p.exposure > 0 ? p.debt / p.exposure * 100 : 0; }
  function quote(account, kind, values = {}) {
    const a = account, n = kind === 'claim' || kind === 'close' ? 0 : amount(values.amount ?? '1000');
    const market = values.asset === 'BTC' ? 'BTC' : 'ETH';
    const p = copy(a.positions.find(item => item.id === (values.positionId || a.positions[0]?.id)) || null);
    const q = { kind, asset: market, amount: n, fee: 0.00042, approval: false, wallet: {}, before: null, after: null,
      revision: 1, submitted: false, positionId: p?.id, time: Date.now(), minOutput: null };
    if (kind === 'trade') {
      const lev = Number(values.leverage || 3);
      if (![1.5, 2, 3, 4].includes(lev)) throw new Error('Choose an available sample leverage.');
      q.title = `Open ${market} long`; q.result = `${market} long opened`;
      q.after = { asset: market, equity: n, debt: round(n * (lev - 1)), exposure: round(n * lev) };
      q.wallet.fxUSD = -n; q.approval = true; q.approvalAmount = n; q.approvalToken = 'fxUSD';
    } else if (kind === 'deposit') {
      q.asset = 'fxSAVE'; q.title = 'Deposit to fxSAVE'; q.result = 'Deposit complete';
      q.shares = Math.floor(n / PRICES.fxSAVE * 1e6) / 1e6;
      if (q.shares <= 0) throw new Error('Amount is below the sample share precision.');
      q.wallet = { fxUSD: -n, fxSAVE: q.shares }; q.approval = true; q.approvalAmount = n; q.approvalToken = 'fxUSD';
    } else if (kind === 'withdraw') {
      if (a.queue) throw new Error('Finish the existing sample withdrawal first.');
      q.asset = 'fxSAVE'; q.title = 'Request withdrawal'; q.result = 'Withdrawal requested';
      q.wallet = { fxSAVE: -n }; q.claimValue = round(n * PRICES.fxSAVE);
    } else if (kind === 'claim') {
      if (!a.queue?.claimable) throw new Error('The sample withdrawal is not ready to claim.');
      q.asset = 'fxUSD'; q.title = 'Claim withdrawal'; q.result = 'Withdrawal claimed';
      q.amount = a.queue.shares; q.claimValue = a.queue.value;
      q.wallet = { fxUSD: round(a.queue.value * 0.8), USDC: round(a.queue.value * 0.2) };
    } else if (['borrow', 'repay', 'collateral', 'remove'].includes(kind)) {
      q.asset = 'ETH'; q.before = copy(a.loan); q.after = copy(a.loan);
      if (kind === 'borrow') {
        const c = Number(values.collateral || 0);
        if (!Number.isFinite(c) || c < 0) throw new Error('Enter valid collateral.');
        q.title = 'Borrow fxUSD'; q.result = 'fxUSD borrowed'; q.after.collateral = round(a.loan.collateral + c);
        q.after.debt = round(a.loan.debt + n); q.wallet = { ETH: -c, fxUSD: n };
        if (q.after.debt / (q.after.collateral * PRICES.ETH) > 0.65) throw new Error('This preview limits borrowing to 65% loan-to-value.');
      } else if (kind === 'repay') {
        if (n > a.loan.debt) throw new Error('Amount exceeds the remaining debt.');
        q.title = 'Repay fxUSD'; q.result = 'Debt repaid'; q.after.debt = round(a.loan.debt - n);
        q.wallet = { fxUSD: -n }; q.approval = true; q.approvalToken = 'fxUSD'; q.approvalAmount = n;
      } else {
        q.title = kind === 'collateral' ? 'Add collateral' : 'Remove collateral';
        q.result = kind === 'collateral' ? 'Collateral added' : 'Collateral removed';
        q.after.collateral = round(a.loan.collateral + (kind === 'collateral' ? n : -n));
        if (q.after.collateral < 0 || (q.after.debt > 0 && q.after.debt / (q.after.collateral * PRICES.ETH) > 0.65)) throw new Error('Keep enough collateral for the sample loan.');
        q.wallet = { ETH: kind === 'collateral' ? -n : n };
      }
    } else if (['leverage', 'increase', 'reduce', 'close'].includes(kind)) {
      if (!p || p.exposure <= 0) throw new Error('Open a position first.');
      q.before = p; q.after = copy(p); q.asset = p.asset;
      if (kind === 'leverage') {
        const lev = Number(values.leverage || n);
        if (![1.5, 2, 3, 4].includes(lev)) throw new Error('Choose an available sample leverage.');
        q.title = 'Change leverage'; q.result = 'Leverage updated';
        q.after.exposure = round(p.equity * lev); q.after.debt = round(q.after.exposure - p.equity);
      } else if (kind === 'increase') {
        q.title = 'Add to position'; q.result = 'Position increased';
        q.after.equity = round(p.equity + n); q.after.exposure = round(q.after.equity * leverage(p)); q.after.debt = round(q.after.exposure - q.after.equity);
        q.wallet = { fxUSD: -n }; q.approval = true; q.approvalToken = 'fxUSD'; q.approvalAmount = n;
      } else {
        const fraction = kind === 'close' ? 1 : n / 100;
        if (fraction <= 0 || fraction > 1) throw new Error('Choose a percentage up to 100%.');
        q.title = kind === 'close' ? 'Close position' : 'Reduce position'; q.result = fraction === 1 ? 'Position closed' : 'Position reduced';
        for (const k of ['equity', 'debt', 'exposure']) q.after[k] = round(p[k] * (1 - fraction));
        q.wallet = { fxUSD: round(p.equity * fraction) };
      }
    } else { throw new Error('Unknown sample action.'); }
    for (const [token, delta] of Object.entries(q.wallet)) {
      if (delta < 0 && (a.wallet[token] || 0) + delta < -1e-6) throw new Error(`Not enough sample ${token}.`);
    }
    const ethAfter = a.wallet.ETH + (q.wallet.ETH || 0);
    if (ethAfter < q.fee) throw new Error('Keep ETH for the sample network fee.');
    return q;
  }
  function operation(q, serial) { return { id: `sample-${serial}`, quote: copy(q), stage: 'review', approved: !q.approval, signature: null, applied: false, observed: false, feePaid: null, approvalFeePaid: 0, actionFeePaid: 0, updated: Date.now() }; }
  function transition(op, event) {
    const o = copy(op), s = o.stage;
    const fail = () => { throw new Error(`Invalid transition: ${s} → ${event}`); };
    if (event === 'QUOTE_CHANGED' && ['review', 'declined'].includes(s)) { o.previousFee = o.quote.fee; o.quote.fee = round(o.quote.fee + 0.00006); o.quote.revision++; o.stage = 'quote'; }
    else if (event === 'ACCEPT_QUOTE' && s === 'quote') o.stage = 'review';
    else if (event === 'PROCEED' && s === 'review') { o.signature = o.approved ? 'action' : 'approval'; o.stage = 'wallet'; }
    else if (event === 'DECLINE' && s === 'wallet') o.stage = 'declined';
    else if (event === 'REVIEW' && s === 'declined') o.stage = 'review';
    else if (event === 'SIGN' && s === 'wallet') o.stage = o.signature === 'approval' ? 'approving' : 'pending';
    else if (event === 'APPROVED' && (s === 'approving' || (s === 'checking' && o.signature === 'approval'))) { o.approved = true; o.approvalFeePaid = 0.00009; o.stage = 'review'; }
    else if (event === 'CANCEL_REVIEW' && ['review', 'quote', 'declined'].includes(s)) o.stage = 'cancelled';
    else if (event === 'UNKNOWN' && ['pending', 'approving'].includes(s)) o.stage = 'unknown';
    else if (event === 'CHECK' && ['unknown', 'confirmed-unread'].includes(s)) o.stage = s === 'unknown' ? 'checking' : 'refreshing';
    else if (event === 'REVERTED' && s === 'pending') { o.stage = 'reverted'; o.actionFeePaid = o.quote.approval ? 0.00017 : 0.00026; o.feePaid = round(o.actionFeePaid + o.approvalFeePaid); }
    else if (event === 'CONFIRMED_UNREAD' && s === 'pending') { o.stage = 'confirmed-unread'; o.actionFeePaid = o.quote.approval ? 0.00017 : 0.00026; o.feePaid = round(o.actionFeePaid + o.approvalFeePaid); }
    else if (event === 'SETTLED' && ['pending', 'checking', 'refreshing'].includes(s) && o.signature === 'action' && o.approved) { o.stage = 'complete'; o.observed = true; o.actionFeePaid = o.quote.approval ? 0.00017 : 0.00026; o.feePaid = round(o.actionFeePaid + o.approvalFeePaid); }
    else fail();
    o.updated = Date.now(); return o;
  }
  function settle(account, operation) {
    const a = copy(account), o = copy(operation);
    if (o.stage !== 'complete' || !o.observed) throw new Error('A receipt observation is required.');
    const prior = a.operations.find(x => x.id === o.id);
    if (prior?.applied) return a;
    for (const [token, delta] of Object.entries(o.quote.wallet)) a.wallet[token] = round((a.wallet[token] || 0) + delta);
    a.wallet.ETH = round(a.wallet.ETH - o.actionFeePaid);
    const q = o.quote;
    if (q.kind === 'trade') a.positions.unshift({ ...q.after, id: String(a.serial++) });
    else if (['leverage', 'increase', 'reduce', 'close'].includes(q.kind)) a.positions = a.positions.map(p => p.id === q.positionId ? q.after : p);
    else if (['borrow', 'repay', 'collateral', 'remove'].includes(q.kind)) a.loan = q.after;
    else if (q.kind === 'withdraw') a.queue = { operationId: o.id, shares: q.amount, value: q.claimValue, claimable: false };
    else if (q.kind === 'claim') a.queue = null;
    o.applied = true; a.operations = [o, ...a.operations.filter(x => x.id !== o.id)]; return a;
  }
  function applyApproved(account, operation) {
    const a = copy(account), o = copy(operation);
    if (!o.approved || !o.approvalFeePaid) throw new Error('No observed approval.');
    if (!a.operations.find(x => x.id === o.id)?.approvalFeeCharged) a.wallet.ETH = round(a.wallet.ETH - o.approvalFeePaid);
    o.approvalFeeCharged = true; a.operations = [o, ...a.operations.filter(x => x.id !== o.id)]; return a;
  }
  function applyReverted(account, operation) {
    const a = copy(account), o = copy(operation);
    if (o.stage !== 'reverted') throw new Error('Not a reverted operation.');
    if (a.operations.find(x => x.id === o.id)?.applied) return a;
    a.wallet.ETH = round(a.wallet.ETH - o.actionFeePaid); o.applied = true;
    a.operations = [o, ...a.operations.filter(x => x.id !== o.id)]; return a;
  }
  function save(account, storage) { try { storage.setItem('fxaeon-design-v4', JSON.stringify(account)); return true; } catch { return false; } }
  function load(storage) {
    try { const a = JSON.parse(storage.getItem('fxaeon-design-v4'));
      if (a?.version !== VERSION || !Array.isArray(a.operations) || !Array.isArray(a.positions) || !a.wallet || !a.loan || !Number.isInteger(a.serial)) return initial();
      if (!Object.values(a.wallet).every(v => Number.isFinite(v) && v >= 0)) return initial();
      return a;
    } catch { return initial(); }
  }
  const api = { VERSION, PRICES, initial, quote, operation, transition, settle, applyApproved, applyReverted, save, load, leverage, ltv, amount, round };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FxModel = api;
})(typeof window === 'undefined' ? globalThis : window);
