/** Data shared between the Node server and the browser client. */

export interface PurchaseInput {
  /** AED amount the user put in. */
  aed: number;
  /** AED per 1 USD (USDT ≈ USD). */
  rate: number;
  /** Trading fee as a percent, e.g. 0.1 for 0.1%. */
  fee: number;
  /** BTC price (in USDT) the purchase was made at. */
  buyPrice: number;
}

export interface Purchase extends PurchaseInput {
  id: string;
  createdAt: string;
}

export interface PriceTick {
  /** Latest BTC/USDT price, or null before the first tick. */
  price: number | null;
  /** 24h change percent, or null if unknown. */
  changePercent: number | null;
  /** Epoch ms of this tick. */
  ts: number;
}
