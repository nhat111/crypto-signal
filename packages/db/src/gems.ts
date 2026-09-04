import type { Pool } from 'pg';
import { compareToBaseline, samplesNeeded, type EdgeVerdict } from './edge.js';
import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';
import type { GemEvaluation } from '@crypto-signal/gem-scanner';

export interface PersistGemScanInput {
  pair: GemPair;
  evaluation: GemEvaluation;
  safety: SafetyReport | null;
  scannedAt: number;
}

export async function upsertGemToken(pool: Pool, pair: GemPair): Promise<void> {
  await pool.query(
    `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id, dexscreener_url, pair_created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::double precision IS NULL THEN NULL ELSE to_timestamp($8/1000.0) END)
     ON CONFLICT (chain_id, token_address) DO UPDATE SET
       symbol = EXCLUDED.symbol,
       name = EXCLUDED.name,
       pair_address = EXCLUDED.pair_address,
       dex_id = EXCLUDED.dex_id,
       dexscreener_url = EXCLUDED.dexscreener_url,
       pair_created_at = COALESCE(EXCLUDED.pair_created_at, gem_tokens.pair_created_at),
       last_seen_at = now()`,
    [
      pair.chainId,
      pair.baseToken.address,
      pair.baseToken.symbol,
      pair.baseToken.name,
      pair.pairAddress,
      pair.dexId,
      pair.url,
      pair.pairCreatedAt,
    ],
  );
}

/** Returns the scan_id, so the caller can attach an outcome row for the scans it actually called. */
export async function insertGemScan(pool: Pool, input: PersistGemScanInput): Promise<string> {
  const { pair, evaluation, safety } = input;
  const txns = pair.txns.h24;

  const { rows } = await pool.query(
    `INSERT INTO gem_scans
      (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons,
       price_usd, liquidity_usd, volume_24h_usd, fdv_usd, price_change_24h_pct, buys_24h, sells_24h, age_days,
       safety_verdict, safety_flags, top_holder_pct, lp_locked)
     VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (chain_id, token_address, scanned_at) DO UPDATE SET gem_score = EXCLUDED.gem_score
     RETURNING scan_id`,
    [
      pair.chainId,
      pair.baseToken.address,
      input.scannedAt,
      evaluation.score ?? 0,
      JSON.stringify(evaluation.components ?? {}),
      evaluation.riskScore,
      JSON.stringify(evaluation.riskComponents),
      JSON.stringify(evaluation.reasons),
      pair.priceUsd,
      pair.liquidityUsd,
      pair.volume.h24,
      pair.fdvUsd,
      pair.priceChangePct.h24,
      txns?.buys ?? null,
      txns?.sells ?? null,
      evaluation.ageDays,
      safety?.verdict ?? null,
      safety ? JSON.stringify(safety.flags) : null,
      safety?.topHolderPct ?? null,
      safety?.lpLocked ?? null,
    ],
  );

  return rows[0]?.scan_id as string;
}

/** Only called for scans the scanner actually surfaced — see migration 004's note on why. */
export async function ensureGemOutcome(pool: Pool, scanId: string, priceAtScan: number, liquidityAtScanUsd: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO gem_outcomes (scan_id, price_at_scan, liquidity_at_scan_usd)
     VALUES ($1,$2,$3)
     ON CONFLICT (scan_id) DO NOTHING`,
    [scanId, priceAtScan, liquidityAtScanUsd],
  );
}

export interface GemRow {
  scanId: string;
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  dexId: string;
  url: string | null;
  scannedAt: number;
  gemScore: number;
  gemComponents: Record<string, number>;
  riskScore: number;
  riskComponents: Record<string, number>;
  reasons: string[];
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  ageDays: number | null;
  safetyVerdict: string | null;
  safetyFlags: string[] | null;
  topHolderPct: number | null;
  lpLocked: boolean | null;
}

/**
 * A token that stops qualifying (thresholds tightened, it fell out of the
 * eligible band, safety turned bad) is simply never re-persisted — the scan
 * loop drops ineligible pairs rather than writing a "no longer eligible"
 * row (see runScan in gem-scanner). So its last-eligible row would
 * otherwise sit here forever, looking freshly surfaced, until the 30-day
 * prune. Six scan cycles' worth of staleness is the cutoff instead: long
 * enough to tolerate one missed cycle, short enough that a token which
 * stopped qualifying actually disappears from the list within a few hours
 * rather than lingering on stale data.
 */
const DEFAULT_MAX_AGE_MINUTES = 180;

/** Latest scan row per token, highest score first — what the /gems list shows. */
export async function getLatestGems(
  pool: Pool,
  filters: { chainId?: string; minScore?: number; limit?: number; maxAgeMinutes?: number } = {},
): Promise<GemRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters.chainId) {
    params.push(filters.chainId);
    conditions.push(`s.chain_id = $${params.length}`);
  }
  if (filters.minScore !== undefined) {
    params.push(filters.minScore);
    conditions.push(`s.gem_score >= $${params.length}`);
  }
  params.push(filters.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES);
  conditions.push(`s.scanned_at >= now() - ($${params.length} || ' minutes')::interval`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filters.limit ?? 50);

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (s.chain_id, s.token_address)
            s.scan_id, s.chain_id, s.token_address, s.gem_score, s.gem_components, s.risk_score,
            s.risk_components, s.reasons, s.price_usd, s.liquidity_usd, s.volume_24h_usd, s.fdv_usd,
            s.price_change_24h_pct, s.buys_24h, s.sells_24h, s.age_days, s.safety_verdict,
            s.safety_flags, s.top_holder_pct, s.lp_locked,
            extract(epoch from s.scanned_at)*1000 AS ts,
            t.symbol, t.name, t.dex_id, t.dexscreener_url
     FROM gem_scans s
     JOIN gem_tokens t ON t.chain_id = s.chain_id AND t.token_address = s.token_address
     ${where}
     ORDER BY s.chain_id, s.token_address, s.scanned_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map(toGemRow).sort((a, b) => b.gemScore - a.gemScore);
}

export async function getGemByAddress(pool: Pool, chainId: string, tokenAddress: string): Promise<GemRow | undefined> {
  const { rows } = await pool.query(
    `SELECT s.scan_id, s.chain_id, s.token_address, s.gem_score, s.gem_components, s.risk_score,
            s.risk_components, s.reasons, s.price_usd, s.liquidity_usd, s.volume_24h_usd, s.fdv_usd,
            s.price_change_24h_pct, s.buys_24h, s.sells_24h, s.age_days, s.safety_verdict,
            s.safety_flags, s.top_holder_pct, s.lp_locked,
            extract(epoch from s.scanned_at)*1000 AS ts,
            t.symbol, t.name, t.dex_id, t.dexscreener_url
     FROM gem_scans s
     JOIN gem_tokens t ON t.chain_id = s.chain_id AND t.token_address = s.token_address
     WHERE s.chain_id = $1 AND s.token_address = $2
     ORDER BY s.scanned_at DESC
     LIMIT 1`,
    [chainId, tokenAddress],
  );
  const row = rows[0];
  return row ? toGemRow(row) : undefined;
}

/**
 * Resolves a "/watch SYMBOL" command to the most recently scanned token
 * carrying that ticker, across all chains — good enough while only one
 * chain is enabled. Symbols aren't unique on-chain (anyone can name a
 * token "DINGER"), so this is "most recently seen," not a guarantee of
 * which token the caller meant.
 */
export async function getLatestGemBySymbol(pool: Pool, symbol: string): Promise<GemRow | undefined> {
  const { rows } = await pool.query(
    `SELECT s.scan_id, s.chain_id, s.token_address, s.gem_score, s.gem_components, s.risk_score,
            s.risk_components, s.reasons, s.price_usd, s.liquidity_usd, s.volume_24h_usd, s.fdv_usd,
            s.price_change_24h_pct, s.buys_24h, s.sells_24h, s.age_days, s.safety_verdict,
            s.safety_flags, s.top_holder_pct, s.lp_locked,
            extract(epoch from s.scanned_at)*1000 AS ts,
            t.symbol, t.name, t.dex_id, t.dexscreener_url
     FROM gem_scans s
     JOIN gem_tokens t ON t.chain_id = s.chain_id AND t.token_address = s.token_address
     WHERE lower(t.symbol) = lower($1)
     ORDER BY s.scanned_at DESC
     LIMIT 1`,
    [symbol],
  );
  const row = rows[0];
  return row ? toGemRow(row) : undefined;
}

function toGemRow(r: Record<string, unknown>): GemRow {
  return {
    scanId: r['scan_id'] as string,
    chainId: r['chain_id'] as string,
    tokenAddress: r['token_address'] as string,
    symbol: r['symbol'] as string,
    name: r['name'] as string,
    dexId: r['dex_id'] as string,
    url: (r['dexscreener_url'] as string | null) ?? null,
    scannedAt: Number(r['ts']),
    gemScore: Number(r['gem_score']),
    gemComponents: (r['gem_components'] as Record<string, number>) ?? {},
    riskScore: Number(r['risk_score']),
    riskComponents: (r['risk_components'] as Record<string, number>) ?? {},
    reasons: (r['reasons'] as string[]) ?? [],
    priceUsd: numOrNull(r['price_usd']),
    liquidityUsd: numOrNull(r['liquidity_usd']),
    volume24hUsd: numOrNull(r['volume_24h_usd']),
    fdvUsd: numOrNull(r['fdv_usd']),
    priceChange24hPct: numOrNull(r['price_change_24h_pct']),
    buys24h: numOrNull(r['buys_24h']),
    sells24h: numOrNull(r['sells_24h']),
    ageDays: numOrNull(r['age_days']),
    safetyVerdict: (r['safety_verdict'] as string | null) ?? null,
    safetyFlags: (r['safety_flags'] as string[] | null) ?? null,
    topHolderPct: numOrNull(r['top_holder_pct']),
    lpLocked: (r['lp_locked'] as boolean | null) ?? null,
  };
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export interface GemAlertRecord {
  sentAt: number;
}

export async function getLastGemAlert(pool: Pool, chainId: string, tokenAddress: string): Promise<GemAlertRecord | undefined> {
  const { rows } = await pool.query(
    `SELECT extract(epoch from sent_at)*1000 AS sent_at
     FROM gem_alert_events
     WHERE chain_id = $1 AND token_address = $2
     ORDER BY sent_at DESC LIMIT 1`,
    [chainId, tokenAddress],
  );
  const row = rows[0];
  return row ? { sentAt: Number(row.sent_at) } : undefined;
}

export async function insertGemAlertEvent(
  pool: Pool,
  scanId: string,
  chainId: string,
  tokenAddress: string,
  gemScore: number,
  chatId: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO gem_alert_events (scan_id, chain_id, token_address, gem_score, chat_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [scanId, chainId, tokenAddress, gemScore, chatId],
  );
}

export type GemHorizon = '24h' | '7d';

const HORIZON_MS: Record<GemHorizon, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const HORIZON_PRICE_COLUMN: Record<GemHorizon, string> = {
  '24h': 'price_after_24h',
  '7d': 'price_after_7d',
};

const HORIZON_MOVE_COLUMN: Record<GemHorizon, string> = {
  '24h': 'move_after_24h_pct',
  '7d': 'move_after_7d_pct',
};

export interface PendingGemOutcome {
  scanId: string;
  chainId: string;
  tokenAddress: string;
  priceAtScan: number;
}

export async function getGemsPendingOutcome(pool: Pool, horizon: GemHorizon, nowMs: number, limit = 200): Promise<PendingGemOutcome[]> {
  const { rows } = await pool.query(
    `SELECT o.scan_id, s.chain_id, s.token_address, o.price_at_scan
     FROM gem_outcomes o
     JOIN gem_scans s ON s.scan_id = o.scan_id
     WHERE o.${HORIZON_PRICE_COLUMN[horizon]} IS NULL
       AND s.scanned_at <= to_timestamp($1/1000.0)
     ORDER BY s.scanned_at ASC
     LIMIT $2`,
    [nowMs - HORIZON_MS[horizon], limit],
  );
  return rows.map((r) => ({
    scanId: r.scan_id,
    chainId: r.chain_id,
    tokenAddress: r.token_address,
    priceAtScan: Number(r.price_at_scan),
  }));
}

export async function recordGemOutcome(
  pool: Pool,
  scanId: string,
  horizon: GemHorizon,
  price: number,
  priceAtScan: number,
  liquidityUsd: number | null,
): Promise<void> {
  const movePct = priceAtScan > 0 ? ((price - priceAtScan) / priceAtScan) * 100 : 0;
  const liquidityAssignment = horizon === '7d' ? ', liquidity_after_7d_usd = $5' : '';
  const params: unknown[] = [price, movePct, scanId, priceAtScan];
  if (horizon === '7d') params.push(liquidityUsd);

  await pool.query(
    `UPDATE gem_outcomes
     SET ${HORIZON_PRICE_COLUMN[horizon]} = $1, ${HORIZON_MOVE_COLUMN[horizon]} = $2, updated_at = now()${liquidityAssignment}
     WHERE scan_id = $3 AND price_at_scan = $4`,
    params,
  );
}

export interface GemPerformance {
  horizon: GemHorizon;
  sampleCount: number;
  positiveMovePct: number | null;
  negativeMovePct: number | null;
  medianMovePct: number | null;
  /** Share of surfaced tokens whose liquidity fell below 20% of what it was at scan time — the rug-ish outcome. 7d only. */
  liquidityCollapsePct: number | null;
  sufficientData: boolean;
}

const MIN_GEM_SAMPLES = 20;

/**
 * Computed only from recorded outcomes. Below MIN_GEM_SAMPLES it reports
 * `sufficientData: false` and the UI must say so rather than showing
 * percentages — the same rule the market-health performance page follows.
 */
export async function getGemPerformance(
  pool: Pool,
  horizon: GemHorizon,
  /**
   * Only count scans that scored high enough to be alerted on.
   *
   * Outcomes are now recorded for every eligible scan, because without the
   * low-scoring ones there is nothing to compare a high score against. But
   * this figure has always meant "when the scanner actually called
   * something, what happened?", and letting the extra rows in would change
   * that meaning silently — the number would drift as the alert threshold
   * moved, with nothing on the page saying so.
   *
   * Undefined counts everything, which is the honest default when the
   * caller has no scanner config to read a threshold from.
   */
  alertMinScore?: number,
): Promise<GemPerformance> {
  const moveCol = HORIZON_MOVE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT o.${moveCol} AS move, o.liquidity_at_scan_usd, o.liquidity_after_7d_usd
     FROM gem_outcomes o
     JOIN gem_scans s ON s.scan_id = o.scan_id
     WHERE o.${moveCol} IS NOT NULL
       ${alertMinScore === undefined ? '' : 'AND s.gem_score >= $1'}`,
    alertMinScore === undefined ? [] : [alertMinScore],
  );

  const moves = rows.map((r) => Number(r.move)).sort((a, b) => a - b);
  const sampleCount = moves.length;

  if (sampleCount === 0) {
    return { horizon, sampleCount: 0, positiveMovePct: null, negativeMovePct: null, medianMovePct: null, liquidityCollapsePct: null, sufficientData: false };
  }

  const positive = moves.filter((m) => m > 0).length;
  const negative = moves.filter((m) => m < 0).length;
  const mid = Math.floor(moves.length / 2);
  const median = moves.length % 2 === 0 ? ((moves[mid - 1] as number) + (moves[mid] as number)) / 2 : (moves[mid] as number);

  let liquidityCollapsePct: number | null = null;
  if (horizon === '7d') {
    const withLiquidity = rows.filter((r) => r.liquidity_at_scan_usd !== null && r.liquidity_after_7d_usd !== null);
    if (withLiquidity.length > 0) {
      const collapsed = withLiquidity.filter((r) => Number(r.liquidity_after_7d_usd) < Number(r.liquidity_at_scan_usd) * 0.2).length;
      liquidityCollapsePct = Math.round((collapsed / withLiquidity.length) * 1000) / 10;
    }
  }

  return {
    horizon,
    sampleCount,
    positiveMovePct: Math.round((positive / sampleCount) * 1000) / 10,
    negativeMovePct: Math.round((negative / sampleCount) * 1000) / 10,
    medianMovePct: Math.round(median * 100) / 100,
    liquidityCollapsePct,
    sufficientData: sampleCount >= MIN_GEM_SAMPLES,
  };
}

/** Retention: scan rows accumulate every pass. Rows backing an outcome are kept regardless of age — they're the evidence base. */
export async function pruneOldGemScans(pool: Pool, olderThanDays = 30): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM gem_scans s
     WHERE s.scanned_at < now() - ($1 || ' days')::interval
       AND NOT EXISTS (SELECT 1 FROM gem_outcomes o WHERE o.scan_id = s.scan_id)`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}

/**
 * Round-trip cost of actually taking one of these, in percent.
 *
 * Far larger than the 0,1% used for Binance futures, and the difference
 * decides everything here. A swap on a Solana AMM pays a fee each way,
 * moves the price against itself in a pool this thin, and pays a priority
 * fee to land. Three percent is a conservative round number, not a
 * measurement — it is reported alongside every figure derived from it so
 * a reader who trades tighter or wider can adjust.
 *
 * It matters because the scanner surfaces tokens whose median outcome is
 * nowhere near it. Counting a +1% move as a win is counting a loss.
 */
export const GEM_ROUND_TRIP_COST_PCT = 3;

/**
 * Score bands, fixed in advance.
 *
 * Deliberately not terciles of whatever happened to be scanned: cut points
 * chosen after seeing the data are how a scoring model with no signal gets
 * declared useful. Round numbers on a 0–100 scale, decided before looking,
 * and left alone.
 */
export const GEM_SCORE_BANDS = [
  { key: 'low', label: 'Dưới 50', min: 0, max: 49 },
  { key: 'mid', label: '50 – 69', min: 50, max: 69 },
  { key: 'high', label: '70 trở lên', min: 70, max: 100 },
] as const;

export interface GemScoreBand {
  key: string;
  label: string;
  min: number;
  max: number;
  sampleCount: number;
  positiveMovePct: number | null;
  medianMovePct: number | null;
  /** Share that moved further up than the round-trip cost — the only "win" that pays. */
  netPositiveMovePct: number | null;
  /** 7d only: share whose liquidity fell below a fifth of what it was. */
  liquidityCollapsePct: number | null;
  sufficientData: boolean;
}

export interface GemScoreEdge {
  horizon: GemHorizon;
  costPct: number;
  bands: GemScoreBand[];
  /**
   * Whether the top band beat the bottom one, judged the same way the
   * market-health page judges a signal against its baseline.
   *
   * Null when either end lacks the samples to say anything. This is the
   * whole point of the surface: if a high score does not do better than a
   * low one, the score is decoration, and every number built on top of it
   * — including the alerts — is decoration too.
   */
  verdict: { verdict: EdgeVerdict; deltaPp: number; marginPp: number | null; samplesNeeded: number | null } | null;
}

/**
 * Does a higher Gem Score actually precede better outcomes?
 *
 * Nothing answered this before. The scanner reported a score and a hit
 * rate, and the weights behind the score were, in the words of the TODO
 * that shipped with them, "starting points with no track record". So the
 * score could have been noise for months without anything saying so — and
 * unlike the futures signals, a wrong answer here is acted on with real
 * money in an illiquid market.
 *
 * The bands are compared against each other rather than against a market
 * baseline because the question is about the *score*, not about small-caps
 * as an asset: every row here already passed the same liquidity, age and
 * safety gates, so what differs between bands is the score and little else.
 */
export async function getGemScoreEdge(pool: Pool, horizon: GemHorizon): Promise<GemScoreEdge> {
  const moveCol = HORIZON_MOVE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT s.gem_score AS score,
            o.${moveCol} AS move,
            o.liquidity_at_scan_usd AS liq_at_scan,
            o.liquidity_after_7d_usd AS liq_after
       FROM gem_outcomes o
       JOIN gem_scans s ON s.scan_id = o.scan_id
      WHERE o.${moveCol} IS NOT NULL`,
  );

  const bands = bandOutcomes(rows, (r) => Number(r.score), horizon);
  return { horizon, costPct: GEM_ROUND_TRIP_COST_PCT, bands, verdict: judgeBands(bands, 1) };
}

interface BandableRow {
  move: unknown;
  liq_at_scan: unknown;
  liq_after: unknown;
}

/** Splits outcomes into the fixed bands by whatever value the caller ranks on. */
function bandOutcomes<T extends BandableRow>(
  rows: T[],
  valueOf: (row: T) => number | null,
  horizon: GemHorizon,
): GemScoreBand[] {
  return GEM_SCORE_BANDS.map((band) => {
    const inBand = rows.filter((r) => {
      const value = valueOf(r);
      return value !== null && value >= band.min && value <= band.max;
    });
    const moves = inBand.map((r) => Number(r.move));
    const sampleCount = moves.length;

    if (sampleCount === 0) {
      return {
        ...band,
        sampleCount: 0,
        positiveMovePct: null,
        medianMovePct: null,
        netPositiveMovePct: null,
        liquidityCollapsePct: null,
        sufficientData: false,
      };
    }

    const sorted = [...moves].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);

    let liquidityCollapsePct: number | null = null;
    if (horizon === '7d') {
      const withLiquidity = inBand.filter((r) => r.liq_at_scan !== null && r.liq_after !== null);
      if (withLiquidity.length > 0) {
        const collapsed = withLiquidity.filter((r) => Number(r.liq_after) < Number(r.liq_at_scan) * 0.2).length;
        liquidityCollapsePct = Math.round((collapsed / withLiquidity.length) * 1000) / 10;
      }
    }

    return {
      ...band,
      sampleCount,
      positiveMovePct: Math.round((moves.filter((m) => m > 0).length / sampleCount) * 1000) / 10,
      medianMovePct: Math.round(median * 100) / 100,
      netPositiveMovePct:
        Math.round((moves.filter((m) => m > GEM_ROUND_TRIP_COST_PCT).length / sampleCount) * 1000) / 10,
      liquidityCollapsePct,
      sufficientData: sampleCount >= MIN_GEM_SAMPLES,
    };
  });
}

/** Top band against bottom band, or null while either end is too thin to say anything. */
function judgeBands(bands: GemScoreBand[], comparisons: number): GemScoreEdge['verdict'] {
  const low = bands.find((b) => b.key === 'low');
  const high = bands.find((b) => b.key === 'high');
  if (!low?.sufficientData || !high?.sufficientData) return null;
  if (low.positiveMovePct === null || high.positiveMovePct === null) return null;

  const compared = compareToBaseline(
    high.positiveMovePct,
    high.sampleCount,
    low.positiveMovePct,
    low.sampleCount,
    comparisons,
  );
  return {
    ...compared,
    samplesNeeded:
      compared.verdict === 'indistinguishable'
        ? samplesNeeded(high.positiveMovePct, low.positiveMovePct, low.sampleCount, comparisons)
        : null,
  };
}

/**
 * The five things the Gem Score is a weighted average of, named where a
 * reader will see them.
 *
 * Keys match `gem_components`, which every scan has stored since the
 * scanner shipped — so this looks backwards over the whole history rather
 * than starting from today.
 */
export const GEM_COMPONENTS = [
  { key: 'liquidityQuality', label: 'Chất lượng thanh khoản', weight: 25 },
  { key: 'volumeConviction', label: 'Volume thuyết phục', weight: 25 },
  { key: 'buyPressure', label: 'Áp lực mua', weight: 20 },
  { key: 'survival', label: 'Sống sót (tuổi)', weight: 20 },
  { key: 'momentumStructure', label: 'Cấu trúc đà', weight: 10 },
] as const;

/**
 * Above this share in one band, a component is not ranking anything.
 *
 * `survival` returns a flat 100 for every token past the ideal age, so
 * almost every scan can score identically on it while still carrying 20%
 * of the weight. A component like that cannot be right or wrong — it is
 * inert, which is a different problem from being wrong and has a
 * different fix.
 */
const DEGENERATE_SHARE = 0.95;

export interface GemComponentEdge {
  key: string;
  label: string;
  /** Its share of the Gem Score, so a finding can be weighed against how much it currently counts. */
  weight: number;
  bands: GemScoreBand[];
  verdict: GemScoreEdge['verdict'];
  /** True when nearly every scan lands in one band: the component varies too little to rank anything. */
  degenerate: boolean;
}

/**
 * Which of the five bets the score is making actually pay.
 *
 * The score-band table says whether the total predicts anything. It cannot
 * say *which part* is carrying it, or which part is pulling the other way
 * — and with a weighted average, one component with the wrong sign can
 * cancel out four right ones and leave the total looking like noise.
 *
 * This is the cheapest possible route to a better scanner: the weights
 * shipped as guesses, and the fix for a component that ranks backwards is
 * to change one number, not to invent a new strategy.
 */
export async function getGemComponentEdges(pool: Pool, horizon: GemHorizon): Promise<GemComponentEdge[]> {
  const moveCol = HORIZON_MOVE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT s.gem_components AS components,
            o.${moveCol} AS move,
            o.liquidity_at_scan_usd AS liq_at_scan,
            o.liquidity_after_7d_usd AS liq_after
       FROM gem_outcomes o
       JOIN gem_scans s ON s.scan_id = o.scan_id
      WHERE o.${moveCol} IS NOT NULL`,
  );

  // Five tests off one screen, so each is judged against a wider interval
  // than it would be alone — the same correction the performance page
  // makes, for the same reason: run enough comparisons and one of them
  // looks significant by luck.
  const comparisons = GEM_COMPONENTS.length;

  return GEM_COMPONENTS.map(({ key, label, weight }) => {
    const valueOf = (r: (typeof rows)[number]): number | null => {
      const raw = (r.components as Record<string, unknown> | null)?.[key];
      return typeof raw === 'number' ? raw : null;
    };
    const bands = bandOutcomes(rows, valueOf, horizon);
    const scored = rows.filter((r) => valueOf(r) !== null).length;
    const largestBand = Math.max(...bands.map((b) => b.sampleCount));

    return {
      key,
      label,
      weight,
      bands,
      verdict: judgeBands(bands, comparisons),
      degenerate: scored > 0 && largestBand / scored >= DEGENERATE_SHARE,
    };
  });
}

