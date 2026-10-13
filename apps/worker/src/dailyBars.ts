import type { DailyBar } from '@crypto-signal/market-data';

export type DailyBarSource = 'binance' | 'okx';

type FetchDaily = (symbol: string, limit: number, now: number) => Promise<DailyBar[]>;

export interface DailyBarsResult {
  bars: DailyBar[];
  source: DailyBarSource;
}

/**
 * Closed daily bars from Binance, or from OKX when Binance refused this
 * server.
 *
 * Free hosts share outbound IPs, so Binance bans the server for somebody
 * else's traffic (418) — once for 31 hours straight, which stopped the 1D
 * trend, the setup scan and the morning digest together. The trend label
 * reads EMA200 and swing points off daily closes, where a few hundredths of
 * a percent between two exchanges cannot change the answer, so OKX is good
 * enough for it. Anything priced or scored (setups) records `source` with
 * the row and is resolved only on bars from that same source.
 *
 * A Binance 400 means the symbol itself is wrong, which OKX cannot fix, so
 * it is rethrown. An empty OKX answer (pair not listed there) rethrows the
 * original Binance error: that is the failure worth reading on /status.
 */
export async function fetchDailyBarsWithFallback(
  binance: FetchDaily,
  okx: FetchDaily | null,
  symbol: string,
  limit: number,
  now: number,
): Promise<DailyBarsResult> {
  try {
    return { bars: await binance(symbol, limit, now), source: 'binance' };
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (okx === null || status === 400) throw err;

    let bars: DailyBar[];
    try {
      bars = await okx(symbol, limit, now);
    } catch (okxErr) {
      throw new Error(`${messageOf(err)} — OKX fallback failed too: ${messageOf(okxErr)}`);
    }
    if (bars.length === 0) throw err;
    return { bars, source: 'okx' };
  }
}

/** The line added to the trend's reasons, so the badge says where its bars came from. */
export const OKX_TREND_REASON = 'Nến 1D lấy từ OKX vì Binance đang chặn IP máy chủ — giá có thể lệch rất ít so với Binance.';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
