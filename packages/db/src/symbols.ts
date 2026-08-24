import type { Pool } from 'pg';

/** Ensures a row exists for every configured symbol — called once at worker startup, for both normal and futures-only symbols. */
export async function ensureSymbol(pool: Pool, symbol: string): Promise<void> {
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  await pool.query(
    `INSERT INTO symbols (symbol, base_asset, quote_asset) VALUES ($1, $2, 'USDT')
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, base],
  );
}

/**
 * Every symbol the collector has registered — the read side's source of
 * truth for "which symbols exist".
 *
 * The worker owns the symbol list (it's the only process that talks to
 * Binance, per the collector rule) and registers each one here at startup.
 * API/web/telegram read it back from the database instead of re-reading
 * SYMBOLS/FUTURES_ONLY_SYMBOLS from their own env, so the list is
 * configured in exactly one place and can't drift between services.
 *
 * Note: a symbol removed from the worker's config keeps its row (and its
 * historical data) until someone flips `enabled` to false — deliberate, so
 * dropping a symbol never silently deletes its history.
 */
export async function getEnabledSymbols(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query(`SELECT symbol FROM symbols WHERE enabled = TRUE ORDER BY id`);
  return rows.map((r) => r.symbol as string);
}
