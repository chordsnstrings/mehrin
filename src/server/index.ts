import path from 'path';
import express from 'express';
import { migrate, hasDatabase, pool } from './db';
import { priceService, SYMBOL } from './price';
import { transactionsRouter } from './routes/transactions';
import type { PriceTick } from '../shared/types';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- Health (used by DigitalOcean's health checks) ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: hasDatabase, symbol: SYMBOL, price: priceService.current?.price ?? null });
});

// --- Latest price (polling fallback for the SSE stream) ---
app.get('/api/price', (_req, res) => {
  res.json(priceService.current ?? { price: null, changePercent: null, ts: Date.now() });
});

// --- Server-Sent Events: live price pushed to the browser ---
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (DO / nginx)
  });

  const send = (tick: PriceTick) => res.write(`data: ${JSON.stringify(tick)}\n\n`);
  if (priceService.current) send(priceService.current);

  const onTick = (tick: PriceTick) => send(tick);
  priceService.on('tick', onTick);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    priceService.off('tick', onTick);
  });
});

app.use('/api/transactions', transactionsRouter);

// --- Static client + SPA fallback ---
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// --- Central error handler ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = Number(process.env.PORT) || 8080;

async function main(): Promise<void> {
  if (hasDatabase) {
    try {
      await migrate();
      console.log('[db] schema ready');
    } catch (err) {
      console.error('[db] migration failed — transaction endpoints will be unavailable:', (err as Error).message);
    }
  } else {
    console.warn('[db] DATABASE_URL not set — running without persistence.');
  }

  priceService.start();

  app.listen(PORT, () => console.log(`Mehrin listening on :${PORT} (symbol ${SYMBOL})`));
}

function shutdown(): void {
  console.log('Shutting down…');
  pool.end().finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
