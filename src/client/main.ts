/* Mehrin — BTC Wallet Tracker (client)
 * Tracks Binance P2P purchases: AED submitted → USDT received, then BTC bought
 * at a price. The BTC is valued live and shown as the wallet USDT balance. */

import { aggregate, btcOf, costUsdt, blendedRate, isValidInput } from '../shared/calc';
import type { Purchase, PurchaseInput, PriceTick } from '../shared/types';

// ---- State ----
let transactions: Purchase[] = [];
let livePrice: number | null = null;
let prevPrice: number | null = null;
let change24h: number | null = null;

// ---- Element helpers ----
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  livePill: $('livePill'), liveLabel: $('liveLabel'),
  livePrice: $('livePrice'), priceChange: $('priceChange'), priceUpdated: $('priceUpdated'),
  walletUsdt: $('walletUsdt'), walletAed: $('walletAed'),
  plBox: $('plBox'), plValue: $('plValue'), plPct: $('plPct'),
  btcHeld: $('btcHeld'), usdtReceivedTotal: $('usdtReceivedTotal'),
  avgPrice: $('avgPrice'), aedSubmittedTotal: $('aedSubmittedTotal'),
  form: $<HTMLFormElement>('buyForm'),
  aedSubmitted: $<HTMLInputElement>('aedSubmitted'), usdtReceived: $<HTMLInputElement>('usdtReceived'),
  btcAmount: $<HTMLInputElement>('btcAmount'), buyPrice: $<HTMLInputElement>('buyPrice'),
  useLive: $('useLive'), calcBtc: $('calcBtc'),
  preview: $('preview'), pvRate: $('pvRate'), pvCost: $('pvCost'),
  txList: $('txList'), txEmpty: $('txEmpty'), clearAll: $('clearAll'),
  submitBtn: $<HTMLButtonElement>('submitBtn'), installBtn: $<HTMLButtonElement>('installBtn'),
  addFab: $('addFab'), addModal: $('addModal'), emptyAdd: $('emptyAdd'),
  confirmModal: $('confirmModal'), confirmText: $('confirmText'),
  confirmDelete: $<HTMLButtonElement>('confirmDelete'),
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
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
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
  const rate = blendedRate(t); // AED per USDT, from the user's own P2P trades

  // The BTC holding valued live IS the wallet's USDT balance.
  const valueUsdt = price != null ? t.btc * price : null;
  const valueAed = valueUsdt != null && rate != null ? valueUsdt * rate : null;

  el.btcHeld.textContent = btcFmt(t.btc);
  el.usdtReceivedTotal.textContent = usd(t.usdtReceived);
  el.aedSubmittedTotal.textContent = aedFmt(t.aedSubmitted);
  el.avgPrice.textContent = t.avgPrice != null ? usd(t.avgPrice) : '—';

  el.walletUsdt.textContent = valueUsdt != null ? usd(valueUsdt) : '—';
  el.walletAed.textContent = valueAed != null ? '≈ ' + aedFmt(valueAed) : 'AED —';

  // P/L vs the USDT actually put in.
  if (valueUsdt != null && t.usdtReceived > 0) {
    const pl = valueUsdt - t.usdtReceived;
    const plPct = (pl / t.usdtReceived) * 100;
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

let renderedKey = '';

function renderTxList(price: number | null): void {
  const has = transactions.length > 0;
  el.txEmpty.hidden = has;
  el.clearAll.hidden = !has;

  const ordered = [...transactions].reverse();
  const key = ordered.map((t) => t.id).join('|');

  // Rebuild the DOM only when the set of purchases changes — so live price
  // ticks just update the numbers in place (no flicker, no replayed animation).
  if (key !== renderedKey) {
    renderedKey = key;
    el.txList.innerHTML = '';
    ordered.forEach((tx, i) => {
      const li = document.createElement('li');
      li.className = 'tx-item';
      li.dataset.tx = tx.id;
      li.style.setProperty('--i', String(i));
      li.innerHTML = `
        <div class="tx-main">
          <span class="tx-btc">${btcFmt(btcOf(tx))} BTC</span>
          <span class="tx-sub">@ ${usd(tx.buyPrice)} · ${aedFmt(tx.aedSubmitted)} → ${fmt(tx.usdtReceived, 2)} USDT</span>
        </div>
        <div class="tx-value">
          <div class="v"></div>
          <div class="pl"></div>
        </div>
        <button class="tx-del" data-id="${tx.id}" aria-label="Delete purchase">×</button>`;
      el.txList.appendChild(li);
    });
    el.txList.querySelectorAll<HTMLButtonElement>('.tx-del').forEach((btn) => {
      btn.addEventListener('click', () => askDelete(btn.dataset.id as string));
    });
  }

  // Update the live-valued figures on every render.
  ordered.forEach((tx) => {
    const li = el.txList.querySelector<HTMLElement>(`[data-tx="${tx.id}"]`);
    if (!li) return;
    const cost = costUsdt(tx);
    const value = price != null ? btcOf(tx) * price : null;
    const pl = value != null ? value - cost : null;
    const plPct = pl != null && cost > 0 ? (pl / cost) * 100 : null;
    const vEl = li.querySelector<HTMLElement>('.v')!;
    const plEl = li.querySelector<HTMLElement>('.pl')!;
    vEl.textContent = value != null ? usd(value) : '—';
    plEl.className = 'pl ' + (pl == null ? '' : pl >= 0 ? 'up' : 'down');
    plEl.textContent =
      pl == null ? '' : `${signed(pl, usd)} (${signed(plPct as number, (x) => fmt(x, 1) + '%')})`;
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
    if (livePrice == null) setPill('error', 'Reconnecting…');
    startPolling();
  };
}

// ---- Form ----
function readForm(): PurchaseInput {
  return {
    aedSubmitted: parseFloat(el.aedSubmitted.value),
    usdtReceived: parseFloat(el.usdtReceived.value),
    btcAmount: parseFloat(el.btcAmount.value),
    buyPrice: parseFloat(el.buyPrice.value),
  };
}

function updatePreview(): void {
  const f = readForm();
  const valid = isValidInput(f);
  el.preview.hidden = !valid;
  if (!valid) return;
  el.pvRate.textContent = fmt(f.aedSubmitted / f.usdtReceived, 4) + ' AED/USDT';
  el.pvCost.textContent = usd(f.btcAmount * f.buyPrice) + ' USDT';
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
    el.form.reset();
    el.preview.hidden = true;
    render();
    closeModal();
  } catch (err) {
    alert('Could not save purchase. ' + (err as Error).message);
  } finally {
    el.submitBtn.disabled = false;
    el.submitBtn.textContent = 'Add to wallet';
  }
}

// Deletion is protected by a confirmation dialog so a stray tap can't wipe data.
let pendingDeleteId: string | null = null;

function askDelete(id: string): void {
  const tx = transactions.find((t) => t.id === id);
  if (!tx) return;
  pendingDeleteId = id;
  el.confirmText.textContent =
    `${btcFmt(btcOf(tx))} BTC @ ${usd(tx.buyPrice)} · ${aedFmt(tx.aedSubmitted)}. This can't be undone.`;
  el.confirmModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeConfirm(): void {
  el.confirmModal.hidden = true;
  pendingDeleteId = null;
  document.body.style.overflow = '';
}

async function performDelete(id: string): Promise<void> {
  const before = transactions;
  transactions = transactions.filter((t) => t.id !== id);
  render();
  try {
    await api<void>(`/api/transactions/${id}`, { method: 'DELETE' });
  } catch (err) {
    transactions = before;
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

// ---- Add-purchase modal ----
function openModal(): void {
  el.addModal.hidden = false;
  document.body.style.overflow = 'hidden';
  updatePreview();
  setTimeout(() => el.aedSubmitted.focus(), 50);
}
function closeModal(): void {
  el.addModal.hidden = true;
  document.body.style.overflow = '';
}
el.addFab.addEventListener('click', openModal);
el.emptyAdd.addEventListener('click', openModal);
el.addModal.querySelectorAll<HTMLElement>('[data-close]').forEach((n) =>
  n.addEventListener('click', closeModal),
);

// ---- Delete confirmation ----
el.confirmDelete.addEventListener('click', () => {
  const id = pendingDeleteId;
  closeConfirm();
  if (id) performDelete(id);
});
el.confirmModal.querySelectorAll<HTMLElement>('[data-cancel]').forEach((n) =>
  n.addEventListener('click', closeConfirm),
);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.confirmModal.hidden) closeConfirm();
  else if (!el.addModal.hidden) closeModal();
});

// ---- Wire up ----
el.form.addEventListener('submit', addTx);
(['input', 'change'] as const).forEach((ev) => el.form.addEventListener(ev, updatePreview));
el.useLive.addEventListener('click', () => {
  if (livePrice != null) { el.buyPrice.value = livePrice.toFixed(2); updatePreview(); }
});
el.calcBtc.addEventListener('click', () => {
  const usdt = parseFloat(el.usdtReceived.value);
  const price = parseFloat(el.buyPrice.value);
  if (usdt > 0 && price > 0) { el.btcAmount.value = (usdt / price).toFixed(8); updatePreview(); }
});
el.clearAll.addEventListener('click', clearAll);

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
