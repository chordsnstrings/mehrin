import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { PriceTick } from '../shared/types';

const SYMBOL = (process.env.PRICE_SYMBOL || 'BTCUSDT').toUpperCase();
const REST = `https://api.binance.com/api/v3/ticker/24hr?symbol=${SYMBOL}`;
const WS_URL = `wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@trade`;

/**
 * Maintains the latest BTC/USDT price on the server by connecting to Binance's
 * trade WebSocket (with a REST seed + polling fallback) and re-broadcasts every
 * tick to subscribers. Because the price is fetched server-side, the browser
 * never talks to Binance directly — avoiding CORS and regional blocks.
 */
class PriceService extends EventEmitter {
  current: PriceTick | null = null;
  private ws: WebSocket | null = null;
  private reconnect = 1000;
  private pollTimer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.seed();
    this.connect();
    // Keep the 24h change fresh even while trade ticks stream in.
    setInterval(() => this.seed(), 60_000);
  }

  /** One-shot REST fetch to seed the price and refresh the 24h change. */
  private async seed(): Promise<void> {
    try {
      const res = await fetch(REST, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { lastPrice: string; priceChangePercent: string };
      this.update(parseFloat(d.lastPrice), parseFloat(d.priceChangePercent));
    } catch (err) {
      if (!this.current) console.warn('[price] seed failed:', (err as Error).message);
    }
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      this.startPolling();
      return;
    }
    this.ws.on('open', () => {
      this.reconnect = 1000;
      this.stopPolling();
      console.log('[price] websocket connected');
    });
    this.ws.on('message', (buf: WebSocket.RawData) => {
      try {
        const d = JSON.parse(buf.toString());
        if (d.p) this.update(parseFloat(d.p), null);
      } catch {
        /* ignore malformed frame */
      }
    });
    this.ws.on('error', () => {
      try { this.ws?.close(); } catch { /* noop */ }
    });
    this.ws.on('close', () => {
      this.ws = null;
      this.startPolling();
      setTimeout(() => this.connect(), this.reconnect);
      this.reconnect = Math.min(this.reconnect * 2, 30_000);
    });
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.seed(), 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private update(price: number, change: number | null): void {
    if (!Number.isFinite(price)) return;
    const tick: PriceTick = {
      price,
      changePercent: change ?? this.current?.changePercent ?? null,
      ts: Date.now(),
    };
    this.current = tick;
    this.emit('tick', tick);
  }
}

export const priceService = new PriceService();
export { SYMBOL };
