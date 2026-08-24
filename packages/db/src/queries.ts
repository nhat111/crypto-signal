import type { Pool } from 'pg';

export interface OverviewRow {
  symbol: string;
  timeframe: string;
  timestamp: number;
  priceClose: number;
  priceChangePct: number;
  /** Null for futures-only symbols (no Spot listing) — see ASSUMPTIONS.md §15. */
  healthScore: number | null;
  healthStatus: string | null;
  riskScore: number;
  dataQualityScore: number;
}

/** Latest snapshot per (symbol, timeframe) — backs both the market overview cards and the heatmap grid (spec §17/§19). */
export async function getOverview(pool: Pool, symbols: string[], timeframes: string[]): Promise<OverviewRow[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (symbol, timeframe) symbol, timeframe, extract(epoch from timestamp)*1000 AS ts,
            price_close, price_change_pct, health_score, health_status, risk_score, data_quality_score
     FROM market_health_snapshots
     WHERE symbol = ANY($1) AND timeframe = ANY($2)
     ORDER BY symbol, timeframe, timestamp DESC`,
    [symbols, timeframes],
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    timeframe: r.timeframe,
    timestamp: Number(r.ts),
    priceClose: Number(r.price_close),
    priceChangePct: Number(r.price_change_pct),
    healthScore: r.health_score,
    healthStatus: r.health_status,
    riskScore: r.risk_score,
    dataQualityScore: r.data_quality_score,
  }));
}

export interface SymbolTimeseriesPoint {
  timestamp: number;
  priceClose: number;
  spotCvdCumulative: number | null;
  futuresCvdCumulative: number | null;
  openInterest: number | null;
  fundingRatePct: number | null;
  liquidationLongUsd: number | null;
  liquidationShortUsd: number | null;
  healthScore: number | null;
  riskScore: number;
}

/** Backs the Symbol Detail page's 8 charts (spec §18): price, spot CVD, futures CVD, OI, funding, liquidations, health, risk — one query, one row per timestamp. */
export async function getSymbolTimeseries(
  pool: Pool,
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<SymbolTimeseriesPoint[]> {
  const { rows } = await pool.query(
    `SELECT extract(epoch from h.timestamp)*1000 AS ts, h.price_close, h.health_score, h.risk_score,
            sm.cvd_cumulative AS spot_cvd_cumulative, fm.cvd_cumulative AS futures_cvd_cumulative,
            fm.open_interest, fm.funding_rate_pct, fm.liquidation_long_usd, fm.liquidation_short_usd
     FROM market_health_snapshots h
     LEFT JOIN spot_metrics sm ON sm.symbol = h.symbol AND sm.timeframe = h.timeframe AND sm.timestamp = h.timestamp
     LEFT JOIN futures_metrics fm ON fm.symbol = h.symbol AND fm.timeframe = h.timeframe AND fm.timestamp = h.timestamp
     WHERE h.symbol = $1 AND h.timeframe = $2
     ORDER BY h.timestamp DESC
     LIMIT $3`,
    [symbol, timeframe, limit],
  );
  return rows
    .map((r) => ({
      timestamp: Number(r.ts),
      priceClose: Number(r.price_close),
      spotCvdCumulative: r.spot_cvd_cumulative === null ? null : Number(r.spot_cvd_cumulative),
      futuresCvdCumulative: r.futures_cvd_cumulative === null ? null : Number(r.futures_cvd_cumulative),
      openInterest: r.open_interest === null ? null : Number(r.open_interest),
      fundingRatePct: r.funding_rate_pct === null ? null : Number(r.funding_rate_pct),
      liquidationLongUsd: r.liquidation_long_usd === null ? null : Number(r.liquidation_long_usd),
      liquidationShortUsd: r.liquidation_short_usd === null ? null : Number(r.liquidation_short_usd),
      healthScore: r.health_score,
      riskScore: r.risk_score,
    }))
    .reverse();
}

export interface LatestSymbolState extends OverviewRow {
  /** Null for futures-only symbols. */
  spotCvd: number | null;
  futuresCvd: number;
  openInterest: number;
  fundingRatePct: number;
  liquidationLongUsd: number;
  liquidationShortUsd: number;
}

/** Single-row "current state" for one (symbol, timeframe) — used by /btc /eth /sol and the symbol detail header. */
export async function getLatestSymbolState(pool: Pool, symbol: string, timeframe: string): Promise<LatestSymbolState | undefined> {
  const points = await getSymbolTimeseries(pool, symbol, timeframe, 1);
  const point = points[0];
  if (!point) return undefined;
  const [overview] = await getOverview(pool, [symbol], [timeframe]);
  if (!overview) return undefined;
  return {
    ...overview,
    spotCvd: point.spotCvdCumulative,
    futuresCvd: point.futuresCvdCumulative ?? 0,
    openInterest: point.openInterest ?? 0,
    fundingRatePct: point.fundingRatePct ?? 0,
    liquidationLongUsd: point.liquidationLongUsd ?? 0,
    liquidationShortUsd: point.liquidationShortUsd ?? 0,
  };
}
