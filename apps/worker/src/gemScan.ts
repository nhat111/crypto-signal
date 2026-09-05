import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import {
  DexScreenerSource,
  GeckoTerminalSource,
  RugCheckSource,
  runScan,
  type GemConfig,
  type ScoredGem,
} from '@crypto-signal/gem-scanner';
import {
  ensureGemOutcome,
  getAllAlertSubscribers,
  getBaselinePendingOutcome,
  getGemsPendingOutcome,
  getLastGemAlert,
  insertGemAlertEvent,
  insertGemBaselineCandidates,
  insertGemScan,
  pruneOldGemScans,
  recordGemBaselineOutcome,
  recordGemOutcome,
  upsertGemToken,
  type GemHorizon,
} from '@crypto-signal/db';
import type { TelegramNotifier } from './telegramNotifier.js';

export interface GemScanDeps {
  pool: Pool;
  logger: Logger;
  gemConfig: GemConfig;
  notifier: TelegramNotifier;
  telegramAlertChatIds: string[];
}

/**
 * How many rejected candidates each scan keeps as a control group.
 *
 * Small on purpose. The control only has to be large enough to answer
 * "did passing the filter beat not bothering", and every row costs a price
 * lookup at both horizons against a rate-limited free API. At one scan
 * every 30 minutes this reaches the 20-sample threshold within a day.
 */
const BASELINE_SAMPLE_PER_SCAN = 5;

/**
 * Wires the gem scanner's sources and runs one pass per configured chain.
 *
 * Lives in the worker alongside the Binance collector for the same reason
 * everything else does: it's background work that must never sit in an API
 * request path. It shares nothing with the market-health pipeline beyond
 * the process and the database.
 */
export async function runGemScanCycle(deps: GemScanDeps): Promise<void> {
  const { pool, logger, gemConfig } = deps;

  const dexscreener = new DexScreenerSource({ logger });
  const geckoterminal = new GeckoTerminalSource({ logger });
  const rugcheck = new RugCheckSource({ logger, apiKey: gemConfig.rugcheckApiKey || undefined });

  for (const chainId of gemConfig.chains) {
    try {
      const result = await runScan(
        {
          discoverySources: [dexscreener, geckoterminal],
          pairSource: dexscreener,
          safetySource: rugcheck,
          config: gemConfig,
          logger,
          baselineSampleSize: BASELINE_SAMPLE_PER_SCAN,
        },
        chainId,
      );

      for (const gem of result.eligible) {
        await persistAndMaybeAlert(deps, gem, result.scannedAt);
      }

      // The control group. Without it the performance page reports a hit
      // rate with nothing to compare it against, which is the one thing
      // this codebase refuses to publish anywhere else.
      const baselineKept = await insertGemBaselineCandidates(
        pool,
        result.baselineSample.map((c) => ({
          chainId: c.chainId,
          tokenAddress: c.tokenAddress,
          observedAt: result.scannedAt,
          priceUsd: c.priceUsd,
          liquidityUsd: c.liquidityUsd,
          failures: c.failures,
        })),
      );

      logger.info(
        {
          chainId,
          candidates: result.candidateCount,
          eligible: result.eligible.length,
          rejected: result.rejectedCount,
          baselineKept,
        },
        'gem scan cycle complete',
      );
    } catch (err) {
      logger.error({ err, chainId }, 'gem scan cycle failed');
    }
  }
}

/** Exported as a test seam: the outcome row it writes is what the whole gem performance surface is computed from. */
export async function persistAndMaybeAlert(deps: GemScanDeps, gem: ScoredGem, scannedAt: number): Promise<void> {
  const { pool, logger, gemConfig } = deps;
  const { pair, evaluation } = gem;

  await upsertGemToken(pool, pair);
  const scanId = await insertGemScan(pool, { pair, evaluation, safety: gem.safety, scannedAt });

  const score = evaluation.score ?? 0;

  // Every eligible scan gets an outcome row, not only the ones scoring high
  // enough to alert on.
  //
  // Tracking only the alerted ones seemed right — the performance page was
  // meant to answer "when this flagged something, what happened?" — but it
  // quietly made the more important question unanswerable. With outcomes
  // recorded only above the alert threshold, every row in the table scored
  // 70+, so there was nothing to compare a high score against and no way to
  // tell whether the score predicted anything at all. The first real
  // reading of the score-band table showed exactly that: 55 rows, all of
  // them in one band.
  //
  // The headline still answers the original question — the performance
  // query filters by the alert threshold — while these extra rows are what
  // make the band comparison possible.
  if (pair.priceUsd !== null) {
    await ensureGemOutcome(pool, scanId, pair.priceUsd, pair.liquidityUsd);
  }

  if (score < gemConfig.alert.minScore) return;

  const lastAlert = await getLastGemAlert(pool, pair.chainId, pair.baseToken.address);
  const cooldownMs = gemConfig.alert.cooldownHours * 60 * 60 * 1000;
  if (lastAlert && Date.now() - lastAlert.sentAt < cooldownMs) return;

  const text = formatGemAlert(gem);
  const subscribers = await getAllAlertSubscribers(pool);
  const chatIds = Array.from(
    new Set([...deps.telegramAlertChatIds, ...subscribers.filter((s) => s.alertsEnabled).map((s) => s.chatId)]),
  );

  if (chatIds.length === 0) {
    await insertGemAlertEvent(pool, scanId, pair.chainId, pair.baseToken.address, score, null);
    return;
  }

  for (const chatId of chatIds) {
    await deps.notifier.send(chatId, text);
    await insertGemAlertEvent(pool, scanId, pair.chainId, pair.baseToken.address, score, chatId);
  }

  logger.info({ symbol: pair.baseToken.symbol, score, riskScore: evaluation.riskScore }, 'gem alert sent');
}

export function formatGemAlert(gem: ScoredGem): string {
  const { pair, evaluation } = gem;
  const lines = [
    '💎 <b>SMALL-CAP CANDIDATE</b>',
    '',
    `<b>${escapeHtml(pair.baseToken.symbol)}</b> — ${escapeHtml(pair.baseToken.name)}`,
    `${pair.chainId} · ${pair.dexId}`,
    '',
    `Gem Score: ${evaluation.score}/100`,
    `Risk Score: ${evaluation.riskScore}/100`,
    '',
    '<b>Why:</b>',
    ...evaluation.reasons.map((r, i) => `${i + 1}. ${escapeHtml(r)}`),
  ];
  if (pair.url) lines.push('', pair.url);
  return lines.join('\n');
}

/** Token names come from on-chain metadata that anyone can set, so they're escaped before going into an HTML-parsed message. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HORIZONS: GemHorizon[] = ['24h', '7d'];

/**
 * Fills in what actually happened after each surfaced token, using a fresh
 * price from the same source that produced the original scan.
 */
export async function runGemOutcomeTracker(deps: GemScanDeps): Promise<void> {
  const { pool, logger, gemConfig } = deps;
  const dexscreener = new DexScreenerSource({ logger });
  const now = Date.now();

  for (const horizon of HORIZONS) {
    const pending = await getGemsPendingOutcome(pool, horizon, now);
    // The control group, priced at the same horizons from the same source.
    // A baseline measured differently from the thing it is a baseline for
    // is not a baseline.
    const pendingBaseline = await getBaselinePendingOutcome(pool, horizon, now);
    if (pending.length === 0 && pendingBaseline.length === 0) continue;

    // Group by chain so each chain's addresses batch into as few calls as
    // possible — and so the control's lookups ride along in the same call
    // rather than doubling the API budget.
    const byChain = new Map<string, { scans: typeof pending; baseline: typeof pendingBaseline }>();
    const bucket = (chainId: string) => {
      const existing = byChain.get(chainId) ?? { scans: [], baseline: [] };
      byChain.set(chainId, existing);
      return existing;
    };
    for (const row of pending) bucket(row.chainId).scans.push(row);
    for (const row of pendingBaseline) bucket(row.chainId).baseline.push(row);

    for (const [chainId, rows] of byChain) {
      try {
        const addresses = [
          ...new Set([...rows.scans.map((r) => r.tokenAddress), ...rows.baseline.map((r) => r.tokenAddress)]),
        ];
        const pairs = await dexscreener.fetchPairsForTokens(chainId, addresses);
        const byToken = new Map(pairs.map((p) => [p.baseToken.address, p]));

        for (const row of rows.scans) {
          const pair = byToken.get(row.tokenAddress);
          // No current pair usually means the pool is gone — which is itself
          // the outcome. Recording price 0 would assert a price we never
          // observed, so it's left pending and reported as unresolved.
          if (!pair || pair.priceUsd === null) continue;
          await recordGemOutcome(pool, row.scanId, horizon, pair.priceUsd, row.priceAtScan, pair.liquidityUsd);
        }

        for (const row of rows.baseline) {
          const pair = byToken.get(row.tokenAddress);
          // Same rule as above, and it matters more here: silently dropping
          // dead controls while keeping dead picks would bias the
          // comparison in the scanner's favour. Both sides stay pending.
          if (!pair || pair.priceUsd === null) continue;
          await recordGemBaselineOutcome(
            pool,
            row.candidateId,
            horizon,
            pair.priceUsd,
            row.priceAtObservation,
            pair.liquidityUsd,
          );
        }
      } catch (err) {
        logger.warn({ err, chainId, horizon }, 'gem outcome tracking failed for this chain');
      }
    }

    logger.info(
      { horizon, count: pending.length, baselineCount: pendingBaseline.length },
      'gem outcome tracker pass complete',
    );
  }

  if (gemConfig.enabled) {
    const pruned = await pruneOldGemScans(pool, 30);
    if (pruned > 0) logger.info({ pruned }, 'pruned old gem scan rows');
  }
}
