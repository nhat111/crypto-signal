import { SEVERITY_ORDER, type Signal } from '@crypto-signal/signal-engine';
import type { LastSignalAlert } from '@crypto-signal/db';

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
