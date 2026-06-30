/* Mehrin — BTC Wallet Tracker (client)
 * Talks to the app's own API for purchases (Postgres-backed) and consumes a
 * server-sent live BTC/USDT price stream. */

import { aggregate, btcBought, usdtReceived, isValidInput } from '../shared/calc';
import type { Purchase, PurchaseInput, PriceTick } from '../shared/types';

// ---- State ----
let transactions: Purchase[] = [];
let livePrice: number | null = null;
let prevPrice: number | null = null;
let change24h: number | null = null;

const REMEMBER_KEY = 'mehrin.lastInputs.v1';

// ---- Element helpers ----
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  livePill: $('livePill'), liveLabel: $('liveLabel'),
  livePrice: $('livePrice'), priceChange: $('priceChange'), priceUpdated: $('priceUpdated'),
  walletUsdt: $('walletUsdt'), walletAed: $('walletAed'),
  plBox: $('plBox'), plValue: $('plValue'), plPct: $('plPct'),
  btcHeld: $('btcHeld'), investedUsdt: $('investedUsdt'),
  avgPrice: $('avgPrice'), investedAed: $('investedAed'),
  form: $<HTMLFormElement>('buyForm'),
  aed: $<HTMLInputElement>('aed'), rate: $<HTMLInputElement>('rate'),
  fee: $<HTMLInputElement>('fee'), buyPrice: $<HTMLInputElement>('buyPrice'),
  useLive: $('useLive'), preview: $('preview'), pvUsdt: $('pvUsdt'), pvBtc: $('pvBtc'),
  txList: $('txList'), txEmpty: $('txEmpty'), clearAll: $('clearAll'),
  submitBtn: $<HTMLButtonElement>('submitBtn'), installBtn: $<HTMLButtonElement>('installBtn'),
};

// ---- Formatting ----
const fmt = (n: number | null, dp: number): string =>
  n == null || !isFinite(n)
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const usd = (n: number | null) => '$' + fmt(n, 2);
const aedFmt = (n: number | null) => 'AED ' + fmt(n, 2);
const btcFmt = (n: number | null) => fmt(n, 8);
const signed = (n: number, f: (x: number) => string) => (n >= 0 ? '+' : '−') + f(Math.abs(n));

// ---- API ----
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function loadTransactions(): Promise<void> {
  try {
    transactions = await api<Purchase[]>('/api/transactions');
  } catch (err) {
    console.warn('Failed to load purchases', err);
    transactions = [];
  }
  render();
}

// ---- Rendering ----
function render(): void {
  const t = aggregate(transactions);
  const price = livePrice;
  const rate = Number(el.rate.value) || 3.6725;

  const valueUsdt = price != null ? t.btc * price : null;
  const valueAed = valueUsdt != null ? valueUsdt * rate : null;

  el.btcHeld.textContent = btcFmt(t.btc);
  el.investedUsdt.textContent = usd(t.investedUsdt);
  el.investedAed.textContent = aedFmt(t.investedAed);
  el.avgPrice.textContent = t.avgPrice != null ? usd(t.avgPrice) : '—';

  el.walletUsdt.textContent = valueUsdt != null ? usd(valueUsdt) : '—';
  el.walletAed.textContent = valueAed != null ? aedFmt(valueAed) : 'AED —';

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

function renderTxList(price: number | null): void {
  el.txList.innerHTML = '';
  const has = transactions.length > 0;
  el.txEmpty.hidden = has;
  el.clearAll.hidden = !has;

  [...transactions].reverse().forEach((tx) => {
    const b = btcBought(tx);
    const cost = usdtReceived(tx);
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
          ${pl == null ? '' : `${signed(pl, usd)} (${signed(plPct as number, (x) => fmt(x, 1) + '%')})`}
        </div>
      </div>
      <button class="tx-del" data-id="${tx.id}" aria-label="Delete purchase">×</button>`;
    el.txList.appendChild(li);
  });

  el.txList.querySelectorAll<HTMLButtonElement>('.tx-del').forEach((btn) => {
    btn.addEventListener('click', () => removeTx(btn.dataset.id as string));
  });
}

// ---- Live price (SSE + polling fallback) ----
function setPill(state: string, label: string): void {
  el.livePill.dataset.state = state;
  el.liveLabel.textContent = label;
}

function applyTick(tick: PriceTick): void {
  if (tick.price == null) return;
  prevPrice = livePrice;
  livePrice = tick.price;
  if (tick.changePercent != null) change24h = tick.changePercent;

  el.livePrice.textContent = usd(livePrice);
  if (prevPrice != null && livePrice !== prevPrice) {
    const cls = livePrice > prevPrice ? 'flash-up' : 'flash-down';
    el.livePrice.classList.remove('flash-up', 'flash-down');
    void el.livePrice.offsetWidth; // restart transition
    el.livePrice.classList.add(cls);
  }
  if (change24h != null) {
    el.priceChange.textContent = signed(change24h, (x) => fmt(x, 2) + '%') + ' (24h)';
    el.priceChange.className = 'chg ' + (change24h >= 0 ? 'up' : 'down');
  }
  el.priceUpdated.textContent = 'Updated ' + new Date(tick.ts).toLocaleTimeString();
  setPill('live', 'Live');
  render();
}

let pollTimer: number | null = null;
function startPolling(): void {
  if (pollTimer != null) return;
  const poll = async () => {
    try {
      const tick = await api<PriceTick>('/api/price');
      if (tick.price != null) applyTick(tick);
      else setPill('error', 'No price');
    } catch {
      setPill('error', 'Offline');
    }
  };
  poll();
  pollTimer = window.setInterval(poll, 5000);
}
function stopPolling(): void {
  if (pollTimer != null) { clearInterval(pollTimer); pollTimer = null; }
}

function connectStream(): void {
  if (!('EventSource' in window)) { startPolling(); return; }
  const es = new EventSource('/api/stream');
  es.onopen = () => stopPolling();
  es.onmessage = (ev) => {
    try { applyTick(JSON.parse(ev.data) as PriceTick); } catch { /* ignore */ }
  };
  es.onerror = () => {
    // EventSource auto-reconnects; meanwhile poll so the price keeps updating.
    if (livePrice == null) setPill('error', 'Reconnecting…');
    startPolling();
  };
}

// ---- Form ----
function readForm(): PurchaseInput {
  return {
    aed: parseFloat(el.aed.value),
    rate: parseFloat(el.rate.value),
    fee: parseFloat(el.fee.value) || 0,
    buyPrice: parseFloat(el.buyPrice.value),
  };
}

function updatePreview(): void {
  const f = readForm();
  const valid = isValidInput(f);
  el.preview.hidden = !valid;
  if (!valid) return;
  el.pvUsdt.textContent = usd(usdtReceived(f));
  el.pvBtc.textContent = btcFmt(btcBought(f)) + ' BTC';
}

async function addTx(e: Event): Promise<void> {
  e.preventDefault();
  const f = readForm();
  if (!isValidInput(f)) return;

  el.submitBtn.disabled = true;
  el.submitBtn.textContent = 'Adding…';
  try {
    const created = await api<Purchase>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(f),
    });
    transactions.push(created);
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ rate: f.rate, fee: f.fee }));
    el.aed.value = '';
    el.buyPrice.value = '';
    el.preview.hidden = true;
    render();
    el.aed.focus();
  } catch (err) {
    alert('Could not save purchase. ' + (err as Error).message);
  } finally {
    el.submitBtn.disabled = false;
    el.submitBtn.textContent = 'Add to wallet';
  }
}

async function removeTx(id: string): Promise<void> {
  const before = transactions;
  transactions = transactions.filter((t) => t.id !== id);
  render();
  try {
    await api<void>(`/api/transactions/${id}`, { method: 'DELETE' });
  } catch (err) {
    transactions = before; // rollback on failure
    render();
    alert('Could not delete. ' + (err as Error).message);
  }
}

async function clearAll(): Promise<void> {
  if (!transactions.length) return;
  if (!confirm('Remove all purchases? This cannot be undone.')) return;
  const before = transactions;
  transactions = [];
  render();
  try {
    await api<void>('/api/transactions', { method: 'DELETE' });
  } catch (err) {
    transactions = before;
    render();
    alert('Could not clear. ' + (err as Error).message);
  }
}

// ---- Wire up ----
el.form.addEventListener('submit', addTx);
(['input', 'change'] as const).forEach((ev) => el.form.addEventListener(ev, updatePreview));
el.useLive.addEventListener('click', () => {
  if (livePrice != null) { el.buyPrice.value = livePrice.toFixed(2); updatePreview(); }
});
el.clearAll.addEventListener('click', clearAll);

// Restore remembered rate/fee
try {
  const last = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
  if (last?.rate) el.rate.value = String(last.rate);
  if (last?.fee != null) el.fee.value = String(last.fee);
} catch { /* ignore */ }

// ---- PWA install prompt (Chrome / Edge / Android) ----
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferredPrompt: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  el.installBtn.hidden = false;
});
el.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  el.installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  el.installBtn.hidden = true;
});

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW failed', e));
  });
}

// ---- Boot ----
render();
loadTransactions();
connectStream();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && livePrice == null) startPolling();
});
