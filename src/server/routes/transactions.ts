import { Router } from 'express';
import { pool, hasDatabase } from '../db';
import { isValidInput } from '../../shared/calc';
import type { Purchase } from '../../shared/types';

export const transactionsRouter = Router();

interface Row {
  id: string;
  aed_submitted: string;
  usdt_received: string;
  btc_amount: string;
  buy_price: string;
  created_at: Date | string;
}

function mapRow(r: Row): Purchase {
  return {
    id: r.id,
    aedSubmitted: Number(r.aed_submitted),
    usdtReceived: Number(r.usdt_received),
    btcAmount: Number(r.btc_amount),
    buyPrice: Number(r.buy_price),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/** Returns 503 when no database is configured (e.g. local boot without one). */
function guardDb(res: import('express').Response): boolean {
  if (!hasDatabase) {
    res.status(503).json({ error: 'Database is not configured (DATABASE_URL missing).' });
    return false;
  }
  return true;
}

transactionsRouter.get('/', async (_req, res, next) => {
  if (!guardDb(res)) return;
  try {
    const { rows } = await pool.query<Row>('SELECT * FROM purchases ORDER BY created_at ASC');
    res.json(rows.map(mapRow));
  } catch (err) {
    next(err);
  }
});

transactionsRouter.post('/', async (req, res, next) => {
  if (!guardDb(res)) return;
  const input = {
    aedSubmitted: Number(req.body?.aedSubmitted),
    usdtReceived: Number(req.body?.usdtReceived),
    btcAmount: Number(req.body?.btcAmount),
    buyPrice: Number(req.body?.buyPrice),
  };
  if (!isValidInput(input)) {
    res.status(400).json({ error: 'Invalid purchase data.' });
    return;
  }
  try {
    const { rows } = await pool.query<Row>(
      `INSERT INTO purchases (aed_submitted, usdt_received, btc_amount, buy_price)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.aedSubmitted, input.usdtReceived, input.btcAmount, input.buyPrice],
    );
    res.status(201).json(mapRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete('/:id', async (req, res, next) => {
  if (!guardDb(res)) return;
  try {
    await pool.query('DELETE FROM purchases WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete('/', async (_req, res, next) => {
  if (!guardDb(res)) return;
  try {
    await pool.query('DELETE FROM purchases');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
