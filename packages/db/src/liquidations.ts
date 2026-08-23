import type { Pool } from 'pg';
import type { LiquidationEvent } from '@crypto-signal/shared';

export async function insertLiquidation(pool: Pool, event: LiquidationEvent): Promise<void> {
  await pool.query(
    `INSERT INTO liquidations (symbol, side, order_type, quantity, price, average_price, quote_quantity, order_status, order_trade_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0))`,
    [
      event.symbol,
      event.side,
      event.orderType,
      event.quantity,
      event.price,
      event.averagePrice,
      event.quoteQuantity,
      event.orderStatus,
      event.orderTradeTime,
    ],
  );
}

export async function getLiquidationEventsInWindow(
  pool: Pool,
  symbol: string,
  fromMs: number,
  toMs: number,
): Promise<LiquidationEvent[]> {
  const { rows } = await pool.query(
    `SELECT symbol, side, order_type, quantity, price, average_price, quote_quantity, order_status,
            extract(epoch from order_trade_time)*1000 AS ts
     FROM liquidations
     WHERE symbol = $1 AND order_trade_time > to_timestamp($2/1000.0) AND order_trade_time <= to_timestamp($3/1000.0)`,
    [symbol, fromMs, toMs],
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    side: r.side,
    orderType: r.order_type,
    quantity: Number(r.quantity),
    price: Number(r.price),
    averagePrice: Number(r.average_price),
    quoteQuantity: Number(r.quote_quantity),
    orderStatus: r.order_status,
    orderTradeTime: Number(r.ts),
  }));
}

/** Rolling 24h total notional liquidated, used as the spike baseline (spec §10). Returns 0 (not an estimate) when there isn't 24h of history yet — see ASSUMPTIONS.md §6. */
export async function getRolling24hLiquidationUsd(pool: Pool, symbol: string, asOfMs: number): Promise<{ totalUsd: number; earliestEventMs: number | null }> {
  const dayMs = 24 * 60 * 60 * 1000;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(quote_quantity), 0) AS total, extract(epoch from MIN(order_trade_time))*1000 AS earliest
     FROM liquidations
     WHERE symbol = $1 AND order_trade_time > to_timestamp($2/1000.0) AND order_trade_time <= to_timestamp($3/1000.0)`,
    [symbol, asOfMs - dayMs, asOfMs],
  );
  const row = rows[0];
  return {
    totalUsd: Number(row?.total ?? 0),
    earliestEventMs: row?.earliest ? Number(row.earliest) : null,
  };
}

/** Retention: liquidation rows are dropped after 30 days (spec §6 "Không lưu mọi tick vô thời hạn"). */
export async function pruneOldLiquidations(pool: Pool, olderThanDays = 30): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM liquidations WHERE order_trade_time < now() - ($1 || ' days')::interval`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}
