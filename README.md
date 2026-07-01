# Mehrin · BTC Wallet Tracker

A full-stack, **installable PWA** that tracks Bitcoin purchases the way Binance
**P2P** actually works:

**AED submitted → USDT received → bought BTC at a price → valued live.**

You enter the real numbers straight off Binance — the AED you submitted and the
USDT you actually received (the P2P rate varies per merchant, so it isn't
computed), then the BTC amount you bought and the price. That BTC is then valued
at the live price and shown as your wallet's USDT balance.

It streams the live **BTC/USDT** price and shows your wallet balance,
profit/loss, and a breakdown of every purchase. The price is fetched
**server-side** and pushed to the browser over SSE, so the client never talks to
Binance directly (no CORS or regional blocks in the browser). Purchases are
stored **server-side in a single JSON file** — no database to run or pay for.

## Stack

| Layer | Tech |
| --- | --- |
| Backend | **Node.js + TypeScript**, Express |
| Storage | **JSON file** on the server (atomic writes, no database) |
| Live price | Server-side Binance WebSocket → **SSE** to the browser (REST fallback) |
| Frontend | TypeScript bundled with esbuild, mobile-first responsive UI, PWA |
| Hosting | Any Node host — **Droplet + Docker** recommended (durable, ~$4–6/mo) |

Everything ships as a single Node service that serves the API *and* the built
client — one deployable, one URL, no database.

## Features

- **Add purchases** — enter AED submitted, USDT received, the BTC bought, and the
  buy price (a `calc` button can estimate BTC from USDT ÷ price; a `live` button
  fills the current price).
- **Live price** — real-time BTC/USDT over SSE with a 24h change and tick flashes.
- **Wallet balance** — total value of all BTC held, in USDT **and** AED (using
  your own blended P2P rate).
- **Profit / Loss** — overall and per-purchase, in value and percent.
- **Stats** — BTC held, total USDT received, total AED submitted, average buy price.
- **Installable PWA** — add to your home screen on Android/Chrome/iOS; offline
  app shell via a service worker.
- **Mobile-first responsive UI** — single column on phones, two-column dashboard
  on tablets/desktop.
- **No database** — purchases persist in a JSON file on the server (`DATA_FILE`),
  written atomically. Point it at a mounted volume to keep it across redeploys.

## The math

You enter the real Binance numbers per purchase: `aedSubmitted`, `usdtReceived`,
`btcAmount`, and `buyPrice`. From those:

```
Wallet balance (USDT) = Σ btcAmount × live BTC price
Wallet balance (AED)  ≈ Wallet (USDT) × (Σ aedSubmitted ÷ Σ usdtReceived)   // your blended P2P rate
Profit / Loss (USDT)  = Wallet (USDT) − Σ usdtReceived
Avg. buy price        = Σ (btcAmount × buyPrice) ÷ Σ btcAmount
```

Nothing is derived from a fixed peg or fee — the USDT you received is taken as-is
because P2P rates vary per trade. The calculation lives in `src/shared/calc.ts`
and is used by **both** the server and the client.

## Project layout

```
src/
  shared/      calc.ts, types.ts      — logic shared by server + client
  server/      index.ts               — Express app (API + static + SPA)
               store.ts               — JSON file store (atomic writes)
               price.ts               — Binance WS price service
               routes/transactions.ts — purchases CRUD
  client/      index.html, styles.css — mobile-first UI
               main.ts                — client logic (API + SSE + PWA)
               manifest.webmanifest, sw.js, icons/
Dockerfile     container image (mounts /data volume for the JSON store)
.do/app.yaml   DigitalOcean App Platform spec
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check (used by DO) |
| `GET` | `/api/price` | Latest price (polling fallback) |
| `GET` | `/api/stream` | SSE live price stream |
| `GET` | `/api/transactions` | List purchases |
| `POST` | `/api/transactions` | Add a purchase |
| `DELETE` | `/api/transactions/:id` | Delete one |
| `DELETE` | `/api/transactions` | Clear all |

## Run locally

You need only Node ≥ 20 — no database.

```bash
npm install
npm run build
npm start                     # http://localhost:8080  (stores ./data/purchases.json)
```

For development with live rebuilds:

```bash
npm run dev                   # rebuilds client, runs server with tsx watch
```

Configure with env vars (all optional): `DATA_FILE` (where the JSON store lives),
`PORT`, `PRICE_SYMBOL`. See `.env.example`.

## Where the data lives

Purchases are written to the JSON file at `DATA_FILE` (default `./data/purchases.json`)
with atomic temp-file-and-rename writes. To keep the data, that path must be on
**durable storage**:

| Host | Durable? | Notes |
| --- | --- | --- |
| **Droplet + Docker volume** | ✅ Yes | Recommended. `-v mehrin-data:/data`, `DATA_FILE=/data/purchases.json`. ~$4–6/mo. |
| Bare Droplet / VPS / your machine | ✅ Yes | The file just sits on disk. |
| **DO App Platform** | ⚠️ No | Filesystem is **ephemeral** — resets on every redeploy/restart. Fine for a demo; use a Droplet for real data. |

## Deploy on a Droplet (recommended — durable + cheapest)

```bash
# on the Droplet (Docker installed):
git clone https://github.com/chordsnstrings/mehrin.git && cd mehrin
docker build -t mehrin .
docker volume create mehrin-data
docker run -d --name mehrin --restart unless-stopped \
  -p 80:8080 -v mehrin-data:/data mehrin
```

Put it behind a reverse proxy (Caddy/Nginx) or Cloudflare for **HTTPS** — which,
with the manifest + service worker, makes it **installable in Chrome**.

> **Region note:** Binance blocks some regions (e.g. the US — you'll see HTTP
> `451`). Deploy where Binance is reachable. Change the market with `PRICE_SYMBOL`.

## Deploy on DigitalOcean App Platform (demo only)

```bash
doctl apps create --spec .do/app.yaml
```

Zero-config and HTTPS out of the box, but remember the filesystem is **ephemeral**
there, so purchases reset on redeploy. Use it to try the app; use a Droplet to
keep your data.

## Installing the PWA (Chrome)

Open the deployed HTTPS URL in Chrome → an **Install** button appears in the app
bar (or use the address-bar install icon / ⋮ menu → *Install app*). Installability
is satisfied by:

- a valid `manifest.webmanifest` with `name`, `short_name`, `start_url`,
  `display: standalone`, and **192px + 512px** PNG icons (plus a maskable icon);
- a registered **service worker** with a `fetch` handler (`sw.js`);
- being served over **HTTPS** (via your reverse proxy / Cloudflare, or App Platform).

## Disclaimer

For personal tracking only. Prices come from Binance's public market data and may
differ from your actual fills. Not financial advice. The deployed app has no
authentication — keep the URL private or add auth before exposing it widely.
