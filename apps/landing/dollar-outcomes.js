import { startLandingMarketData } from './market-data-client.mjs';

/* Illustrative USD scenarios only. No wallet requests or executable quotes. */
(() => {
  const MAX_AGE_MS = 5 * 60_000;
  const METRICS = ['fxSaveTvlUsd', 'fxSaveApy', 'ethUsd'];
  const SOURCE_NAMES = { aladdin: 'Aladdin', defillama: 'DefiLlama' };
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amounts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const compactDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const money = value => value === null || !Number.isFinite(value) ? '—' : dollars.format(value);
  const compactMoney = value => value < 10_000 ? money(value) : compactDollars.format(value);
  const validAmount = text => {
    const value = text.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/.test(value)) return null;
    const number = Number(value.replaceAll(',', ''));
    return Number.isFinite(number) && number >= 1 && number <= 1_000_000 ? number : null;
  };
  const freshMetric = (metric, key, now) => {
    if (!metric || metric.status !== 'fresh' || typeof metric.value !== 'number' || !Number.isFinite(metric.value)) return null;
    const price = key === 'ethUsd' || key === 'btcUsd';
    if (price ? metric.value <= 0 : metric.value < 0) return null;
    const observedAt = price ? metric.sourceAt : metric.fetchedAt;
    if (typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt <= 0 || observedAt > now + 120_000 || now - observedAt >= MAX_AGE_MS) return null;
    return metric.value;
  };
  const init = () => {
    const input = document.getElementById('dollar-amount');
    const calculator = document.querySelector('[data-dollar-calculator]');
    const leverageInput = document.getElementById('example-leverage');
    if (!input || !calculator || !leverageInput) return;
    let snapshot = window.__fxaeonMarketData ?? null;
    let initialWaitExpired = false;
    let selected = 'earn';
    let marketData = null;
    let refreshingData = false;
    let expiryTimer;
    const refreshButton = document.querySelector('[data-market-refresh]');
    const tabs = Array.from(document.querySelectorAll('[data-outcome-tab]'));
    const presets = Array.from(document.querySelectorAll('[data-dollar-preset]'));
    const setText = (selector, value) => document.querySelectorAll(selector).forEach(node => { if (node.textContent !== value) node.textContent = value; });
    const render = () => {
      const now = Date.now();
      const checkingData = refreshingData || snapshot?.status === 'loading' || (!snapshot && !initialWaitExpired);
      const values = Object.fromEntries(METRICS.map(key => [key, freshMetric(snapshot?.[key], key, now)]));
      if (refreshButton) {
        const unavailable = METRICS.some(key => values[key] === null && (snapshot?.[key]?.status === 'unavailable' || snapshot?.[key]?.status === 'fresh'));
        refreshButton.hidden = !unavailable && !refreshingData;
        refreshButton.disabled = checkingData;
        refreshButton.setAttribute('aria-busy', String(checkingData));
        refreshButton.textContent = checkingData ? 'Checking live data…' : 'Retry live data';
      }
      METRICS.forEach(key => {
        const value = values[key];
        const waiting = !initialWaitExpired && (!snapshot?.[key] || snapshot[key].status === 'loading');
        const label = value === null ? '—' : key === 'fxSaveApy' ? amounts.format(value) + '%' : key === 'fxSaveTvlUsd' ? compactMoney(value) : money(value);
        setText('[data-market-value="' + key + '"]', label);
        const node = document.querySelector('[data-market-value="' + key + '"]');
        const metric = snapshot?.[key];
        const source = SOURCE_NAMES[metric?.source];
        const observedAt = key === 'ethUsd' || key === 'btcUsd' ? metric?.sourceAt : metric?.fetchedAt;
        const timestamp = typeof observedAt === 'number' && Number.isFinite(observedAt) && observedAt > 0 && observedAt <= now + 120_000 ? clock.format(observedAt) + ' UTC' : null;
        if (node) node.title = [source, key === 'btcUsd' ? 'WBTC indicative USD price' : null, timestamp ? (key === 'ethUsd' || key === 'btcUsd' ? 'Price updated ' : 'Checked ') + timestamp : null].filter(Boolean).join(' · ');
        setText('[data-market-state="' + key + '"]', value === null ? waiting ? 'Loading' : 'Unavailable' : key === 'fxSaveApy' ? 'Annual percentage yield' : key === 'fxSaveTvlUsd' ? 'Vault assets · USD' : 'Indicative · USD');
      });
      const amount = validAmount(input.value);
      input.setAttribute('aria-invalid', String(amount === null));
      input.setAttribute('aria-describedby', amount === null ? 'amount-context amount-error' : 'amount-context');
      document.getElementById('amount-error').hidden = amount !== null;
      input.size = Math.max(3, Math.min(10, input.value.length || 1));
      presets.forEach(button => button.setAttribute('aria-pressed', String(amount !== null && amount === Number(button.dataset.dollarPreset))));
      const leverage = Math.min(5, Math.max(1.1, Number(leverageInput.value) || 2));
      const leverageLabel = amounts.format(leverage) + '×';
      const exposure = amount === null ? null : amount * leverage;
      const effect = exposure === null ? null : exposure * .1;
      const percent = amounts.format(leverage * 10);
      setText('[data-earn-deposit]', money(amount));
      const apy = values.fxSaveApy;
      const projection = amount === null || apy === null ? null : amount * (1 + apy / 100);
      setText('[data-earn-projection]', money(projection));
      const waitingApy = !initialWaitExpired && (!snapshot?.fxSaveApy || snapshot.fxSaveApy.status === 'loading');
      setText('[data-earn-apy]', apy === null ? '—' : amounts.format(apy) + '%');
      setText('[data-earn-gain]', projection === null ? '—' : '+' + money(projection - amount));
      setText('[data-earn-caption]', amount === null ? 'Enter an amount' : apy === null ? (waitingApy ? 'Waiting for a fresh APY' : 'Fresh APY unavailable') : 'At ' + amounts.format(apy) + '% APY, unchanged for 1 year');
      const apyCheckedAt = snapshot?.fxSaveApy?.fetchedAt;
      setText('[data-earn-checked]', apy !== null ? 'APY checked ' + clock.format(apyCheckedAt) + ' UTC' : waitingApy ? 'Loading APY…' : 'Live APY unavailable');
      document.querySelectorAll('[data-earn-result], [data-earn-projection], [data-earn-caption]').forEach(node => { node.toggleAttribute('hidden', projection === null); });
      document.querySelector('[data-earn-availability]').hidden = projection !== null;
      setText('[data-earn-status]', amount === null ? 'Enter a starting value' : waitingApy ? 'Loading current APY…' : 'Live APY unavailable');
      setText('[data-earn-status-detail]', amount === null ? 'Your one-year estimate will appear here.' : waitingApy ? 'A fresh rate is needed to estimate earnings.' : 'Try live data again, or open Earn to view the vault.');
      setText('[data-borrow-output]', money(amount === null ? null : amount * .5));
      setText('[data-borrow-collateral]', money(amount));
      setText('[data-trade-exposure]', money(exposure));
      setText('[data-trade-up]', effect === null ? '—' : '+' + money(effect));
      setText('[data-trade-down]', effect === null ? '—' : '−' + money(effect));
      setText('[data-trade-up-percent]', '+' + percent + '% of starting value');
      setText('[data-trade-down-percent]', '−' + percent + '% of starting value');
      const units = exposure !== null && values.ethUsd !== null ? exposure / values.ethUsd : null;
      const waitingEth = !initialWaitExpired && (!snapshot?.ethUsd || snapshot.ethUsd.status === 'loading');
      setText('[data-trade-checked]', values.ethUsd !== null ? 'Updated ' + clock.format(snapshot.ethUsd.sourceAt) + ' UTC' : waitingEth ? 'Loading price…' : 'Live price unavailable');
      const unitText = units === null ? amount === null ? 'Enter an amount' : waitingEth ? 'USD exposure · ETH price loading' : 'USD exposure · fresh ETH price unavailable' : '≈ ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(units) + ' ETH at ' + money(values.ethUsd) + ' / ETH';
      setText('[data-trade-units]', unitText);
      document.getElementById('leverage-value').textContent = leverageLabel;
      leverageInput.setAttribute('aria-valuetext', amounts.format(leverage) + ' times leverage');
      leverageInput.style.setProperty('--range-fill', ((leverage - 1.1) / (5 - 1.1) * 100) + '%');
      window.clearTimeout(expiryTimer);
      const deadlines = METRICS.filter(key => values[key] !== null).map(key => (key === 'ethUsd' || key === 'btcUsd' ? snapshot[key].sourceAt : snapshot[key].fetchedAt) + MAX_AGE_MS);
      if (deadlines.length) expiryTimer = window.setTimeout(render, Math.max(1, Math.min(...deadlines) - now + 1));
    };
    const selectTab = (name, focus = false) => {
      if (!tabs.some(tab => tab.dataset.outcomeTab === name)) return;
      selected = name;
      tabs.forEach(tab => {
        const active = tab.dataset.outcomeTab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !active;
        if (active && focus) tab.focus();
      });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.outcomeTab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
        selectTab(tabs[next].dataset.outcomeTab, true);
      });
    });
    input.addEventListener('input', render);
    input.addEventListener('blur', () => { const amount = validAmount(input.value); if (amount !== null) input.value = amounts.format(amount); render(); });
    presets.forEach(button => button.addEventListener('click', () => { input.value = amounts.format(Number(button.dataset.dollarPreset)); render(); }));
    leverageInput.addEventListener('input', render);
    document.querySelectorAll('[data-open-outcome]').forEach(link => link.addEventListener('click', () => selectTab(link.dataset.openOutcome)));
    window.addEventListener('fxaeon:market-data', event => { snapshot = event.detail && typeof event.detail === 'object' ? event.detail : null; render(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
    window.addEventListener('pageshow', render);
    window.setTimeout(() => { initialWaitExpired = true; render(); }, 10_000);
    render();
    marketData = startLandingMarketData();
    refreshButton?.addEventListener('click', async () => {
      if (!marketData || refreshingData) return;
      refreshingData = true;
      render();
      try { await marketData.refresh(); } finally { refreshingData = false; render(); }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
