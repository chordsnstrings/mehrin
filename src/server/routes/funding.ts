import { Router } from 'express';
import { store } from '../store';
import { isValidFunding } from '../../shared/calc';

export const fundingRouter = Router();

fundingRouter.get('/', async (_req, res, next) => {
  try { res.json(await store.listFunding()); } catch (err) { next(err); }
});

fundingRouter.post('/', async (req, res, next) => {
  if (!isValidFunding(req.body)) {
    res.status(400).json({ error: 'Enter a USDT amount greater than zero.' });
    return;
  }
  try {
    res.status(201).json(await store.addFunding({ amount: req.body.amount }));
  } catch (err) { next(err); }
});

fundingRouter.delete('/:id', async (req, res, next) => {
  try {
    await store.removeFunding(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
