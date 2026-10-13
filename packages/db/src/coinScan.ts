import type { Pool } from 'pg';
import type { CoinFlow, CoinRead } from '@crypto-signal/indicators';

/** Which exchange a stored day was read from. One day is one exchange, never a mix. */
export type CoinScanExchange = 'binance' | 'okx';

/** One coin's read for one day, as stored and as served by /api/coins. */
export interface CoinScanRow {
  /** YYYY-MM-DD, the UTC day of the last closed daily bar. */
  day: string;
  symbol: string;
  volumeRank: number;
  futuresSymbol: string | null;
  close: number;
  spotQuoteVolume24h: number;
  ret7d: number | null;
  ret30d: number | null;
  rs7d: number | null;
  rs30d: number | null;
  rsAboveSma20: boolean | null;
  downDayExcess: number | null;
  downDays: number;
  takerSkew7d: number | null;
  takerSkew30d: number | null;
  oiChange7dPct: number | null;
  fundingAvg7dPct: number | null;
  spotPerpVolumeRatio: number | null;
  flow: CoinFlow;
  reasons: string[];
  unknowns: string[];
  exchange: CoinScanExchange;
  computedAt: number;
}

export interface CoinScanInput {
  read: CoinRead;
  volumeRank: number;
  futuresSymbol: string | null;
  spotQuoteVolume24h: number;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: Record<string, unknown>): CoinScanRow {
  return {
    day: r['day_text'] as string,
    symbol: r['symbol'] as string,
    volumeRank: Number(r['volume_rank']),
    futuresSymbol: (r['futures_symbol'] as string | null) ?? null,
    close: Number(r['close']),
    spotQuoteVolume24h: Number(r['spot_quote_volume_24h']),
    ret7d: num(r['ret_7d']),
    ret30d: num(r['ret_30d']),
    rs7d: num(r['rs_7d']),
    rs30d: num(r['rs_30d']),
    rsAboveSma20: (r['rs_above_sma20'] as boolean | null) ?? null,
    downDayExcess: num(r['down_day_excess']),
    downDays: Number(r['down_days']),
    takerSkew7d: num(r['taker_skew_7d']),
    takerSkew30d: num(r['taker_skew_30d']),
    oiChange7dPct: num(r['oi_change_7d_pct']),
    fundingAvg7dPct: num(r['funding_avg_7d_pct']),
    spotPerpVolumeRatio: num(r['spot_perp_volume_ratio']),
    flow: r['flow'] as CoinFlow,
    reasons: r['reasons'] as string[],
    unknowns: r['unknowns'] as string[],
    exchange: r['exchange'] as CoinScanExchange,
    computedAt: Math.round(Number(r['computed_at_ms'])),
  };
}

const COLUMNS = `to_char(day, 'YYYY-MM-DD') AS day_text, symbol, volume_rank, futures_symbol, close, spot_quote_volume_24h,
  ret_7d, ret_30d, rs_7d, rs_30d, rs_above_sma20, down_day_excess, down_days, taker_skew_7d, taker_skew_30d,
  oi_change_7d_pct, funding_avg_7d_pct, spot_perp_volume_ratio, flow, reasons, unknowns, exchange,
  extract(epoch from computed_at)*1000 AS computed_at_ms`;

/**
 * Writes one day's scan. A re-run of the same day overwrites its rows, and
 * a coin that dropped out of the top N since the earlier run loses its row
 * for that day — the stored day must be one scan, not the union of several
 * with different universes.
 */
export async function saveCoinScan(pool: Pool, day: string, inputs: CoinScanInput[], exchange: CoinScanExchange = 'binance'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM coin_scan_rows WHERE day = $1::date', [day]);
    for (const { read: r, volumeRank, futuresSymbol, spotQuoteVolume24h } of inputs) {
      await client.query(
        `INSERT INTO coin_scan_rows (day, symbol, volume_rank, futures_symbol, close, spot_quote_volume_24h,
           ret_7d, ret_30d, rs_7d, rs_30d, rs_above_sma20, down_day_excess, down_days, taker_skew_7d, taker_skew_30d,
           oi_change_7d_pct, funding_avg_7d_pct, spot_perp_volume_ratio, flow, reasons, unknowns, exchange)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [
          day,
          r.symbol,
          volumeRank,
          futuresSymbol,
          r.close,
          spotQuoteVolume24h,
          r.ret7d,
          r.ret30d,
          r.rs7d,
          r.rs30d,
          r.rsAboveSma20,
          r.downDayExcess,
          r.downDays,
          r.takerSkew7d,
          r.takerSkew30d,
          r.oiChange7dPct,
          r.fundingAvg7dPct,
          r.spotPerpVolumeRatio,
          r.flow,
          JSON.stringify(r.reasons),
          JSON.stringify(r.unknowns),
          exchange,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The most recent day's scan, most-traded first. Empty until the first scan lands. */
export async function getLatestCoinScan(pool: Pool): Promise<{ day: string | null; rows: CoinScanRow[] }> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM coin_scan_rows
     WHERE day = (SELECT max(day) FROM coin_scan_rows)
     ORDER BY volume_rank, symbol`,
  );
  const mapped = rows.map(toRow);
  return { day: mapped[0]?.day ?? null, rows: mapped };
}

/** The last day a scan was stored, or null — how the hourly tick decides whether today's has already run. */
export async function getLatestCoinScanDay(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query(`SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM coin_scan_rows`);
  return (rows[0]?.day as string | null) ?? null;
}
