import type { Pool } from 'pg';

export type GemWatchStatus = 'active' | 'triggered' | 'closed';

export interface GemWatchRow {
  id: string;
  chatId: string;
  chainId: string;
  tokenAddress: string;
  symbol: string;
  entryPrice: number;
  entryLiquidityUsd: number | null;
  entryRiskScore: number | null;
  entrySafetyVerdict: string | null;
  stopLossPct: number;
  /** Null for a watch armed before migration 023: the trigger stays off rather than being applied retroactively. */
  trailingStopPct: number | null;
  trailingArmPct: number | null;
  /** Highest price seen since arming, entry included. Null only for a pre-023 watch. */
  peakPrice: number | null;
  peakAt: number | null;
  takeProfitPct: number;
  liquidityCollapsePct: number;
  riskScoreAlert: number;
  status: GemWatchStatus;
  triggeredReasons: string[] | null;
  createdAt: number;
  closedAt: number | null;
}

export interface InsertGemWatchInput {
  chatId: string;
  chainId: string;
  tokenAddress: string;
  symbol: string;
  entryPrice: number;
  entryLiquidityUsd: number | null;
  entryRiskScore: number | null;
  entrySafetyVerdict: string | null;
  stopLossPct: number;
  trailingStopPct: number;
  trailingArmPct: number;
  takeProfitPct: number;
  liquidityCollapsePct: number;
  riskScoreAlert: number;
}

const SELECT_COLUMNS = `
  id, chat_id, chain_id, token_address, symbol, entry_price, entry_liquidity_usd,
  entry_risk_score, entry_safety_verdict, stop_loss_pct, take_profit_pct,
  trailing_stop_pct, trailing_arm_pct, peak_price,
  liquidity_collapse_pct, risk_score_alert, status, triggered_reasons,
  extract(epoch from created_at)*1000 AS created_at_ms,
  extract(epoch from closed_at)*1000 AS closed_at_ms,
  extract(epoch from peak_at)*1000 AS peak_at_ms
`;

function toWatchRow(r: Record<string, unknown>): GemWatchRow {
  return {
    id: String(r['id']),
    chatId: r['chat_id'] as string,
    chainId: r['chain_id'] as string,
    tokenAddress: r['token_address'] as string,
    symbol: r['symbol'] as string,
    entryPrice: Number(r['entry_price']),
    entryLiquidityUsd: r['entry_liquidity_usd'] === null ? null : Number(r['entry_liquidity_usd']),
    entryRiskScore: r['entry_risk_score'] === null ? null : Number(r['entry_risk_score']),
    entrySafetyVerdict: (r['entry_safety_verdict'] as string | null) ?? null,
    stopLossPct: Number(r['stop_loss_pct']),
    trailingStopPct: r['trailing_stop_pct'] === null ? null : Number(r['trailing_stop_pct']),
    trailingArmPct: r['trailing_arm_pct'] === null ? null : Number(r['trailing_arm_pct']),
    peakPrice: r['peak_price'] === null ? null : Number(r['peak_price']),
    peakAt: r['peak_at_ms'] === null || r['peak_at_ms'] === undefined ? null : Number(r['peak_at_ms']),
    takeProfitPct: Number(r['take_profit_pct']),
    liquidityCollapsePct: Number(r['liquidity_collapse_pct']),
    riskScoreAlert: Number(r['risk_score_alert']),
    status: r['status'] as GemWatchStatus,
    triggeredReasons: (r['triggered_reasons'] as string[] | null) ?? null,
    createdAt: Number(r['created_at_ms']),
    closedAt: r['closed_at_ms'] === null ? null : Number(r['closed_at_ms']),
  };
}

/** Null when this chat is already actively watching that token — the caller decides how to respond, this just reports it rather than silently overwriting. */
export async function getActiveWatch(pool: Pool, chatId: string, chainId: string, tokenAddress: string): Promise<GemWatchRow | undefined> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM gem_watches WHERE chat_id = $1 AND chain_id = $2 AND token_address = $3 AND status = 'active'`,
    [chatId, chainId, tokenAddress],
  );
  return rows[0] ? toWatchRow(rows[0]) : undefined;
}

export async function insertGemWatch(pool: Pool, input: InsertGemWatchInput): Promise<GemWatchRow> {
  const { rows } = await pool.query(
    `INSERT INTO gem_watches
      (chat_id, chain_id, token_address, symbol, entry_price, entry_liquidity_usd,
       entry_risk_score, entry_safety_verdict, stop_loss_pct, take_profit_pct,
       liquidity_collapse_pct, risk_score_alert, trailing_stop_pct, trailing_arm_pct,
       peak_price, peak_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$5,now())
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.chatId,
      input.chainId,
      input.tokenAddress,
      input.symbol,
      input.entryPrice,
      input.entryLiquidityUsd,
      input.entryRiskScore,
      input.entrySafetyVerdict,
      input.stopLossPct,
      input.takeProfitPct,
      input.liquidityCollapsePct,
      input.riskScoreAlert,
      input.trailingStopPct,
      input.trailingArmPct,
    ],
  );
  return toWatchRow(rows[0]);
}

export async function getActiveWatchesForChat(pool: Pool, chatId: string): Promise<GemWatchRow[]> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM gem_watches WHERE chat_id = $1 AND status = 'active' ORDER BY created_at DESC`,
    [chatId],
  );
  return rows.map(toWatchRow);
}

/** Every chat's active watches, for the worker's periodic sell-condition check — not scoped to one chat. */
export async function getAllActiveWatches(pool: Pool): Promise<GemWatchRow[]> {
  const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM gem_watches WHERE status = 'active'`);
  return rows.map(toWatchRow);
}

export async function closeGemWatch(pool: Pool, id: string, status: 'triggered' | 'closed', reasons: string[] | null = null): Promise<void> {
  await pool.query(
    `UPDATE gem_watches SET status = $1, triggered_reasons = $2, closed_at = now() WHERE id = $3`,
    [status, reasons ? JSON.stringify(reasons) : null, id],
  );
}

/** Ownership check before a manual /unwatch — a chat can only close its own watches. */
export async function closeGemWatchForChat(pool: Pool, id: string, chatId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE gem_watches SET status = 'closed', closed_at = now() WHERE id = $1 AND chat_id = $2 AND status = 'active'`,
    [id, chatId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Raises the recorded high-water mark and returns the peak that now stands.
 *
 * It returns the peak rather than a did-it-move flag because the caller
 * needs the value, and inferring it is where this went wrong: "the write
 * did not move the row" has two causes — the price is below the peak, or
 * another pass already recorded a HIGHER one — and a caller that falls back
 * to its own previously-read row handles the first correctly and the second
 * by evaluating against a peak it knows to be stale, under-reporting the
 * trailing stop that depends on it.
 *
 * GREATEST does the comparison in SQL so a concurrent pass cannot push the
 * peak back down between the read and the write; peak_at moves only on a
 * real rise, so it still dates the high rather than the last poll.
 *
 * Null means the watch row is gone.
 */
export async function raiseGemWatchPeak(pool: Pool, id: string, price: number): Promise<number | null> {
  const { rows } = await pool.query(
    `UPDATE gem_watches
        SET peak_price = GREATEST(COALESCE(peak_price, $2), $2),
            peak_at = CASE WHEN peak_price IS NULL OR peak_price < $2 THEN now() ELSE peak_at END
      WHERE id = $1
      RETURNING peak_price`,
    [id, price],
  );
  return rows[0] ? Number(rows[0].peak_price) : null;
}
