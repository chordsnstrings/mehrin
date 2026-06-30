import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

/** DigitalOcean managed Postgres requires SSL; local dev usually doesn't. */
const isLocal = !!connectionString && /@(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
const useSsl = !!connectionString && !isLocal && process.env.PGSSL !== 'disable';

export const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

export const hasDatabase = !!connectionString;

/** Create the schema if it does not exist. Idempotent; safe to run on boot. */
export async function migrate(): Promise<void> {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aed         NUMERIC(20, 8) NOT NULL CHECK (aed > 0),
      rate        NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
      fee         NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (fee >= 0),
      buy_price   NUMERIC(20, 8) NOT NULL CHECK (buy_price > 0),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS purchases_created_at_idx ON purchases (created_at);
  `);
}
