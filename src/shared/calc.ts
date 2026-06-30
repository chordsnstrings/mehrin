import type { PurchaseInput } from './types';

/** USDT received when the AED is converted (USDT ≈ USD). */
export function usdtReceived(p: PurchaseInput): number {
  return p.rate > 0 ? p.aed / p.rate : 0;
}

/** BTC acquired after the trading fee, given the buy price. */
export function btcBought(p: PurchaseInput): number {
  const usdtForBtc = usdtReceived(p) * (1 - p.fee / 100);
  return p.buyPrice > 0 ? usdtForBtc / p.buyPrice : 0;
}

export interface Totals {
  btc: number;
  investedUsdt: number;
  investedAed: number;
  /** Cost-weighted average buy price of the BTC held, or null when none. */
  avgPrice: number | null;
}

/** Aggregate a list of purchases into wallet totals. */
export function aggregate(list: PurchaseInput[]): Totals {
  let btc = 0;
  let investedUsdt = 0;
  let investedAed = 0;
  let costForHeld = 0;
  for (const p of list) {
    const b = btcBought(p);
    btc += b;
    investedUsdt += usdtReceived(p);
    investedAed += p.aed;
    costForHeld += b * p.buyPrice;
  }
  return { btc, investedUsdt, investedAed, avgPrice: btc > 0 ? costForHeld / btc : null };
}

/** Validate raw input before persisting. */
export function isValidInput(p: Partial<PurchaseInput>): p is PurchaseInput {
  return (
    Number.isFinite(p.aed) && (p.aed as number) > 0 &&
    Number.isFinite(p.rate) && (p.rate as number) > 0 &&
    Number.isFinite(p.fee) && (p.fee as number) >= 0 &&
    Number.isFinite(p.buyPrice) && (p.buyPrice as number) > 0
  );
}
