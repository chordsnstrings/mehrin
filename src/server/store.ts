import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { parseWalletData } from '../shared/backup';
import type { Funding, FundingInput, Purchase, PurchaseInput, WalletData } from '../shared/types';

/** One durable file for purchases and funding. Legacy purchase arrays load unchanged. */
const DATA_FILE = process.env.DATA_FILE || './data/purchases.json';

export class BackupConflictError extends Error {}

let cache: WalletData | null = null;
let loading: Promise<WalletData> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<WalletData> {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      try {
        cache = parseWalletData(JSON.parse(await fs.readFile(DATA_FILE, 'utf8')));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        cache = { version: 2, purchases: [], funding: [] };
      }
      return cache;
    })().finally(() => { loading = null; });
  }
  return loading;
}

/** Serialize the entire read/modify/write, including concurrent funding and purchases. */
function mutate<T>(change: (data: WalletData) => T): Promise<T> {
  const operation = writeChain.then(async () => {
    const current = await readAll();
    const next: WalletData = { version: 2, purchases: [...current.purchases], funding: [...current.funding] };
    const result = change(next);
    await fs.mkdir(dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.rename(tmp, DATA_FILE);
    cache = next; // Only expose successfully persisted changes.
    return result;
  });
  writeChain = operation.catch(() => {}); // A failed write must not poison future writes.
  return operation;
}

function sorted<T extends { createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const store = {
  async snapshot(): Promise<WalletData> {
    await writeChain;
    const data = await readAll();
    return { version: 2, purchases: sorted(data.purchases), funding: sorted(data.funding) };
  },

  async list(): Promise<Purchase[]> {
    return (await this.snapshot()).purchases;
  },

  add(input: PurchaseInput): Promise<Purchase> {
    return mutate((data) => {
      const purchase = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      data.purchases.push(purchase);
      return purchase;
    });
  },

  remove(id: string): Promise<void> {
    return mutate((data) => { data.purchases = data.purchases.filter((p) => p.id !== id); });
  },

  clear(): Promise<void> {
    return mutate((data) => { data.purchases = []; });
  },

  async listFunding(): Promise<Funding[]> {
    return (await this.snapshot()).funding;
  },

  addFunding(input: FundingInput): Promise<Funding> {
    return mutate((data) => {
      const funding = { amount: input.amount, id: randomUUID(), createdAt: new Date().toISOString() };
      data.funding.push(funding);
      return funding;
    });
  },

  removeFunding(id: string): Promise<void> {
    return mutate((data) => { data.funding = data.funding.filter((f) => f.id !== id); });
  },

  /** Preserve IDs and timestamps so repeated restores cannot double-count cash. */
  restore(backup: WalletData): Promise<void> {
    return mutate((data) => {
      for (const key of ['purchases', 'funding'] as const) {
        const existing = new Map<string, Purchase | Funding>(data[key].map((entry) => [entry.id, entry]));
        for (const entry of backup[key]) {
          const previous = existing.get(entry.id);
          if (previous) {
            const same = Object.entries(entry).every(([field, value]) =>
              (previous as unknown as Record<string, unknown>)[field] === value);
            if (!same) throw new BackupConflictError('A backup entry conflicts with an existing entry.');
          } else {
            if (key === 'purchases') data.purchases.push(entry as Purchase);
            else data.funding.push(entry as Funding);
            existing.set(entry.id, entry);
          }
        }
      }
    });
  },
};

export async function initStore(): Promise<void> {
  await readAll();
}

export const DATA_PATH = DATA_FILE;
