/** Data shared between the Node server and the browser client. */

export interface PurchaseInput {
  /** AED submitted on Binance P2P. */
  aedSubmitted: number;
  /** USDT actually received from the P2P trade. */
  usdtReceived: number;
  /** BTC amount bought with that USDT. */
  btcAmount: number;
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
