# Mehrin · BTC Wallet Tracker

A small, installable **PWA** that tracks Bitcoin purchases the way you actually
make them on Binance:

**AED invested → converted to USDT → bought BTC at a price → valued live.**

It streams the live **BTC/USDT** price from Binance and shows your full wallet
balance, profit/loss, and a breakdown of every purchase. No login, no API keys,
no trading — it only *reads* public market prices. All your data stays on your
device.

## What it does

- **Add purchases** — enter the AED you put in, the AED→USD rate (default
  `3.6725`, the pegged rate), the trading fee %, and the BTC price you bought at.
  It computes the USDT received and the exact BTC amount for you.
- **Live price** — BTC/USDT streams in real time over Binance's WebSocket, with
  a REST poll fallback and 24h change.
- **Wallet balance** — total value of all BTC held, shown in both USD/USDT and
  AED, updated on every tick.
- **Profit / Loss** — overall and per-purchase, in value and percent.
- **Stats** — BTC held, total invested (USDT & AED), and average buy price.
- **Installable & offline** — add to your home screen; the app shell works
  offline (live prices need a connection).

## How the numbers work

For each purchase:

```
USDT received = AED invested ÷ (AED/USD rate)
BTC bought    = USDT received × (1 − fee%) ÷ BTC buy price
```

Wallet value, P/L and averages are aggregated across all purchases and
revalued against the live BTC price.

> The AED→USD rate is configurable because USDT is priced in USD and AED is
> pegged to USD at ≈ 3.6725. USDT is treated as ≈ 1 USD.

## Run it locally

It's a static site — any static server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

A server (rather than opening the file directly) is needed so the service
worker and `fetch`/WebSocket calls work.

## Deploy

Push to a branch and enable **GitHub Pages** (or drop the folder on any static
host — Netlify, Vercel, Cloudflare Pages). Everything is plain HTML/CSS/JS with
no build step.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App markup |
| `css/styles.css` | Binance-style dark theme |
| `js/app.js` | Logic: live price, persistence, calculations |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline app shell) |
| `icons/` | App icons |

## Disclaimer

For personal tracking only. Prices come from Binance's public market data and
may differ from your actual fills. Not financial advice.
