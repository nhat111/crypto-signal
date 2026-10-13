import type { CoinScanThresholds } from '@crypto-signal/shared';

/**
 * The wide coin scan: for the most-traded coins, two questions a daily
 * chart of one coin cannot answer on its own.
 *
 * 1. Is it beating BTC? Most alts are BTC with extra volatility. A coin
 *    whose ratio to BTC is rising — and that holds up on the days BTC
 *    falls — is the only kind that has something of its own going on.
 * 2. Who is moving it? The same question the deep pipeline asks per
 *    candle, asked of a week: spot buyers (taker skew from the kline's own
 *    taker-buy field), or leverage (open interest in contracts, funding).
 *
 * Pure: bars and series in, numbers and a label out. No composite score —
 * relative strength and flow are separate columns, for the same reason
 * Health and Risk are separate axes. Nothing here predicts; each label
 * describes the last seven closed days and says so.
 */

/** A closed daily bar with the two volume fields the flow read needs. Structural, so market-data's bars fit without a dependency. */
export interface CoinDailyBar {
  openTime: number;
  close: number;
  quoteVolume: number;
  takerBuyQuoteVolume: number;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  quoteVolume: number;
  closeTime: number;
}

export interface CoinUniverseEntry {
  symbol: string;
  base: string;
  /** 1-based, by 24h spot quote volume. */
  rank: number;
  spotQuoteVolume24h: number;
  /** The USDT perpetual for the same coin, which Binance sometimes lists per 1000 units (1000PEPEUSDT). Null when there is none. */
  futuresSymbol: string | null;
  futuresQuoteVolume24h: number | null;
}

export const BENCHMARK_SYMBOL = 'BTCUSDT';

/**
 * Bases that are not coins anyone takes a view on: dollars, euros and
 * wrapped copies of something already in the list. They sit near the top
 * of every volume ranking and would push real coins out of it.
 */
const EXCLUDED_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDE', 'USD1', 'PYUSD', 'RLUSD', 'USDS', 'XUSD', 'BFUSD',
  'USDD', 'FRAX', 'LUSD', 'GUSD', 'SUSD', 'EUR', 'EURI', 'AEUR', 'GBP', 'TRY', 'BRL', 'WBTC', 'WBETH', 'BETH',
  'BNSOL', 'WSTETH', 'STETH', 'CBBTC',
]);

/** A ticker older than this belongs to a halted or delisted pair, whatever its volume field still says. */
const STALE_TICKER_MS = 2 * 86_400_000;

/**
 * Which coins to read: the top N USDT spot pairs by 24h quote volume,
 * minus stablecoins and wrapped tokens, each matched to its perpetual.
 * BTC is always included, because every relative-strength number is
 * measured against it.
 */
export function pickCoinUniverse(spot: Ticker24h[], futures: Ticker24h[], topN: number, now: number): CoinUniverseEntry[] {
  const live = (t: Ticker24h): boolean => t.quoteVolume > 0 && now - t.closeTime <= STALE_TICKER_MS;
  const futuresBySymbol = new Map(futures.filter(live).map((t) => [t.symbol, t]));

  const candidates = spot
    .filter((t) => t.symbol.endsWith('USDT') && t.symbol.length > 4 && live(t))
    .filter((t) => !EXCLUDED_BASES.has(t.symbol.slice(0, -4)))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  const picked = candidates.slice(0, topN);
  const btc = candidates.find((t) => t.symbol === BENCHMARK_SYMBOL);
  if (btc && !picked.includes(btc)) picked.unshift(btc);

  return picked.map((t) => {
    const base = t.symbol.slice(0, -4);
    const perp = [`${base}USDT`, `1000${base}USDT`, `1000000${base}USDT`].map((s) => futuresBySymbol.get(s)).find(Boolean) ?? null;
    return {
      symbol: t.symbol,
      base,
      rank: candidates.indexOf(t) + 1,
      spotQuoteVolume24h: t.quoteVolume,
      futuresSymbol: perp?.symbol ?? null,
      futuresQuoteVolume24h: perp?.quoteVolume ?? null,
    };
  });
}

/**
 * A pair whose last 30 closes stayed within 2% is pegged to something —
 * a stablecoin the list above does not know yet, or gold. Its "relative
 * strength" would only be BTC's move with the sign flipped.
 */
export function isStableLike(bars: CoinDailyBar[]): boolean {
  const closes = bars.slice(-30).map((b) => b.close);
  if (closes.length < 10) return false;
  return Math.max(...closes) / Math.min(...closes) - 1 < 0.02;
}

export type CoinFlow =
  | 'spot_led'
  | 'spot_and_leverage'
  | 'leverage_led'
  | 'short_covering'
  | 'up_unconfirmed'
  | 'spot_selling'
  | 'shorts_building'
  | 'long_unwind'
  | 'down_unconfirmed'
  | 'accumulation'
  | 'distribution'
  | 'leverage_building'
  | 'quiet';

export const ALL_COIN_FLOWS: CoinFlow[] = [
  'spot_led',
  'spot_and_leverage',
  'leverage_led',
  'short_covering',
  'up_unconfirmed',
  'spot_selling',
  'shorts_building',
  'long_unwind',
  'down_unconfirmed',
  'accumulation',
  'distribution',
  'leverage_building',
  'quiet',
];

export interface CoinReadInput {
  symbol: string;
  /** Closed daily bars, oldest first. */
  bars: CoinDailyBar[];
  /** BTC's closed daily bars over the same days; matched by open time, not by index. */
  btcBars: CoinDailyBar[];
  /** Daily open interest in contracts, oldest first. Null when the coin has no perpetual or the read failed. */
  oiContracts: number[] | null;
  /** Funding prints over the last 7 days, already scaled to 8h (fundingPer8h), as fractions (0.0001 = 0.01%). */
  fundingRates: number[] | null;
  spotQuoteVolume24h: number;
  futuresQuoteVolume24h: number | null;
  /** True when the futures market could not be read at all this time (e.g. Binance refusing the server), as opposed to the coin having no perpetual. */
  futuresUnreadable?: boolean;
  thresholds: CoinScanThresholds;
}

export interface CoinRead {
  symbol: string;
  /** Open time of the last closed daily bar used — the day this read describes. */
  lastBarOpenTime: number;
  close: number;
  /** Percent. */
  ret7d: number | null;
  ret30d: number | null;
  /** Percent by which the coin beat (or trailed) BTC: (1 + coin) / (1 + btc) − 1. */
  rs7d: number | null;
  rs30d: number | null;
  /** Whether the coin/BTC ratio closed above its own 20-day average. */
  rsAboveSma20: boolean | null;
  /** Average daily return over BTC on the days BTC closed red, last 30 days, in percent. Positive = held up better. */
  downDayExcess: number | null;
  downDays: number;
  /** (buy − sell) / total spot quote volume, from the taker-buy field. Range −1…1. */
  takerSkew7d: number | null;
  takerSkew30d: number | null;
  /** Percent change in open interest, in contracts. */
  oiChange7dPct: number | null;
  /** Average funding per 8h, in percent. */
  fundingAvg7dPct: number | null;
  spotPerpVolumeRatio: number | null;
  flow: CoinFlow;
  reasons: string[];
  unknowns: string[];
}

const RS_SMA_DAYS = 20;
const DOWN_DAY_WINDOW = 30;
const MIN_DOWN_DAYS = 5;
/** Funding settles every 8h on most perps, so a week is 21 prints; fewer than this means the history is incomplete. */
const MIN_FUNDING_PRINTS = 6;

const pct = (n: number, digits = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

function returnOver(bars: CoinDailyBar[], days: number): number | null {
  if (bars.length < days + 1) return null;
  const last = bars[bars.length - 1] as CoinDailyBar;
  const then = bars[bars.length - 1 - days] as CoinDailyBar;
  if (then.close <= 0) return null;
  return last.close / then.close - 1;
}

function relativeReturn(bars: CoinDailyBar[], btcByOpen: Map<number, number>, days: number): number | null {
  if (bars.length < days + 1) return null;
  const last = bars[bars.length - 1] as CoinDailyBar;
  const then = bars[bars.length - 1 - days] as CoinDailyBar;
  const btcLast = btcByOpen.get(last.openTime);
  const btcThen = btcByOpen.get(then.openTime);
  if (btcLast === undefined || btcThen === undefined || then.close <= 0 || btcThen <= 0) return null;
  return last.close / then.close / (btcLast / btcThen) - 1;
}

function takerSkew(bars: CoinDailyBar[], days: number): number | null {
  if (bars.length < days) return null;
  const window = bars.slice(-days);
  const total = window.reduce((s, b) => s + b.quoteVolume, 0);
  if (total <= 0) return null;
  const buy = window.reduce((s, b) => s + b.takerBuyQuoteVolume, 0);
  return (2 * buy) / total - 1;
}

export function readCoin(input: CoinReadInput): CoinRead | null {
  const { bars, thresholds: t } = input;
  if (bars.length < 8) return null;
  const last = bars[bars.length - 1] as CoinDailyBar;
  const isBenchmark = input.symbol === BENCHMARK_SYMBOL;
  const btcByOpen = new Map(input.btcBars.map((b) => [b.openTime, b.close]));
  const unknowns: string[] = [];

  const r7 = returnOver(bars, 7);
  const r30 = returnOver(bars, 30);
  const rs7 = isBenchmark ? 0 : relativeReturn(bars, btcByOpen, 7);
  const rs30 = isBenchmark ? 0 : relativeReturn(bars, btcByOpen, 30);
  if (r30 === null) unknowns.push('Chưa đủ 30 ngày lịch sử — không có số 30 ngày.');

  // The coin/BTC ratio against its own 20-day mean: is the outperformance
  // still going, or a spike that is already fading?
  let rsAboveSma20: boolean | null = null;
  let downDayExcess: number | null = null;
  let downDays = 0;
  if (!isBenchmark) {
    const ratios = bars
      .map((b) => {
        const btc = btcByOpen.get(b.openTime);
        return btc ? b.close / btc : null;
      })
      .filter((r): r is number => r !== null);
    if (ratios.length >= RS_SMA_DAYS) {
      const tail = ratios.slice(-RS_SMA_DAYS);
      rsAboveSma20 = (ratios[ratios.length - 1] as number) > tail.reduce((s, r) => s + r, 0) / tail.length;
    }

    const excess: number[] = [];
    for (let i = Math.max(1, bars.length - DOWN_DAY_WINDOW); i < bars.length; i += 1) {
      const prev = bars[i - 1] as CoinDailyBar;
      const cur = bars[i] as CoinDailyBar;
      const btcPrev = btcByOpen.get(prev.openTime);
      const btcCur = btcByOpen.get(cur.openTime);
      if (btcPrev === undefined || btcCur === undefined || prev.close <= 0) continue;
      const btcRet = btcCur / btcPrev - 1;
      if (btcRet < 0) excess.push(cur.close / prev.close - 1 - btcRet);
    }
    downDays = excess.length;
    if (excess.length >= MIN_DOWN_DAYS) downDayExcess = (excess.reduce((s, x) => s + x, 0) / excess.length) * 100;
    if (rs7 === null) unknowns.push('Không khớp được ngày với nến BTC — không tính được sức mạnh so với BTC.');
  }

  const skew7 = takerSkew(bars, 7);
  const skew30 = takerSkew(bars, 30);

  let oiChange: number | null = null;
  const oi = input.oiContracts;
  if (oi && oi.length >= 8) {
    const then = oi[oi.length - 8] as number;
    if (then > 0) oiChange = ((oi[oi.length - 1] as number) / then - 1) * 100;
  }
  let funding: number | null = null;
  const fr = input.fundingRates;
  if (fr && fr.length >= MIN_FUNDING_PRINTS) funding = (fr.reduce((s, x) => s + x, 0) / fr.length) * 100;

  if (input.futuresUnreadable) {
    unknowns.push('Lần quét này không đọc được thị trường futures — không có OI và funding, nhãn chỉ dựa vào spot.');
  } else if (input.futuresQuoteVolume24h === null) {
    unknowns.push('Không có hợp đồng perpetual trên Binance — không đọc được OI và funding, nhãn chỉ dựa vào spot.');
  } else {
    if (oiChange === null) unknowns.push('Không đọc được lịch sử open interest 7 ngày.');
    if (funding === null) unknowns.push('Không đọc được funding 7 ngày.');
  }

  const spotPerp =
    input.futuresQuoteVolume24h !== null && input.futuresQuoteVolume24h > 0 ? input.spotQuoteVolume24h / input.futuresQuoteVolume24h : null;

  const { flow, reasons } = classifyFlow({ ret7d: r7 === null ? null : r7 * 100, skew7, oiChange, funding }, t);

  if (!isBenchmark && rs30 !== null) {
    reasons.push(`30 ngày ${rs30 >= 0 ? 'mạnh hơn' : 'yếu hơn'} BTC ${(Math.abs(rs30) * 100).toFixed(1)}%${rsAboveSma20 === null ? '' : rsAboveSma20 ? ', tỉ giá với BTC trên trung bình 20 ngày' : ', tỉ giá với BTC dưới trung bình 20 ngày'}.`);
  }
  if (downDayExcess !== null) {
    reasons.push(
      `${downDays} ngày BTC đỏ trong 30 ngày: trung bình ${downDayExcess >= 0 ? 'giữ giá tốt hơn' : 'giảm sâu hơn'} BTC ${Math.abs(downDayExcess).toFixed(1)}%/ngày.`,
    );
  }

  return {
    symbol: input.symbol,
    lastBarOpenTime: last.openTime,
    close: last.close,
    ret7d: r7 === null ? null : r7 * 100,
    ret30d: r30 === null ? null : r30 * 100,
    rs7d: rs7 === null ? null : rs7 * 100,
    rs30d: rs30 === null ? null : rs30 * 100,
    rsAboveSma20,
    downDayExcess,
    downDays,
    takerSkew7d: skew7,
    takerSkew30d: skew30,
    oiChange7dPct: oiChange,
    fundingAvg7dPct: funding,
    spotPerpVolumeRatio: spotPerp,
    flow,
    reasons,
    unknowns,
  };
}

const EIGHT_HOURS_MS = 8 * 60 * 60_000;

/**
 * Funding prints scaled to a common 8h period.
 *
 * Binance settles most perps every 8h but some every 4h or 1h, and the
 * rate printed is per settlement. Averaged raw, a 1h coin paying the same
 * as BTC would read eight times cooler. The interval is the median gap
 * between prints, so one missing print does not rescale the rest.
 */
export function fundingPer8h(points: Array<{ fundingTime: number; fundingRate: number }>): number[] {
  if (points.length < 2) return [];
  const sorted = [...points].sort((a, b) => a.fundingTime - b.fundingTime);
  const gaps = sorted
    .slice(1)
    .map((p, i) => p.fundingTime - (sorted[i] as { fundingTime: number }).fundingTime)
    .sort((a, b) => a - b);
  const interval = gaps[Math.floor(gaps.length / 2)] as number;
  if (interval <= 0) return [];
  const scale = EIGHT_HOURS_MS / interval;
  return sorted.map((p) => p.fundingRate * scale);
}

interface FlowInput {
  /** Percent. */
  ret7d: number | null;
  skew7: number | null;
  /** Percent, contracts. */
  oiChange: number | null;
  /** Percent per 8h. */
  funding: number | null;
}

/**
 * The seven-day label. Price direction first, then who moved it.
 *
 * Missing futures data never counts as "no leverage" — it only means the
 * leverage branch cannot be taken, and the read says so in `unknowns`.
 */
export function classifyFlow(input: FlowInput, t: CoinScanThresholds): { flow: CoinFlow; reasons: string[] } {
  const { ret7d, skew7, oiChange, funding } = input;
  const reasons: string[] = [];

  const spotBuy = skew7 !== null && skew7 >= t.takerSkew;
  const spotSell = skew7 !== null && skew7 <= -t.takerSkew;
  const oiUp = oiChange !== null && oiChange >= t.oiRisePct;
  const oiDown = oiChange !== null && oiChange <= t.oiFallPct;
  const fundingHot = funding !== null && funding >= t.fundingElevatedPct;

  if (ret7d !== null) reasons.push(`Giá 7 ngày ${pct(ret7d)}.`);
  if (skew7 !== null) {
    reasons.push(
      spotBuy
        ? `Spot mua chủ động nhiều hơn bán (lệch ${pct(skew7 * 100)} khối lượng).`
        : spotSell
          ? `Spot bán chủ động nhiều hơn mua (lệch ${pct(skew7 * 100)} khối lượng).`
          : `Spot mua/bán chủ động gần cân bằng (lệch ${pct(skew7 * 100)}).`,
    );
  }
  if (oiChange !== null) reasons.push(`Open interest 7 ngày ${pct(oiChange)} (tính theo hợp đồng).`);
  if (funding !== null) reasons.push(`Funding trung bình ${funding.toFixed(4)}%/8h${fundingHot ? ' — phe long đang trả cao' : funding < 0 ? ' — phe short đang trả' : ''}.`);

  const up = ret7d !== null && ret7d >= t.priceMovePct;
  const down = ret7d !== null && ret7d <= -t.priceMovePct;

  let flow: CoinFlow;
  if (up) {
    if (oiDown) flow = 'short_covering';
    else if (spotBuy && (oiUp || fundingHot)) flow = 'spot_and_leverage';
    else if (spotBuy) flow = 'spot_led';
    else if (oiUp || fundingHot) flow = 'leverage_led';
    else flow = 'up_unconfirmed';
  } else if (down) {
    if (spotSell) flow = 'spot_selling';
    else if (oiUp) flow = 'shorts_building';
    else if (oiDown) flow = 'long_unwind';
    else flow = 'down_unconfirmed';
  } else if (spotBuy) flow = 'accumulation';
  else if (spotSell) flow = 'distribution';
  else if (oiUp) flow = 'leverage_building';
  else flow = 'quiet';

  return { flow, reasons };
}
