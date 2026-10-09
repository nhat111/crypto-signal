import type { Pool } from 'pg';

export type TradeSide = 'long' | 'short' | 'spot';

export const TRADE_SIDES: readonly TradeSide[] = ['spot', 'long', 'short'];

export function isTradeSide(value: unknown): value is TradeSide {
  return typeof value === 'string' && (TRADE_SIDES as readonly string[]).includes(value);
}

/**
 * How a symbol is stored, applied server-side so every client agrees.
 *
 * Tickers are upper-cased because "btcusdt" and "BTCUSDT" are the same
 * position and /close has to find it. Contract addresses are left exactly
 * as typed: a Solana address is base58, which is case-SENSITIVE, so
 * upper-casing one produces a different string that resolves to nothing —
 * the address in the journal would no longer be the token that was bought,
 * and pasting it into an explorer would fail. EVM hex survives the
 * round-trip but loses its checksum casing, which is its own quiet damage.
 *
 * The split is by shape rather than by chain: a ticker is short and
 * alphanumeric, an address is not.
 */
const TICKER_SHAPE = /^[A-Za-z0-9]{1,12}$/;

export function normalizeTradeSymbol(raw: string): string {
  const trimmed = raw.trim();
  return TICKER_SHAPE.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}
export type TradeStatus = 'open' | 'closed';

export const TRADE_SOURCE_MAX = 80;
export const TRADE_THESIS_MAX = 2000;

/**
 * Blank means "not recorded", stored as null — not as '' — so a cleared
 * field and a never-filled one group together instead of as two sources.
 */
export function cleanTradeText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * How a source is grouped: "@CryptoCred", "@cryptocred" and " @CryptoCred "
 * are one account, and typing it slightly differently must not split its
 * record in two. Only the grouping key is folded — the stored text stays as
 * typed.
 */
export function tradeSourceKey(source: string | null): string | null {
  const cleaned = cleanTradeText(source);
  return cleaned === null ? null : cleaned.toLowerCase();
}

export interface TradePnl {
  pnlPct: number;
  /** Null when the trade has no recorded size — % is still known, $ isn't. */
  pnlUsd: number | null;
}

/**
 * Pure, side-aware P&L. `size` is asset units (e.g. 0.1 BTC), not USD
 * notional, and leverage is deliberately out of scope — this is a manual
 * log, not a position calculator, so it only knows what was typed in.
 */
export function computeTradePnl(side: TradeSide, entryPrice: number, exitPrice: number, size: number | null): TradePnl {
  // Spot prices as a long: buying and holding gains when price rises. Only
  // 'short' inverts, so testing for it directly keeps a future fourth side
  // from silently defaulting to inverted P&L.
  const direction = side === 'short' ? -1 : 1;
  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * direction * 100;
  const pnlUsd = size === null ? null : (exitPrice - entryPrice) * direction * size;
  return { pnlPct, pnlUsd };
}

export interface TradeRow {
  id: string;
  chatId: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  exitPrice: number | null;
  size: number | null;
  pnlPct: number | null;
  pnlUsd: number | null;
  status: TradeStatus;
  note: string | null;
  /** Who or what the idea came from — an account, a group, "tự phân tích". */
  source: string | null;
  /** Why it was taken, written at entry. */
  thesis: string | null;
  openedAt: number;
  closedAt: number | null;
}

export interface InsertTradeInput {
  chatId: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  size: number | null;
  note: string | null;
  /** Optional so callers that predate these fields keep compiling and writing null. */
  source?: string | null;
  thesis?: string | null;
}

export interface UpdateTradeInput {
  symbol?: string;
  side?: TradeSide;
  entryPrice?: number;
  /** Setting this (to a number) is how a trade gets closed. Explicit `null` reopens it. */
  exitPrice?: number | null;
  size?: number | null;
  note?: string | null;
  source?: string | null;
  thesis?: string | null;
}

const SELECT_COLUMNS = `
  id, chat_id, symbol, side, entry_price, exit_price, size, pnl_pct, pnl_usd, status, note, source, thesis,
  extract(epoch from opened_at)*1000 AS opened_at_ms,
  extract(epoch from closed_at)*1000 AS closed_at_ms
`;

function toTradeRow(r: Record<string, unknown>): TradeRow {
  return {
    id: String(r['id']),
    chatId: r['chat_id'] as string,
    symbol: r['symbol'] as string,
    side: r['side'] as TradeSide,
    entryPrice: Number(r['entry_price']),
    exitPrice: r['exit_price'] === null ? null : Number(r['exit_price']),
    size: r['size'] === null ? null : Number(r['size']),
    pnlPct: r['pnl_pct'] === null ? null : Number(r['pnl_pct']),
    pnlUsd: r['pnl_usd'] === null ? null : Number(r['pnl_usd']),
    status: r['status'] as TradeStatus,
    note: (r['note'] as string | null) ?? null,
    source: (r['source'] as string | null) ?? null,
    thesis: (r['thesis'] as string | null) ?? null,
    openedAt: Number(r['opened_at_ms']),
    closedAt: r['closed_at_ms'] === null ? null : Number(r['closed_at_ms']),
  };
}

export async function insertTrade(pool: Pool, input: InsertTradeInput): Promise<TradeRow> {
  const { rows } = await pool.query(
    `INSERT INTO trade_journal (chat_id, symbol, side, entry_price, size, note, source, thesis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.chatId,
      normalizeTradeSymbol(input.symbol),
      input.side,
      input.entryPrice,
      input.size,
      input.note,
      cleanTradeText(input.source),
      cleanTradeText(input.thesis),
    ],
  );
  return toTradeRow(rows[0]);
}

export async function getTradeById(pool: Pool, id: string): Promise<TradeRow | undefined> {
  const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM trade_journal WHERE id = $1`, [id]);
  return rows[0] ? toTradeRow(rows[0]) : undefined;
}

export interface GetTradesFilter {
  chatId?: string;
  status?: TradeStatus;
  limit?: number;
}

export async function getTrades(pool: Pool, filter: GetTradesFilter = {}): Promise<TradeRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filter.chatId) {
    params.push(filter.chatId);
    conditions.push(`chat_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filter.limit ?? 200);

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM trade_journal ${where} ORDER BY opened_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toTradeRow);
}

/** Resolves "/close SYMBOL" — the most recently opened still-open position for this chat+symbol. */
export async function getOpenTradeForSymbol(pool: Pool, chatId: string, symbol: string): Promise<TradeRow | undefined> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM trade_journal
     WHERE chat_id = $1 AND symbol = $2 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    // Normalized on the way in too, or "/close btcusdt" would miss the row
    // that "/trade btcusdt" stored as BTCUSDT.
    [chatId, normalizeTradeSymbol(symbol)],
  );
  return rows[0] ? toTradeRow(rows[0]) : undefined;
}

/**
 * Read-modify-write rather than a dynamic SQL patch: P&L and status both
 * depend on the *merged* result (e.g. setting exitPrice alone still needs
 * the existing side/entryPrice/size to price it), so the merge has to
 * happen somewhere — doing it in application code around one pure
 * computeTradePnl() call is far more legible than a `SET x = COALESCE(...)`
 * chain trying to express the same branching in SQL.
 */
export async function updateTrade(pool: Pool, id: string, patch: UpdateTradeInput): Promise<TradeRow | undefined> {
  const existing = await getTradeById(pool, id);
  if (!existing) return undefined;

  const merged = {
    symbol: patch.symbol ?? existing.symbol,
    side: patch.side ?? existing.side,
    entryPrice: patch.entryPrice ?? existing.entryPrice,
    exitPrice: patch.exitPrice !== undefined ? patch.exitPrice : existing.exitPrice,
    size: patch.size !== undefined ? patch.size : existing.size,
    note: patch.note !== undefined ? patch.note : existing.note,
    source: patch.source !== undefined ? cleanTradeText(patch.source) : existing.source,
    thesis: patch.thesis !== undefined ? cleanTradeText(patch.thesis) : existing.thesis,
  };

  const pnl = merged.exitPrice !== null ? computeTradePnl(merged.side, merged.entryPrice, merged.exitPrice, merged.size) : null;
  const status: TradeStatus = merged.exitPrice !== null ? 'closed' : 'open';
  const closedAtMs = status === 'closed' ? (existing.status === 'closed' ? existing.closedAt : Date.now()) : null;

  const { rows } = await pool.query(
    `UPDATE trade_journal SET
       symbol = $1, side = $2, entry_price = $3, exit_price = $4, size = $5, note = $6,
       pnl_pct = $7, pnl_usd = $8, status = $9,
       closed_at = CASE WHEN $10::double precision IS NULL THEN NULL ELSE to_timestamp($10/1000.0) END,
       source = $12, thesis = $13
     WHERE id = $11
     RETURNING ${SELECT_COLUMNS}`,
    [
      merged.symbol,
      merged.side,
      merged.entryPrice,
      merged.exitPrice,
      merged.size,
      merged.note,
      pnl?.pnlPct ?? null,
      pnl?.pnlUsd ?? null,
      status,
      closedAtMs,
      id,
      merged.source,
      merged.thesis,
    ],
  );
  return toTradeRow(rows[0]);
}

export async function deleteTrade(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM trade_journal WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export interface TradeSummary {
  openCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  /** Null when there are no closed trades yet — 0% would misleadingly imply a losing record. */
  winRatePct: number | null;
  /** Null when no closed trade recorded a size — $0.00 would read as "broke even" rather than "not knowable without a size". */
  totalPnlUsd: number | null;
  avgPnlPct: number | null;
}

export async function getTradeSummary(pool: Pool, chatId?: string): Promise<TradeSummary> {
  const params: unknown[] = [];
  let chatFilter = '';
  if (chatId) {
    params.push(chatId);
    chatFilter = `AND chat_id = $${params.length}`;
  }

  const { rows: openRows } = await pool.query(
    `SELECT count(*) AS c FROM trade_journal WHERE status = 'open' ${chatFilter}`,
    params,
  );
  const { rows: closedRows } = await pool.query(
    `SELECT count(*) AS c,
            count(*) FILTER (WHERE pnl_pct > 0) AS wins,
            count(*) FILTER (WHERE pnl_pct <= 0) AS losses,
            sum(pnl_usd) AS total_pnl_usd,
            avg(pnl_pct) AS avg_pnl_pct
     FROM trade_journal WHERE status = 'closed' ${chatFilter}`,
    params,
  );

  const closed = closedRows[0];
  const closedCount = Number(closed.c);

  return {
    openCount: Number(openRows[0].c),
    closedCount,
    wins: Number(closed.wins),
    losses: Number(closed.losses),
    winRatePct: closedCount > 0 ? (Number(closed.wins) / closedCount) * 100 : null,
    totalPnlUsd: closed.total_pnl_usd === null ? null : Number(closed.total_pnl_usd),
    avgPnlPct: closed.avg_pnl_pct === null ? null : Number(closed.avg_pnl_pct),
  };
}


export interface TradeSourceStats {
  /** As most recently typed. Null is the "no source recorded" group. */
  source: string | null;
  openCount: number;
  closedCount: number;
  wins: number;
  /** Null until something has closed — 0% would read as a losing record. */
  winRatePct: number | null;
  avgPnlPct: number | null;
  /** Null when no closed trade from this source recorded a size. */
  totalPnlUsd: number | null;
}

/**
 * The journal grouped by where each idea came from.
 *
 * Grouped on the folded key (see tradeSourceKey) and labelled with the
 * spelling used most recently, so "@cryptocred" typed once in lower case
 * does not show up as a second account. Rows without a source form their
 * own group rather than being dropped: how the unsourced trades did is the
 * baseline every named source should be read against.
 */
export async function getTradeSourceStats(pool: Pool, chatId?: string): Promise<TradeSourceStats[]> {
  const params: unknown[] = [];
  let chatFilter = '';
  if (chatId) {
    params.push(chatId);
    chatFilter = `WHERE chat_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       (array_agg(source ORDER BY opened_at DESC))[1] AS label,
       count(*) FILTER (WHERE status = 'open') AS open_count,
       count(*) FILTER (WHERE status = 'closed') AS closed_count,
       count(*) FILTER (WHERE status = 'closed' AND pnl_pct > 0) AS wins,
       avg(pnl_pct) FILTER (WHERE status = 'closed') AS avg_pnl_pct,
       sum(pnl_usd) FILTER (WHERE status = 'closed') AS total_pnl_usd
     FROM trade_journal
     ${chatFilter}
     GROUP BY lower(btrim(source))
     ORDER BY count(*) FILTER (WHERE status = 'closed') DESC, count(*) DESC`,
    params,
  );

  return rows.map((r) => {
    const closedCount = Number(r.closed_count);
    const wins = Number(r.wins);
    return {
      source: (r.label as string | null) ?? null,
      openCount: Number(r.open_count),
      closedCount,
      wins,
      winRatePct: closedCount > 0 ? (wins / closedCount) * 100 : null,
      avgPnlPct: r.avg_pnl_pct === null ? null : Number(r.avg_pnl_pct),
      totalPnlUsd: r.total_pnl_usd === null ? null : Number(r.total_pnl_usd),
    };
  });
}
