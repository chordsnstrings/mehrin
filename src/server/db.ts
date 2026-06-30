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
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aed_submitted NUMERIC(20, 8) NOT NULL CHECK (aed_submitted > 0),
      usdt_received NUMERIC(20, 8) NOT NULL CHECK (usdt_received > 0),
      btc_amount    NUMERIC(28, 8) NOT NULL CHECK (btc_amount > 0),
      buy_price     NUMERIC(20, 8) NOT NULL CHECK (buy_price > 0),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS purchases_created_at_idx ON purchases (created_at);

    -- Self-heal a dev database created with the earlier (rate/fee) schema.
    ALTER TABLE purchases ADD COLUMN IF NOT EXISTS aed_submitted NUMERIC(20, 8);
    ALTER TABLE purchases ADD COLUMN IF NOT EXISTS usdt_received NUMERIC(20, 8);
    ALTER TABLE purchases ADD COLUMN IF NOT EXISTS btc_amount    NUMERIC(28, 8);
    ALTER TABLE purchases DROP COLUMN IF EXISTS aed;
    ALTER TABLE purchases DROP COLUMN IF EXISTS rate;
    ALTER TABLE purchases DROP COLUMN IF EXISTS fee;
  `);
}
