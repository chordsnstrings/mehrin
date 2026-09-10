import type { FundingInput, PurchaseInput } from './types';

/** The BTC held from a purchase (entered directly off Binance). */
export function btcOf(p: PurchaseInput): number {
  return p.btcAmount;
}

/** The cost basis of a purchase, in USDT (what was put in as USDT). */
export function costUsdt(p: PurchaseInput): number {
  return p.usdtReceived;
}

/** Cash available is based on recorded USDT costs, never the live BTC value. */
export function fundingTotals(funding: FundingInput[], purchases: PurchaseInput[]) {
  const round = (value: number) => Math.round(value * 1e8) / 1e8;
  const added = round(funding.reduce((sum, entry) => sum + entry.amount, 0));
  const deployed = round(purchases.reduce((sum, purchase) => sum + costUsdt(purchase), 0));
  return { added, deployed, available: round(added - deployed) };
}

export function isValidFunding(input: unknown): input is FundingInput {
  if (input == null || typeof input !== 'object') return false;
  const amount = (input as Partial<FundingInput>).amount;
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
}

export interface Totals {
  btc: number;
  usdtReceived: number;
  aedSubmitted: number;
  /** Cost-weighted average buy price of the BTC held, or null when none. */
  avgPrice: number | null;
}

/** Aggregate a list of purchases into wallet totals. */
export function aggregate(list: PurchaseInput[]): Totals {
  let btc = 0;
  let usdtReceived = 0;
  let aedSubmitted = 0;
  let costForHeld = 0;
  for (const p of list) {
    btc += p.btcAmount;
    usdtReceived += p.usdtReceived;
    aedSubmitted += p.aedSubmitted;
    costForHeld += p.btcAmount * p.buyPrice;
  }
  return { btc, usdtReceived, aedSubmitted, avgPrice: btc > 0 ? costForHeld / btc : null };
}

/** Blended P2P rate (AED per USDT) implied by all submissions, or null. */
export function blendedRate(t: Totals): number | null {
  return t.usdtReceived > 0 ? t.aedSubmitted / t.usdtReceived : null;
}

/** Validate raw input before persisting. */
export function isValidInput(value: unknown): value is PurchaseInput {
  if (value == null || typeof value !== 'object') return false;
  const p = value as Partial<PurchaseInput>;
  return (
    Number.isFinite(p.aedSubmitted) && (p.aedSubmitted as number) > 0 &&
    Number.isFinite(p.usdtReceived) && (p.usdtReceived as number) > 0 &&
    Number.isFinite(p.btcAmount) && (p.btcAmount as number) > 0 &&
    Number.isFinite(p.buyPrice) && (p.buyPrice as number) > 0
  );
}
