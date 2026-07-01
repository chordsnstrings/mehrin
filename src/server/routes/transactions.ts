import { Router } from 'express';
import { store } from '../store';
import { isValidInput } from '../../shared/calc';

export const transactionsRouter = Router();

transactionsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await store.list());
  } catch (err) {
    next(err);
  }
});

transactionsRouter.post('/', async (req, res, next) => {
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
    res.status(201).json(await store.add(input));
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete('/:id', async (req, res, next) => {
  try {
    await store.remove(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete('/', async (_req, res, next) => {
  try {
    await store.clear();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
