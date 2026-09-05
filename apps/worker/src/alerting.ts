import { SEVERITY_ORDER, type Signal } from '@crypto-signal/signal-engine';
import type { Timeframe } from '@crypto-signal/shared';
import type { LastSignalAlert } from '@crypto-signal/db';

/**
 * Whether this frame is one the reader asked to be pushed.
 *
 * Separate from `shouldSendAlert` below because it answers a different
 * question and must not be confused with cooldown: cooldown asks "have I
 * already said this", this asks "does this person want to hear about 5m
 * candles at all". A spot holder does not, and being woken by one is how
 * the channel gets muted.
 *
 * A filtered-out signal is still written to `market_signals` and still
 * scored on /performance — only the push is skipped.
 */
export function isAlertingTimeframe(timeframe: Timeframe, allowed: Timeframe[]): boolean {
  return allowed.includes(timeframe);
}

/**
 * Spec §21: cooldown per (symbol, timeframe, signal type); re-alert early
 * only if severity increased, confidence changed a lot, or — since the
 * caller only calls this once a rule has already fired — the signal is
 * effectively in a new state. Pure function, no DB/Telegram calls, so it's
 * directly unit-testable (spec §37/§10 "duplicate event"-style guarantees
 * extend naturally to "duplicate alert").
 */
export function shouldSendAlert(
  signal: Signal,
  lastAlert: LastSignalAlert | undefined,
  cooldownMinutes: number,
  confidenceDeltaRetrigger: number,
  nowMs: number,
): boolean {
  if (!lastAlert) return true;

  const elapsedMinutes = (nowMs - lastAlert.sentAt) / 60_000;
  if (elapsedMinutes >= cooldownMinutes) return true;

  const severityIncreased = SEVERITY_ORDER.indexOf(signal.severity) > SEVERITY_ORDER.indexOf(lastAlert.severity);
  const confidenceChanged = Math.abs(signal.confidence - lastAlert.confidence) >= confidenceDeltaRetrigger;

  return severityIncreased || confidenceChanged;
}
