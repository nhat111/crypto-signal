/**
 * The timeframe a command answers on: what the message asked for, or the
 * configured default.
 *
 * The default used to be 15m, hard-coded into /status and every symbol
 * command. For someone buying spot that is the noisiest frame collected —
 * a health reading that flips several times inside a single decision — and
 * it did not match the 4h horizon the performance page and the signal
 * verdicts are measured at, so the bot's answer and the evidence about
 * whether that answer has ever been worth anything sat on different
 * clocks.
 *
 * An unrecognised argument is refused rather than ignored. Quietly
 * answering on a frame other than the one asked for is the kind of wrong
 * that gets believed.
 */
export type TimeframeChoice = { timeframe: string } | { error: string };

export function parseTimeframeArg(
  text: string | undefined,
  collected: readonly string[],
  fallback: string,
): TimeframeChoice {
  const arg = text?.trim().split(/\s+/)[1];
  if (arg === undefined || arg === '') return { timeframe: fallback };
  // Case-insensitive: "/status 4H" is unambiguously the same request.
  const match = collected.find((tf) => tf.toLowerCase() === arg.toLowerCase());
  if (match !== undefined) return { timeframe: match };
  return { error: `Khung "${arg}" không có. Đang thu thập: ${collected.join(', ')}.` };
}
