import type { Pool } from 'pg';
import type { Logger, SymbolId, Timeframe } from '@crypto-signal/shared';
import { getJobHealth, recordJobFailure, recordJobSuccess } from '@crypto-signal/db';
import { runHistoryBackfill, resolveBackfilledOutcomes, type BackfillDeps } from './historyBackfill.js';

/**
 * Lets the historical replay be triggered by setting an environment
 * variable, because on Railway there is no way to get a shell inside a
 * running container. Without this, `node backfill.cjs` is a command with
 * nowhere to type it — and the replay is time-sensitive: Binance serves
 * only the last 30 days of open interest, so every day it goes unrun is a
 * day of history lost for good.
 *
 * Set BACKFILL_DAYS to the number of days and redeploy. The worker replays
 * once, then carries on as normal. It is the same variable the standalone
 * `backfill.cjs` entry point reads, deliberately: two names for one value
 * meant the operator reached for whichever they had seen last, and only
 * one of them did anything on a platform without a shell.
 */
export const JOB_HISTORY_BACKFILL = 'history_backfill';

/**
 * Containers restart on their own — a crash loop, a platform migration, a
 * memory limit. If the variable is left set, each restart would kick off
 * another 30-day replay and hundreds of upstream requests. So a recent
 * success suppresses the next run, which also means the variable can be
 * left in place: it becomes "replay at most once a day" rather than a
 * loaded gun.
 */
const MIN_HOURS_BETWEEN_RUNS = 20;

export interface BackfillOnBootDeps {
  pool: Pool;
  logger: Logger;
  deps: BackfillDeps;
  symbols: SymbolId[];
  timeframes: Timeframe[];
}

export function parseBackfillDays(raw: string | undefined): number | null {
  if (!raw) return null;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return null;
  return days;
}

/** True when enough time has passed since the last successful replay. */
export function shouldRunBackfill(lastSuccessAt: number | null | undefined, nowMs: number): boolean {
  if (lastSuccessAt === null || lastSuccessAt === undefined) return true;
  return nowMs - lastSuccessAt >= MIN_HOURS_BETWEEN_RUNS * 60 * 60_000;
}

export async function maybeBackfillOnBoot(
  input: BackfillOnBootDeps,
  rawDays: string | undefined,
  nowMs: number = Date.now(),
): Promise<void> {
  const { pool, logger } = input;

  const days = parseBackfillDays(rawDays);
  if (days === null) {
    if (rawDays) logger.warn({ BACKFILL_DAYS: rawDays }, 'BACKFILL_DAYS is not a positive number — ignoring');
    return;
  }

  const health = await getJobHealth(pool, JOB_HISTORY_BACKFILL);
  if (!shouldRunBackfill(health?.lastSuccessAt, nowMs)) {
    logger.info(
      { lastSuccessAt: health?.lastSuccessAt, minHoursBetweenRuns: MIN_HOURS_BETWEEN_RUNS },
      'history replay already ran recently — skipping. Remove BACKFILL_DAYS once you are done.',
    );
    return;
  }

  logger.info({ days, symbols: input.symbols, timeframes: input.timeframes }, 'history replay starting');

  try {
    const summary = await runHistoryBackfill(input.deps, {
      symbols: input.symbols,
      timeframes: input.timeframes,
      days,
    });
    // A replay that scored nothing is a failure, whatever the individual
    // windows reported. runHistoryBackfill catches per-window errors so one
    // bad symbol cannot discard the rest — which means every window can
    // fail and it still returns normally. Recording that as success is the
    // same lie the stablecoin job used to tell: green on the status page
    // while nothing happened.
    if (summary.totalEvaluated === 0) {
      await recordJobFailure(
        pool,
        JOB_HISTORY_BACKFILL,
        new Error(
          `replay scored no candles (${summary.failedWindows} of ${input.symbols.length * input.timeframes.length} windows failed) — check upstream errors above`,
        ),
      );
      logger.error(
        { failedWindows: summary.failedWindows, effectiveDays: summary.effectiveDays },
        'history replay produced nothing — recorded as a failure, not a run',
      );
      return;
    }

    const outcomes = await resolveBackfilledOutcomes(input.deps);
    await recordJobSuccess(pool, JOB_HISTORY_BACKFILL);

    logger.info(
      {
        evaluatedCandles: summary.totalEvaluated,
        signalsWritten: summary.totalSignals,
        outcomesResolved: outcomes.resolved,
        outcomesUnresolved: outcomes.unresolved,
        effectiveDays: summary.effectiveDays,
        cannotBeReplayed: summary.unreplayableSignalTypes,
        // Surfaced even on a good run: some windows failing while others
        // worked is a partial replay, and it should not read as a clean one.
        failedWindows: summary.failedWindows,
      },
      'history replay complete — remove BACKFILL_DAYS to stop it re-running',
    );
  } catch (err) {
    // Recorded rather than only logged: the status page is where someone
    // will actually look, and a replay that failed silently leaves
    // /performance short of samples with no explanation.
    await recordJobFailure(pool, JOB_HISTORY_BACKFILL, err).catch(() => {});
    logger.error({ err }, 'history replay failed — the collector keeps running');
  }
}
