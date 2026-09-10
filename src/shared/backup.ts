import { isValidFunding, isValidInput } from './calc';
import type { Funding, Purchase, WalletData } from './types';

function hasMetadata(value: unknown): value is { id: string; createdAt: string } {
  if (value == null || typeof value !== 'object') return false;
  const record = value as { id?: unknown; createdAt?: unknown };
  return typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128 &&
    typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt));
}

/** Validate the whole backup before restoring anything; accept old purchase arrays. */
export function parseWalletData(value: unknown): WalletData {
  const data = Array.isArray(value) ? { version: 2, purchases: value, funding: [] } : value;
  if (data == null || typeof data !== 'object') throw new Error('Invalid wallet backup.');
  const candidate = data as Partial<WalletData>;
  if (candidate.version !== 2 || !Array.isArray(candidate.purchases) || !Array.isArray(candidate.funding) ||
      !candidate.purchases.every((p) => hasMetadata(p) && isValidInput(p)) ||
      !candidate.funding.every((f) => hasMetadata(f) && isValidFunding(f))) {
    throw new Error('Backup must contain valid purchases and USDT entries.');
  }
  const purchases: Purchase[] = candidate.purchases.map((p) => ({
    id: p.id, createdAt: p.createdAt, aedSubmitted: p.aedSubmitted,
    usdtReceived: p.usdtReceived, btcAmount: p.btcAmount, buyPrice: p.buyPrice,
  }));
  const funding: Funding[] = candidate.funding.map((f) => ({
    id: f.id, createdAt: f.createdAt, amount: f.amount,
  }));
  for (const records of [purchases, funding]) {
    if (new Set(records.map((r) => r.id)).size !== records.length) {
      throw new Error('Backup contains duplicate entry IDs.');
    }
  }
  return { version: 2, purchases, funding };
}
