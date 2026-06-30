/* Mehrin — BTC Wallet Tracker
 * Tracks AED → USDT → BTC purchases and values them against the live
 * Binance BTC/USDT price. Everything is stored locally on the device. */

(() => {
  'use strict';

  const SYMBOL = 'BTCUSDT';
  const STORAGE_KEY = 'mehrin.tx.v1';
  const SETTINGS_KEY = 'mehrin.settings.v1';
  const REST_TICKER = `https://api.binance.com/api/v3/ticker/24hr?symbol=${SYMBOL}`;
  const WS_URL = `wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@trade`;

  // ---- State ----
  let transactions = load(STORAGE_KEY, []);
  let settings = load(SETTINGS_KEY, { rate: 3.6725, fee: 0.1 });
  let livePrice = null;      // latest BTC/USDT price
  let prevPrice = null;      // for tick flashing
  let change24h = null;      // percent change over 24h
  let ws = null;
  let pollTimer = null;
  let reconnectDelay = 1000;

  // ---- Elements ----
  const $ = (id) => document.getElementById(id);
  const el = {
    livePill: $('livePill'), liveLabel: $('liveLabel'),
    livePrice: $('livePrice'), priceChange: $('priceChange'), priceUpdated: $('priceUpdated'),
    walletUsdt: $('walletUsdt'), walletAed: $('walletAed'),
    plBox: $('plBox'), plValue: $('plValue'), plPct: $('plPct'),
    btcHeld: $('btcHeld'), investedUsdt: $('investedUsdt'),
    avgPrice: $('avgPrice'), investedAed: $('investedAed'),
    form: $('buyForm'), aed: $('aed'), rate: $('rate'), fee: $('fee'), buyPrice: $('buyPrice'),
    useLive: $('useLive'), preview: $('preview'), pvUsdt: $('pvUsdt'), pvBtc: $('pvBtc'),
    txList: $('txList'), txEmpty: $('txEmpty'), clearAll: $('clearAll'),
  };

  // ---- Formatting ----
  const usd = (n) => '$' + fmt(n, 2);
  const aedFmt = (n) => 'AED ' + fmt(n, 2);
  const btcFmt = (n) => fmt(n, 8);
  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function signed(n, fn) { return (n >= 0 ? '+' : '−') + fn(Math.abs(n)); }

  // ---- Storage ----
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
    catch { return fallback; }
  }
  function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  // ---- Transaction math ----
  // Each tx: { id, aed, rate, fee, buyPrice, ts }
  function usdtOf(tx) { return tx.aed / tx.rate; }
  function btcOf(tx) {
    const usdtForBtc = usdtOf(tx) * (1 - tx.fee / 100);
    return tx.buyPrice > 0 ? usdtForBtc / tx.buyPrice : 0;
  }

  function totals() {
    let btc = 0, investedUsdt = 0, investedAed = 0, costForHeld = 0;
    for (const tx of transactions) {
      const b = btcOf(tx);
      btc += b;
      investedUsdt += usdtOf(tx);
      investedAed += tx.aed;
      costForHeld += b * tx.buyPrice; // USDT value at cost for the BTC actually held
    }
    const avgPrice = btc > 0 ? costForHeld / btc : null;
    return { btc, investedUsdt, investedAed, avgPrice };
  }

  // ---- Rendering ----
  function render() {
    const t = totals();
    const price = livePrice;

    // Wallet value: live BTC value + leftover from fees is already excluded.
    const valueUsdt = price != null ? t.btc * price : null;
    const valueAed = valueUsdt != null ? valueUsdt * Number(el.rate.value || settings.rate) : null;

    el.btcHeld.textContent = btcFmt(t.btc);
    el.investedUsdt.textContent = usd(t.investedUsdt);
    el.investedAed.textContent = aedFmt(t.investedAed);
    el.avgPrice.textContent = t.avgPrice != null ? usd(t.avgPrice) : '—';

    el.walletUsdt.textContent = valueUsdt != null ? usd(valueUsdt) : '—';
    el.walletAed.textContent = valueAed != null ? aedFmt(valueAed) : 'AED —';

    // P/L vs invested USDT
    if (valueUsdt != null && t.investedUsdt > 0) {
      const pl = valueUsdt - t.investedUsdt;
      const plPct = (pl / t.investedUsdt) * 100;
      el.plValue.textContent = signed(pl, usd);
      el.plPct.textContent = signed(plPct, (x) => fmt(x, 2) + '%');
      el.plBox.dataset.state = pl > 0 ? 'up' : pl < 0 ? 'down' : 'flat';
    } else {
      el.plValue.textContent = usd(0);
      el.plPct.textContent = '0.00%';
      el.plBox.dataset.state = 'flat';
    }

    renderTxList(price);
  }

  function renderTxList(price) {
    el.txList.innerHTML = '';
    const has = transactions.length > 0;
    el.txEmpty.hidden = has;
    el.clearAll.hidden = !has;

    // newest first
    [...transactions].reverse().forEach((tx) => {
      const b = btcOf(tx);
      const cost = usdtOf(tx);
      const value = price != null ? b * price : null;
      const pl = value != null ? value - cost : null;
      const plPct = pl != null && cost > 0 ? (pl / cost) * 100 : null;

      const li = document.createElement('li');
      li.className = 'tx-item';
      li.innerHTML = `
        <div class="tx-main">
          <span class="tx-btc">${btcFmt(b)} BTC</span>
          <span class="tx-sub">@ ${usd(tx.buyPrice)} · ${aedFmt(tx.aed)}</span>
        </div>
        <div class="tx-value">
          <div class="v">${value != null ? usd(value) : '—'}</div>
          <div class="pl ${pl == null ? '' : pl >= 0 ? 'up' : 'down'}">
            ${pl == null ? '' : `${signed(pl, usd)} (${signed(plPct, (x) => fmt(x, 1) + '%')})`}
          </div>
        </div>
        <button class="tx-del" data-id="${tx.id}" aria-label="Delete purchase">×</button>`;
      el.txList.appendChild(li);
    });

    el.txList.querySelectorAll('.tx-del').forEach((btn) => {
      btn.addEventListener('click', () => removeTx(btn.dataset.id));
    });
  }

  // ---- Live price ----
  function setPill(state, label) {
    el.livePill.dataset.state = state;
    el.liveLabel.textContent = label;
  }

  function applyPrice(price, change) {
    prevPrice = livePrice;
    livePrice = price;
    if (change != null) change24h = change;

    el.livePrice.textContent = usd(price);
    if (prevPrice != null && price !== prevPrice) {
      const cls = price > prevPrice ? 'flash-up' : 'flash-down';
      el.livePrice.classList.remove('flash-up', 'flash-down');
      void el.livePrice.offsetWidth; // restart transition
      el.livePrice.classList.add(cls);
    }
    if (change24h != null) {
      el.priceChange.textContent = signed(change24h, (x) => fmt(x, 2) + '%') + ' (24h)';
      el.priceChange.className = 'chg ' + (change24h >= 0 ? 'up' : 'down');
    }
    el.priceUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    setPill('live', 'Live');
    render();
  }

  async function fetchTicker() {
    try {
      const res = await fetch(REST_TICKER, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      applyPrice(parseFloat(d.lastPrice), parseFloat(d.priceChangePercent));
      return true;
    } catch (err) {
      console.warn('Ticker fetch failed', err);
      return false;
    }
  }

  function connectWs() {
    if (!('WebSocket' in window)) { startPolling(); return; }
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      startPolling();
      return;
    }
    ws.onopen = () => { reconnectDelay = 1000; stopPolling(); };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.p) applyPrice(parseFloat(d.p), null);
      } catch { /* ignore */ }
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onclose = () => {
      ws = null;
      if (livePrice == null) setPill('error', 'Reconnecting…');
      startPolling();
      setTimeout(connectWs, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
  }

  function startPolling() {
    if (pollTimer) return;
    fetchTicker();
    pollTimer = setInterval(fetchTicker, 5000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // Refresh 24h change periodically even while WS streams trades.
  setInterval(() => { if (document.visibilityState === 'visible') fetchTicker(); }, 60000);

  // ---- Form ----
  function readForm() {
    return {
      aed: parseFloat(el.aed.value),
      rate: parseFloat(el.rate.value),
      fee: parseFloat(el.fee.value) || 0,
      buyPrice: parseFloat(el.buyPrice.value),
    };
  }

  function updatePreview() {
    const f = readForm();
    const valid = f.aed > 0 && f.rate > 0 && f.buyPrice > 0;
    el.preview.hidden = !valid;
    if (!valid) return;
    const usdt = f.aed / f.rate;
    const btc = (usdt * (1 - f.fee / 100)) / f.buyPrice;
    el.pvUsdt.textContent = usd(usdt);
    el.pvBtc.textContent = btcFmt(btc) + ' BTC';
  }

  function addTx(e) {
    e.preventDefault();
    const f = readForm();
    if (!(f.aed > 0) || !(f.rate > 0) || !(f.buyPrice > 0)) return;

    transactions.push({
      id: 'tx_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      aed: f.aed, rate: f.rate, fee: f.fee, buyPrice: f.buyPrice, ts: Date.now(),
    });
    save(STORAGE_KEY, transactions);

    // remember rate & fee for next time
    settings = { rate: f.rate, fee: f.fee };
    save(SETTINGS_KEY, settings);

    el.aed.value = '';
    el.buyPrice.value = '';
    el.preview.hidden = true;
    render();
    el.aed.focus();
  }

  function removeTx(id) {
    transactions = transactions.filter((t) => t.id !== id);
    save(STORAGE_KEY, transactions);
    render();
  }

  function clearAll() {
    if (!transactions.length) return;
    if (!confirm('Remove all purchases? This cannot be undone.')) return;
    transactions = [];
    save(STORAGE_KEY, transactions);
    render();
  }

  // ---- Wire up ----
  el.form.addEventListener('submit', addTx);
  ['input', 'change'].forEach((ev) => el.form.addEventListener(ev, updatePreview));
  el.useLive.addEventListener('click', () => {
    if (livePrice != null) { el.buyPrice.value = livePrice.toFixed(2); updatePreview(); }
  });
  el.clearAll.addEventListener('click', clearAll);

  // restore remembered rate/fee
  if (settings.rate) el.rate.value = settings.rate;
  if (settings.fee != null) el.fee.value = settings.fee;

  // Initial paint + data
  render();
  fetchTicker().then((ok) => { if (!ok) setPill('error', 'Offline'); });
  connectWs();

  // Re-sync when returning to the app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!ws || ws.readyState !== WebSocket.OPEN) connectWs();
      fetchTicker();
    }
  });

  // ---- Service worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
    });
  }
})();
