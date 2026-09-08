import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import { baselineReadiness, formatBaselineReport, type BaselineReportInput } from '@crypto-signal/shared';
import {
  getAllAlertSubscribers,
  getGemPerformance,
  getLastBaselineAnnouncement,
  recordBaselineAnnouncement,
  type GemHorizon,
} from '@crypto-signal/db';
import type { TelegramNotifier } from './telegramNotifier.js';

/**
 * Tells you whether the scanner beats its own rejects, without being asked.
 *
 * The answer decides whether the gem side of this system should be running
 * at all, and until now reading it depended on somebody opening a page and
 * remembering what the card meant. Anything that important should arrive.
 */

export type AnnounceDecision =
  | { send: false; why: 'not_ready' | 'unchanged' }
  | { send: true; why: 'first_verdict' | 'verdict_changed'; verdict: string };

/**
 * Send on the first verdict, and on every change after it.
 *
 * Not "announce once": a flip from 'beats' to 'worse' is the single most
 * important thing this system can say, and a once-only rule would swallow
 * exactly that. Not "announce on a schedule" either — a number that repeats
 * weekly while saying nothing new trains the reader to skip it, and then
 * the one that matters is skipped too.
 *
 * Sample growth alone is deliberately not a reason to re-send. The verdict
 * already accounts for sample size through its margin; re-announcing
 * because 40 became 60 would be noise dressed as news.
 */
export function decideAnnouncement(
  performance: BaselineReportInput,
  lastVerdict: string | undefined,
): AnnounceDecision {
  const readiness = baselineReadiness(performance);
  if (readiness.state !== 'ready') return { send: false, why: 'not_ready' };
  if (lastVerdict === undefined) return { send: true, why: 'first_verdict', verdict: readiness.verdict };
  if (lastVerdict !== readiness.verdict) return { send: true, why: 'verdict_changed', verdict: readiness.verdict };
  return { send: false, why: 'unchanged' };
}

export interface BaselineAnnounceDeps {
  pool: Pool;
  logger: Logger;
  notifier: TelegramNotifier;
  /** Configured recipients; opted-in subscribers are added to these, same as the gem alert path. */
  telegramAlertChatIds: string[];
  /** Matches the alert threshold so "when the scanner called something" keeps meaning that. */
  alertMinScore?: number;
  horizon?: GemHorizon;
}

export async function runBaselineAnnounceCycle(deps: BaselineAnnounceDeps): Promise<AnnounceDecision> {
  const { pool, logger, notifier } = deps;
  const horizon: GemHorizon = deps.horizon ?? '7d';

  const performance = await getGemPerformance(pool, horizon, deps.alertMinScore);
  const last = await getLastBaselineAnnouncement(pool, horizon);
  const decision = decideAnnouncement(performance, last?.verdict);

  if (!decision.send) {
    logger.debug({ horizon, why: decision.why }, 'baseline announcement not due');
    return decision;
  }

  // Resolved only once there is something to send, so a cycle that is not
  // due costs no query.
  const subscribers = await getAllAlertSubscribers(pool);
  const chatIds = Array.from(
    new Set([...deps.telegramAlertChatIds, ...subscribers.filter((s) => s.alertsEnabled).map((s) => s.chatId)]),
  );
  if (chatIds.length === 0) {
    // Nobody to tell is not an error, but it must not be recorded as
    // announced either — otherwise the first subscriber to arrive would
    // never hear a verdict that had already "happened".
    logger.warn({ horizon, verdict: decision.verdict }, 'baseline verdict ready but no alert recipients');
    return { send: false, why: 'unchanged' };
  }

  const text = formatBaselineReport(performance).join('\n');
  for (const chatId of chatIds) {
    await notifier.send(chatId, text);
  }

  // Recorded after the sends, so a failure to deliver leaves it due next
  // cycle rather than marking it announced to nobody.
  const b = performance.baseline;
  await recordBaselineAnnouncement(pool, {
    horizon,
    verdict: decision.verdict,
    scannerSampleCount: performance.sampleCount,
    baselineSampleCount: b?.sampleCount ?? 0,
    deltaPp: b?.deltaPp ?? 0,
    marginPp: b?.marginPp ?? null,
  });

  logger.info({ horizon, verdict: decision.verdict, why: decision.why, chats: chatIds.length }, 'baseline verdict announced');
  return decision;
}
