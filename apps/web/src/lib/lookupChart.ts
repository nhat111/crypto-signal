/**
 * Pure helpers behind the Lookup chart and its shareable link.
 *
 * The web app has no workspace deps, so the EMA is re-implemented here. It
 * must match `computeEma` in packages/indicators (SMA seed over the first
 * `period` values, then the usual 2/(n+1) smoothing): the chart draws the
 * same EMA20/50 the trend line in the text read is computed from, and two
 * definitions would draw lines that disagree with the words beside them.
 */

export interface EmaPoint {
  index: number;
  value: number;
}

/** EMA at every bar from the `period`-th on; earlier bars have no value. */
export function emaSeries(values: number[], period: number): EmaPoint[] {
  if (period <= 0 || values.length < period) return [];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: EmaPoint[] = [{ index: period - 1, value: ema }];
  for (let i = period; i < values.length; i += 1) {
    ema = (values[i] as number) * k + ema * (1 - k);
    out.push({ index: i, value: ema });
  }
  return out;
}

export const LOOKUP_TIMEFRAMES = ['15m', '1h', '4h'] as const;
const DEFAULT_TIMEFRAME = '4h';

export interface LookupParams {
  q: string;
  tf: string;
}

/**
 * `/lookup?q=NEARUSDT&tf=1h` — what the Telegram bot links to. An unknown
 * frame falls back to the default rather than failing, since the link is
 * typed by people too.
 */
export function parseLookupParams(params: URLSearchParams): LookupParams {
  const q = (params.get('q') ?? '').trim();
  const tf = params.get('tf') ?? '';
  return { q, tf: (LOOKUP_TIMEFRAMES as readonly string[]).includes(tf) ? tf : DEFAULT_TIMEFRAME };
}

export function lookupSearch({ q, tf }: LookupParams): string {
  return `?${new URLSearchParams({ q, tf }).toString()}`;
}
