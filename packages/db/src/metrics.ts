import type { Pool } from 'pg';
import type { MarketSnapshot } from '@crypto-signal/indicators';
import type { HealthResult, RiskResult } from '@crypto-signal/health-engine';
import type { FundingRatePoint, OpenInterestPoint } from '@crypto-signal/shared';

export async function saveSpotMetrics(pool: Pool, snapshot: MarketSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO spot_metrics (symbol, timeframe, timestamp, cvd_delta, cvd_skew_ratio, cvd_cumulative, volume, volume_ratio, volume_anomaly)
     VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5,$6,$7,$8,$9)
     ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
       cvd_delta = EXCLUDED.cvd_delta, cvd_skew_ratio = EXCLUDED.cvd_skew_ratio,
       cvd_cumulative = EXCLUDED.cvd_cumulative, volume = EXCLUDED.volume,
       volume_ratio = EXCLUDED.volume_ratio, volume_anomaly = EXCLUDED.volume_anomaly`,
    [
      snapshot.symbol,
      snapshot.timeframe,
      snapshot.timestamp,
      snapshot.spot.cvdDelta,
      snapshot.spot.cvdSkewRatio,
      snapshot.spot.cvdCumulative,
      snapshot.spot.volume,
      snapshot.spot.volumeRatio,
      snapshot.spot.volumeAnomaly,
    ],
  );
}

export async function saveFuturesMetrics(pool: Pool, snapshot: MarketSnapshot): Promise<void> {
  const f = snapshot.futures;
  await pool.query(
    `INSERT INTO futures_metrics
      (symbol, timeframe, timestamp, cvd_delta, cvd_skew_ratio, cvd_cumulative, volume, volume_ratio, volume_anomaly,
       open_interest, oi_change_pct, oi_velocity_pct_per_hour, funding_rate, funding_rate_pct,
       basis_absolute, basis_pct, liquidation_long_usd, liquidation_short_usd, liquidation_anomaly_ratio)
     VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
       cvd_delta = EXCLUDED.cvd_delta, cvd_skew_ratio = EXCLUDED.cvd_skew_ratio,
       cvd_cumulative = EXCLUDED.cvd_cumulative, volume = EXCLUDED.volume,
       volume_ratio = EXCLUDED.volume_ratio, volume_anomaly = EXCLUDED.volume_anomaly,
       open_interest = EXCLUDED.open_interest, oi_change_pct = EXCLUDED.oi_change_pct,
       oi_velocity_pct_per_hour = EXCLUDED.oi_velocity_pct_per_hour,
       funding_rate = EXCLUDED.funding_rate, funding_rate_pct = EXCLUDED.funding_rate_pct,
       basis_absolute = EXCLUDED.basis_absolute, basis_pct = EXCLUDED.basis_pct,
       liquidation_long_usd = EXCLUDED.liquidation_long_usd,
       liquidation_short_usd = EXCLUDED.liquidation_short_usd,
       liquidation_anomaly_ratio = EXCLUDED.liquidation_anomaly_ratio`,
    [
      snapshot.symbol,
      snapshot.timeframe,
      snapshot.timestamp,
      f.cvdDelta,
      f.cvdSkewRatio,
      f.cvdCumulative,
      f.volume,
      f.volumeRatio,
      f.volumeAnomaly,
      f.openInterest,
      f.oiChangePct,
      f.oiVelocityPctPerHour,
      f.fundingRate,
      f.fundingRatePct,
      f.basisAbsolute,
      f.basisPct,
      f.liquidation.longLiquidationUsd,
      f.liquidation.shortLiquidationUsd,
      f.liquidationAnomalyRatio,
    ],
  );
}

export async function saveHealthSnapshot(
  pool: Pool,
  snapshot: MarketSnapshot,
  health: HealthResult,
  risk: RiskResult,
): Promise<void> {
  await pool.query(
    `INSERT INTO market_health_snapshots
      (symbol, timeframe, timestamp, price_close, price_change_pct, health_score, health_status,
       health_components, risk_score, risk_components, data_quality_score)
     VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
       price_close = EXCLUDED.price_close, price_change_pct = EXCLUDED.price_change_pct,
       health_score = EXCLUDED.health_score, health_status = EXCLUDED.health_status,
       health_components = EXCLUDED.health_components, risk_score = EXCLUDED.risk_score,
       risk_components = EXCLUDED.risk_components, data_quality_score = EXCLUDED.data_quality_score`,
    [
      snapshot.symbol,
      snapshot.timeframe,
      snapshot.timestamp,
      snapshot.price.close,
      snapshot.price.changePct,
      health.score,
      health.status,
      JSON.stringify(health.components),
      risk.score,
      JSON.stringify(risk.components),
      snapshot.dataQuality.score,
    ],
  );
}

export async function insertOpenInterest(pool: Pool, point: OpenInterestPoint): Promise<void> {
  await pool.query(
    `INSERT INTO open_interest (symbol, timeframe, timestamp, sum_open_interest, sum_open_interest_value)
     VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5)
     ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
       sum_open_interest = EXCLUDED.sum_open_interest, sum_open_interest_value = EXCLUDED.sum_open_interest_value`,
    [point.symbol, point.timeframe, point.timestamp, point.sumOpenInterest, point.sumOpenInterestValue],
  );
}

export async function insertFundingRate(pool: Pool, point: FundingRatePoint): Promise<void> {
  await pool.query(
    `INSERT INTO funding_rates (symbol, funding_time, funding_rate, mark_price)
     VALUES ($1,to_timestamp($2/1000.0),$3,$4)
     ON CONFLICT (symbol, funding_time) DO NOTHING`,
    [point.symbol, point.fundingTime, point.fundingRate, point.markPrice],
  );
}

export async function getPreviousOpenInterest(
  pool: Pool,
  symbol: string,
  timeframe: string,
  beforeTimestamp: number,
): Promise<OpenInterestPoint | undefined> {
  const { rows } = await pool.query(
    `SELECT symbol, sum_open_interest, sum_open_interest_value, extract(epoch from timestamp)*1000 AS ts
     FROM open_interest
     WHERE symbol = $1 AND timeframe = $2 AND timestamp < to_timestamp($3/1000.0)
     ORDER BY timestamp DESC LIMIT 1`,
    [symbol, timeframe, beforeTimestamp],
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    symbol: row.symbol,
    timeframe: timeframe as OpenInterestPoint['timeframe'],
    timestamp: Number(row.ts),
    sumOpenInterest: Number(row.sum_open_interest),
    sumOpenInterestValue: Number(row.sum_open_interest_value),
  };
}

export async function getRecentVolumes(
  pool: Pool,
  symbol: string,
  market: 'spot' | 'futures',
  timeframe: string,
  limit: number,
): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT volume FROM market_candles
     WHERE symbol = $1 AND market = $2 AND timeframe = $3
     ORDER BY open_time DESC LIMIT $4`,
    [symbol, market, timeframe, limit],
  );
  return rows.map((r) => Number(r.volume)).reverse();
}

export async function getLatestCumulativeCvd(
  pool: Pool,
  symbol: string,
  market: 'spot' | 'futures',
  timeframe: string,
): Promise<number> {
  const table = market === 'spot' ? 'spot_metrics' : 'futures_metrics';
  const { rows } = await pool.query(
    `SELECT cvd_cumulative FROM ${table} WHERE symbol = $1 AND timeframe = $2 ORDER BY timestamp DESC LIMIT 1`,
    [symbol, timeframe],
  );
  return rows[0] ? Number(rows[0].cvd_cumulative) : 0;
}
