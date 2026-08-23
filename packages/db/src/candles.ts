import type { Pool } from 'pg';
import type { Candle } from '@crypto-signal/shared';

export async function upsertCandle(pool: Pool, candle: Candle): Promise<void> {
  await pool.query(
    `INSERT INTO market_candles
      (symbol, market, timeframe, open_time, close_time, open, high, low, close,
       volume, quote_volume, trades, taker_buy_base_volume, taker_buy_quote_volume, taker_sell_base_volume)
     VALUES ($1,$2,$3,to_timestamp($4/1000.0),to_timestamp($5/1000.0),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (symbol, market, timeframe, open_time) DO UPDATE SET
       close_time = EXCLUDED.close_time,
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
       volume = EXCLUDED.volume, quote_volume = EXCLUDED.quote_volume, trades = EXCLUDED.trades,
       taker_buy_base_volume = EXCLUDED.taker_buy_base_volume,
       taker_buy_quote_volume = EXCLUDED.taker_buy_quote_volume,
       taker_sell_base_volume = EXCLUDED.taker_sell_base_volume`,
    [
      candle.symbol,
      candle.market,
      candle.timeframe,
      candle.openTime,
      candle.closeTime,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.quoteVolume,
      candle.trades,
      candle.takerBuyBaseVolume,
      candle.takerBuyQuoteVolume,
      candle.takerSellBaseVolume,
    ],
  );
}

export interface CandleRow {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getRecentCandles(
  pool: Pool,
  symbol: string,
  market: 'spot' | 'futures',
  timeframe: string,
  limit: number,
): Promise<CandleRow[]> {
  const { rows } = await pool.query(
    `SELECT extract(epoch from open_time)*1000 AS open_time,
            extract(epoch from close_time)*1000 AS close_time,
            open, high, low, close, volume
     FROM market_candles
     WHERE symbol = $1 AND market = $2 AND timeframe = $3
     ORDER BY open_time DESC
     LIMIT $4`,
    [symbol, market, timeframe, limit],
  );
  return rows
    .map((r) => ({
      openTime: Number(r.open_time),
      closeTime: Number(r.close_time),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }))
    .reverse();
}
