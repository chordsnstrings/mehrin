import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import type { Purchase, PurchaseInput } from '../shared/types';

/**
 * Tiny file-backed store — the "note on the server". Purchases live in a single
 * JSON file (no database). Writes are serialized and atomic (temp file + rename)
 * so a crash mid-write can't corrupt the data.
 *
 * DATA_FILE should point at durable storage in production (a mounted volume on a
 * Droplet, e.g. /data/purchases.json). On an ephemeral filesystem the data
 * resets on redeploy — see README.
 */
const DATA_FILE = process.env.DATA_FILE || './data/purchases.json';

let cache: Purchase[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function readAll(): Promise<Purchase[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) as Purchase[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') cache = [];
    else throw err;
  }
  return cache;
}

function persist(list: Purchase[]): Promise<void> {
  cache = list;
  // Serialize writes so concurrent requests can't interleave file writes.
  writeChain = writeChain.then(async () => {
    await fs.mkdir(dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(list, null, 2));
    await fs.rename(tmp, DATA_FILE); // atomic on POSIX
  });
  return writeChain;
}

export const store = {
  async list(): Promise<Purchase[]> {
    const list = await readAll();
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async add(input: PurchaseInput): Promise<Purchase> {
    const list = await readAll();
    const purchase: Purchase = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    await persist([...list, purchase]);
    return purchase;
  },

  async remove(id: string): Promise<void> {
    const list = await readAll();
    await persist(list.filter((p) => p.id !== id));
  },

  async clear(): Promise<void> {
    await persist([]);
  },
};

/** Load the file into memory on boot (creating the directory if needed). */
export async function initStore(): Promise<void> {
  await fs.mkdir(dirname(DATA_FILE), { recursive: true }).catch(() => {});
  await readAll();
}

export const DATA_PATH = DATA_FILE;
