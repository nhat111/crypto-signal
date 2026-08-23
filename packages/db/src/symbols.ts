import type { Pool } from 'pg';

/** Ensures a row exists for every configured symbol — called once at worker startup. */
export async function ensureSymbol(pool: Pool, symbol: string): Promise<void> {
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  await pool.query(
    `INSERT INTO symbols (symbol, base_asset, quote_asset) VALUES ($1, $2, 'USDT')
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, base],
  );
}
