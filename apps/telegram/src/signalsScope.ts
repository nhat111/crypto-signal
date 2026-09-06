/**
 * Which timeframes `/signals` lists.
 *
 * It used to list the ten most recent signals across every frame, which in
 * practice meant 5m and 15m: the short frames fire far more often, so they
 * crowd out everything else. Meanwhile alerts are armed on whatever
 * ALERT_TIMEFRAMES says — 1h and 4h here. The bot was therefore showing a
 * list with no relationship to what it would actually message about, and
 * the obvious reading of that list ("so it alerts on 5m?") was wrong.
 *
 * The default is now the armed set, so the list answers the question the
 * reader is really asking: what kind of thing will this bot wake me for.
 * `all` is still one word away, because the old behaviour is genuinely
 * useful when looking at what the engine as a whole is producing.
 */
export type SignalsScope =
  /** Whatever the worker is armed to alert on, resolved at request time. */
  | { kind: 'armed' }
  | { kind: 'all' }
  | { kind: 'explicit'; timeframe: string }
  | { error: string };

export function parseSignalsArg(text: string | undefined, collected: readonly string[]): SignalsScope {
  const arg = text?.trim().split(/\s+/)[1];
  if (arg === undefined || arg === '') return { kind: 'armed' };

  const lower = arg.toLowerCase();
  if (lower === 'all' || lower === 'tất' || lower === 'tatca') return { kind: 'all' };

  const match = collected.find((tf) => tf.toLowerCase() === lower);
  if (match !== undefined) return { kind: 'explicit', timeframe: match };

  // Refused rather than ignored: quietly answering on a different frame
  // than the one asked for is the kind of wrong that gets believed.
  return { error: `Khung "${arg}" không có. Đang thu thập: ${collected.join(', ')}. Hoặc dùng "all".` };
}

/**
 * The timeframes to actually query, plus the line explaining the choice.
 *
 * `armed` is null when the worker has not reported its arming — an older
 * worker, or one that has not sent a heartbeat yet. That falls back to
 * every frame AND says so, because a silently unfiltered list is exactly
 * the state this whole change exists to end.
 */
export interface ResolvedScope {
  /** Empty means no filter — every timeframe. */
  timeframes: string[];
  note: string;
}

export function resolveSignalsScope(scope: Exclude<SignalsScope, { error: string }>, armed: string[] | null): ResolvedScope {
  if (scope.kind === 'all') {
    return { timeframes: [], note: 'Mọi khung đang thu thập.' };
  }
  if (scope.kind === 'explicit') {
    return { timeframes: [scope.timeframe], note: `Chỉ khung ${scope.timeframe}.` };
  }

  if (armed === null) {
    return {
      timeframes: [],
      note: 'Không đọc được khung đang bắn alert — đang hiện mọi khung. Kiểm tra worker ở /status.',
    };
  }
  if (armed.length === 0) {
    // A real state: ALERT_TIMEFRAMES set to something the collector does
    // not produce. The bot alerts on nothing, and saying "no signals"
    // would read as a quiet market.
    return {
      timeframes: [],
      note: 'Worker không bắn alert ở khung nào — đang hiện mọi khung. Kiểm tra ALERT_TIMEFRAMES ở /status.',
    };
  }
  return { timeframes: armed, note: `Khung bot sẽ bắn alert: ${armed.join(', ')}. Xem hết bằng /signals all.` };
}
