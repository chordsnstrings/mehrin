/* Mehrin — BTC Wallet Tracker (client)
 * Tracks Binance P2P purchases: AED submitted → USDT received, then BTC bought
 * at a price. Manual funding tracks USDT available separately from BTC value. */

import { aggregate, btcOf, costUsdt, blendedRate, isValidInput, fundingTotals, isValidFunding } from '../shared/calc';
import { parseWalletData } from '../shared/backup';
import type { Funding, Purchase, PurchaseInput, PriceTick, WalletData } from '../shared/types';

// ---- State ----
let transactions: Purchase[] = [];
let funding: Funding[] = [];
let walletLoaded = false;
let savingPurchase = false;
let savingFunding = false;
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
  fundingCard: $('fundingCard'), usdtAvailable: $('usdtAvailable'),
  usdtAdded: $('usdtAdded'), usdtDeployed: $('usdtDeployed'), fundingHint: $('fundingHint'),
  fundingHistory: $('fundingHistory'), fundingSummary: $('fundingSummary'), fundingList: $('fundingList'),
  addFunding: $<HTMLButtonElement>('addFunding'), fundingModal: $('fundingModal'),
  fundingForm: $<HTMLFormElement>('fundingForm'), fundingAmount: $<HTMLInputElement>('fundingAmount'),
  fundingPreview: $('fundingPreview'), fundingSubmit: $<HTMLButtonElement>('fundingSubmit'),
  plBox: $('plBox'), plValue: $('plValue'), plPct: $('plPct'),
  btcHeld: $('btcHeld'), usdtReceivedTotal: $('usdtReceivedTotal'),
  avgPrice: $('avgPrice'), aedSubmittedTotal: $('aedSubmittedTotal'),
  form: $<HTMLFormElement>('buyForm'),
  aedSubmitted: $<HTMLInputElement>('aedSubmitted'), usdtReceived: $<HTMLInputElement>('usdtReceived'),
  btcAmount: $<HTMLInputElement>('btcAmount'), buyPrice: $<HTMLInputElement>('buyPrice'),
  useLive: $('useLive'), calcBtc: $('calcBtc'),
  preview: $('preview'), pvRate: $('pvRate'), pvCost: $('pvCost'), pvAvailable: $('pvAvailable'),
  txList: $('txList'), txEmpty: $('txEmpty'), clearAll: $('clearAll'),
  submitBtn: $<HTMLButtonElement>('submitBtn'), installBtn: $<HTMLButtonElement>('installBtn'),
  addFab: $('addFab'), addModal: $('addModal'), emptyAdd: $('emptyAdd'),
  confirmModal: $('confirmModal'), confirmText: $('confirmText'),
  confirmDelete: $<HTMLButtonElement>('confirmDelete'),
  exportBtn: $('exportBtn'), importBtn: $('importBtn'),
  importFile: $<HTMLInputElement>('importFile'), toast: $('toast'),
};

// ---- Formatting ----
const fmt = (n: number | null, dp: number): string =>
  n == null || !isFinite(n)
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const usdtFmt = (n: number) => fmt(n, 2) + ' USDT';
const usd = (n: number | null) => '$' + fmt(n, 2);
const aedFmt = (n: number | null) => 'AED ' + fmt(n, 2);
const btcFmt = (n: number | null) => fmt(n, 8);
const signed = (n: number, f: (x: number) => string) => (n >= 0 ? '+' : '−') + f(Math.abs(n));

// ---- API ----
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// ---- Local backup mirror (purchases and funding travel together) ----
const MIRROR_KEY = 'mehrin.backup.v2';
const LEGACY_MIRROR_KEY = 'mehrin.backup.v1';
const emptyWallet = (): WalletData => ({ version: 2, purchases: [], funding: [] });
const walletData = (): WalletData => ({ version: 2, purchases: transactions, funding });

function loadMirror(): WalletData {
  try {
    const saved = localStorage.getItem(MIRROR_KEY) ?? localStorage.getItem(LEGACY_MIRROR_KEY);
    return saved ? parseWalletData(JSON.parse(saved)) : emptyWallet();
  } catch { return emptyWallet(); }
}

function saveMirror(): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(walletData()));
    localStorage.removeItem(LEGACY_MIRROR_KEY);
  } catch { /* quota/full */ }
}

function setWallet(data: WalletData): void {
  transactions = data.purchases;
  funding = data.funding;
}

async function loadWallet(): Promise<void> {
  try {
    let server = parseWalletData(await api<WalletData>('/api/wallet'));
    const mirror = loadMirror();
    // Restore only a wholly empty wallet, never a deliberately empty ledger alone.
    if (!server.purchases.length && !server.funding.length &&
        (mirror.purchases.length || mirror.funding.length)) {
      server = await api<WalletData>('/api/wallet/restore', { method: 'POST', body: JSON.stringify(mirror) });
      showToast('Restored purchases and USDT entries from backup');
    }
    setWallet(server);
    saveMirror();
  } catch (err) {
    console.warn('Failed to load wallet', err);
    setWallet(loadMirror());
    showToast('Showing saved data. Reconnect to update your wallet.');
  }
  walletLoaded = true;
  render();
}

// ---- Rendering ----
function render(): void {
  el.addFunding.disabled = !walletLoaded;
  el.submitBtn.disabled = !walletLoaded || savingPurchase;
  el.fundingSubmit.disabled = !walletLoaded || savingFunding;
  const t = aggregate(transactions);
  const price = livePrice;
  const rate = blendedRate(t); // AED per USDT, from the user's own P2P trades

  // BTC value is separate from the cash available to deploy.
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

  el.exportBtn.hidden = transactions.length === 0 && funding.length === 0;
  renderFunding();
  renderTxList(price);
  updatePreview();
  updateFundingPreview();
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
        <button class="tx-del" aria-label="Delete purchase">×</button>`;
      li.querySelector<HTMLButtonElement>('.tx-del')!.dataset.id = tx.id;
      el.txList.appendChild(li);
    });
    el.txList.querySelectorAll<HTMLButtonElement>('.tx-del').forEach((btn) => {
      btn.addEventListener('click', () => askDelete(btn.dataset.id as string));
    });
  }

  // Update the live-valued figures on every render.
  ordered.forEach((tx) => {
    const li = el.txList.querySelector<HTMLElement>(`[data-tx="${CSS.escape(tx.id)}"]`);
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

// ---- Manual USDT entries ----
let renderedFundingKey = '';

function renderFunding(): void {
  const cash = fundingTotals(funding, transactions);
  el.usdtAvailable.textContent = walletLoaded ? fmt(cash.available, 2) : '—';
  el.usdtAdded.textContent = walletLoaded ? usdtFmt(cash.added) : '—';
  el.usdtDeployed.textContent = walletLoaded ? usdtFmt(cash.deployed) : '—';
  el.fundingCard.dataset.state = cash.available < 0 ? 'negative' : 'normal';
  el.fundingHint.textContent = !walletLoaded
    ? 'Loading your USDT balance…'
    : cash.available < 0
      ? `Recorded purchases exceed your funding by ${usdtFmt(-cash.available)}. Add any missing USDT entries.`
      : !funding.length
        ? 'Add your USDT funding to start tracking the amount available.'
        : 'Total USDT added minus USDT deployed in your purchases.';
  el.fundingHistory.hidden = funding.length === 0;
  el.fundingSummary.textContent = `USDT entries · ${funding.length}`;
  const ordered = [...funding].reverse();
  const key = JSON.stringify(ordered);
  if (key === renderedFundingKey) return;
  renderedFundingKey = key;
  el.fundingList.replaceChildren();
  for (const entry of ordered) {
    const li = document.createElement('li');
    li.className = 'tx-item funding-item';
    const main = document.createElement('div');
    main.className = 'tx-main';
    const amount = document.createElement('span');
    amount.className = 'tx-btc';
    amount.textContent = '+' + usdtFmt(entry.amount);
    const date = document.createElement('span');
    date.className = 'tx-sub';
    date.textContent = new Date(entry.createdAt).toLocaleString();
    main.append(amount, date);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tx-del';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete USDT entry of ${usdtFmt(entry.amount)}`);
    remove.addEventListener('click', () => askDeleteFunding(entry.id));
    li.append(main, remove);
    el.fundingList.append(li);
  }
}

function updateFundingPreview(): void {
  const amount = Number(el.fundingAmount.value);
  const entries = isValidFunding({ amount }) ? [...funding, { amount }] : funding;
  const available = fundingTotals(entries, transactions).available;
  el.fundingPreview.textContent = walletLoaded ? usdtFmt(available) : '—';
  el.fundingPreview.parentElement!.dataset.state = available < 0 ? 'negative' : 'normal';
}

function openFundingModal(): void {
  el.fundingModal.hidden = false;
  document.body.style.overflow = 'hidden';
  updateFundingPreview();
  el.fundingAmount.focus();
}

function closeFundingModal(): void {
  if (savingFunding) return;
  el.fundingModal.hidden = true;
  document.body.style.overflow = '';
  el.addFunding.focus();
}

async function addFunding(e: Event): Promise<void> {
  e.preventDefault();
  if (!walletLoaded || savingFunding) return;
  const input = { amount: Number(el.fundingAmount.value) };
  if (!isValidFunding(input)) {
    el.fundingAmount.setCustomValidity('Enter a USDT amount greater than zero.');
    el.fundingAmount.reportValidity();
    return;
  }
  savingFunding = true;
  el.fundingSubmit.disabled = true;
  el.fundingSubmit.textContent = 'Adding…';
  try {
    const created = await api<Funding>('/api/funding', { method: 'POST', body: JSON.stringify(input) });
    funding.push(created);
    saveMirror();
    el.fundingForm.reset();
    savingFunding = false;
    closeFundingModal();
    showToast(`${usdtFmt(created.amount)} added`);
  } catch (err) {
    alert('Could not save USDT entry. ' + (err as Error).message);
  } finally {
    savingFunding = false;
    el.fundingSubmit.textContent = 'Add USDT';
    render();
  }
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
  el.pvCost.textContent = usdtFmt(f.btcAmount * f.buyPrice);
  const available = fundingTotals(funding, [...transactions, f]).available;
  el.pvAvailable.textContent = usdtFmt(available);
  el.pvAvailable.parentElement!.dataset.state = available < 0 ? 'negative' : 'normal';
}

async function addTx(e: Event): Promise<void> {
  e.preventDefault();
  const f = readForm();
  if (!isValidInput(f) || !walletLoaded || savingPurchase) return;

  savingPurchase = true;
  el.submitBtn.disabled = true;
  el.submitBtn.textContent = 'Adding…';
  try {
    const created = await api<Purchase>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(f),
    });
    transactions.push(created);
    saveMirror();
    el.form.reset();
    el.preview.hidden = true;
    render();
    closeModal();
  } catch (err) {
    alert('Could not save purchase. ' + (err as Error).message);
  } finally {
    savingPurchase = false;
    el.submitBtn.disabled = false;
    el.submitBtn.textContent = 'Add to wallet';
  }
}

// Deletion is protected by a confirmation dialog so a stray tap can't wipe data.
let pendingDelete: { kind: 'purchase' | 'funding'; id: string } | null = null;

function askDelete(id: string): void {
  const tx = transactions.find((t) => t.id === id);
  if (!tx) return;
  pendingDelete = { kind: 'purchase', id };
  $('confirmTitle').textContent = 'Delete this purchase?';
  el.confirmText.textContent =
    `${btcFmt(btcOf(tx))} BTC @ ${usd(tx.buyPrice)} · ${aedFmt(tx.aedSubmitted)}. This returns ${usdtFmt(costUsdt(tx))} to the available balance. This can't be undone.`;
  el.confirmModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function askDeleteFunding(id: string): void {
  const entry = funding.find((f) => f.id === id);
  if (!entry) return;
  pendingDelete = { kind: 'funding', id };
  $('confirmTitle').textContent = 'Delete this USDT entry?';
  el.confirmText.textContent = `This removes ${usdtFmt(entry.amount)} from your total funding and available balance. Purchases stay recorded. This can't be undone.`;
  el.confirmModal.hidden = false;
  document.body.style.overflow = 'hidden';
  $('confirmCancel').focus();
}

async function performDeleteFunding(id: string): Promise<void> {
  try {
    await api<void>(`/api/funding/${encodeURIComponent(id)}`, { method: 'DELETE' });
    funding = funding.filter((entry) => entry.id !== id);
    saveMirror();
    render();
  } catch (err) { alert('Could not delete USDT entry. ' + (err as Error).message); }
}

function closeConfirm(): void {
  el.confirmModal.hidden = true;
  pendingDelete = null;
  document.body.style.overflow = '';
}

async function performDelete(id: string): Promise<void> {
  const before = transactions;
  transactions = transactions.filter((t) => t.id !== id);
  render();
  try {
    await api<void>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    saveMirror();
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
    saveMirror(); // Clear purchases in the backup while retaining funding.
  } catch (err) {
    transactions = before;
    render();
    alert('Could not clear. ' + (err as Error).message);
  }
}

// ---- Toast ----
let toastTimer: number | null = null;
function showToast(msg: string): void {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('show'));
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => { el.toast.hidden = true; }, 300);
  }, 3200);
}

// ---- Export / Import ----
function exportData(): void {
  if (!transactions.length && !funding.length) return;
  const blob = new Blob([JSON.stringify(walletData(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mehrin-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
}

async function importData(file: File): Promise<void> {
  let backup: WalletData;
  try {
    backup = parseWalletData(JSON.parse(await file.text()));
  } catch (err) {
    alert('Could not read backup. ' + (err as Error).message);
    return;
  }
  if (!backup.purchases.length && !backup.funding.length) {
    alert('No purchases or USDT entries found in that file.');
    return;
  }
  if (!confirm(`Import ${backup.purchases.length} purchases and ${backup.funding.length} USDT entries? Existing entries will be kept and matching IDs will not be duplicated.`)) return;
  try {
    const restored = await api<WalletData>('/api/wallet/restore', {
      method: 'POST', body: JSON.stringify(backup),
    });
    setWallet(restored);
    saveMirror();
    render();
    showToast('Backup imported');
  } catch (err) { alert('Could not import backup. ' + (err as Error).message); }
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
  const pending = pendingDelete;
  closeConfirm();
  if (pending?.kind === 'purchase') performDelete(pending.id);
  if (pending?.kind === 'funding') performDeleteFunding(pending.id);
});
el.confirmModal.querySelectorAll<HTMLElement>('[data-cancel]').forEach((n) =>
  n.addEventListener('click', closeConfirm),
);

// ---- Export / Import ----
el.exportBtn.addEventListener('click', exportData);
el.importBtn.addEventListener('click', () => el.importFile.click());
el.importFile.addEventListener('change', () => {
  const file = el.importFile.files?.[0];
  if (file) importData(file);
  el.importFile.value = ''; // allow re-importing the same file
});

document.addEventListener('keydown', (e) => {
  const modal = !el.confirmModal.hidden ? el.confirmModal : !el.fundingModal.hidden ? el.fundingModal : !el.addModal.hidden ? el.addModal : null;
  if (e.key === 'Tab' && modal) {
    const focusable = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  if (e.key !== 'Escape') return;
  if (!el.confirmModal.hidden) closeConfirm();
  else if (!el.fundingModal.hidden) closeFundingModal();
  else if (!el.addModal.hidden) closeModal();
});

// ---- Wire up ----
el.addFunding.addEventListener('click', openFundingModal);
el.fundingForm.addEventListener('submit', addFunding);
el.fundingAmount.addEventListener('input', () => {
  el.fundingAmount.setCustomValidity('');
  updateFundingPreview();
});
el.fundingModal.querySelectorAll<HTMLElement>('[data-close-funding]').forEach((n) =>
  n.addEventListener('click', closeFundingModal),
);
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
loadWallet();
connectStream();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && livePrice == null) startPolling();
});
