import pg from 'pg';
import { createLogger, loadConfig, type SymbolId, type Timeframe } from '@crypto-signal/shared';
import { BinanceFuturesAdapter, BinanceSpotAdapter } from '@crypto-signal/market-data';
import {
  runHistoryBackfill,
  resolveBackfilledOutcomes,
  OPEN_INTEREST_HISTORY_DAYS,
  UNREPLAYABLE_SIGNAL_TYPES,
  type BackfillDeps,
} from './historyBackfill.js';

/**
 * One-shot historical replay. Run it, let it finish, done — it is not a
 * scheduled job and deliberately does not run at worker startup: it makes
 * dozens of upstream requests per symbol and rewrites a month of rows, so
 * it should happen when someone means it to.
 *
 *   npm run backfill -w @crypto-signal/worker
 *   BACKFILL_DAYS=14 npm run backfill -w @crypto-signal/worker
 *
 * Safe to re-run: every write is upserted, and a live row is never
 * overwritten by a replayed one.
 */
function parseDays(): number {
  const raw = process.env.BACKFILL_DAYS;
  if (!raw) return OPEN_INTEREST_HISTORY_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BACKFILL_DAYS must be a positive number, got "${raw}"`);
  }
  return parsed;
}

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('backfill', config.logLevel);

  const days = parseDays();
  const symbols = (parseList(process.env.BACKFILL_SYMBOLS) ?? [...config.symbols, ...config.futuresOnlySymbols]) as SymbolId[];
  const timeframes = (parseList(process.env.BACKFILL_TIMEFRAMES) ?? config.timeframes) as Timeframe[];

  if (symbols.length === 0) {
    logger.error({}, 'no symbols to backfill — set SYMBOLS/FUTURES_ONLY_SYMBOLS or BACKFILL_SYMBOLS');
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });

  const deps: BackfillDeps = {
    pool,
    spotAdapter: new BinanceSpotAdapter({ restBase: config.binance.spotRestBase, wsBase: config.binance.spotWsBase, logger }),
    futuresAdapter: new BinanceFuturesAdapter({ restBase: config.binance.futuresRestBase, wsBase: config.binance.futuresWsBase, logger }),
    thresholds: config.thresholds,
    healthWeights: config.healthWeights,
    riskWeights: config.riskWeights,
    confidenceWeights: config.confidenceWeights,
    futuresOnlySymbolSet: new Set(config.futuresOnlySymbols),
    logger,
  };

  logger.info({ symbols, timeframes, days }, 'starting historical replay');

  try {
    const summary = await runHistoryBackfill(deps, { symbols, timeframes, days });
    const outcomes = await resolveBackfilledOutcomes(deps);

    logger.info(
      {
        evaluatedCandles: summary.totalEvaluated,
        signalsWritten: summary.totalSignals,
        outcomesResolved: outcomes.resolved,
        outcomesUnresolved: outcomes.unresolved,
        effectiveDays: summary.effectiveDays,
        // Stated on every run so a zero count for these is never read as
        // "this pattern never occurs" — it cannot occur in a replay.
        cannotBeReplayed: UNREPLAYABLE_SIGNAL_TYPES,
      },
      'historical replay complete',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
