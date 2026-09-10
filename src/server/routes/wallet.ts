import { Router } from 'express';
import { BackupConflictError, store } from '../store';
import { parseWalletData } from '../../shared/backup';
import type { WalletData } from '../../shared/types';

export const walletRouter = Router();

walletRouter.get('/', async (_req, res, next) => {
  try { res.json(await store.snapshot()); } catch (err) { next(err); }
});

walletRouter.post('/restore', async (req, res, next) => {
  let backup: WalletData;
  try {
    backup = parseWalletData(req.body);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  try {
    await store.restore(backup);
    res.json(await store.snapshot());
  } catch (err) {
    if (err instanceof BackupConflictError) res.status(409).json({ error: err.message });
    else next(err);
  }
});
