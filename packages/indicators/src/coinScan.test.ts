import { describe, expect, it } from 'vitest';
import type { CoinScanThresholds } from '@crypto-signal/shared';
import { classifyFlow, fundingPer8h, isStableLike, pickCoinUniverse, readCoin, type CoinDailyBar, type Ticker24h } from './coinScan.js';

const T: CoinScanThresholds = { priceMovePct: 3, takerSkew: 0.02, oiRisePct: 10, oiFallPct: -10, fundingElevatedPct: 0.03, fundingShortsPayPct: -0.005 };
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13);

/** Daily bars from a list of closes, with a fixed taker skew. Last bar is the day before NOW. */
function bars(closes: number[], skew = 0): CoinDailyBar[] {
  const start = NOW - closes.length * DAY;
  return closes.map((close, i) => ({
    openTime: start + i * DAY,
    close,
    quoteVolume: 1000,
    takerBuyQuoteVolume: (1000 * (1 + skew)) / 2,
  }));
}

const flat = (n: number, v = 100): number[] => Array.from({ length: n }, () => v);
/** n closes compounding at `daily` per day from 100. */
const trend = (n: number, daily: number): number[] => Array.from({ length: n }, (_, i) => 100 * (1 + daily) ** i);

const ticker = (symbol: string, quoteVolume: number, closeTime = NOW - 60_000): Ticker24h => ({ symbol, quoteVolume, closeTime, lastPrice: 1 });

describe('pickCoinUniverse', () => {
  it('ranks by spot volume, drops stablecoins and wrapped tokens, and maps 1000x perps', () => {
    const spot = [
      ticker('BTCUSDT', 900),
      ticker('USDCUSDT', 1000),
      ticker('FDUSDUSDT', 800),
      ticker('WBTCUSDT', 700),
      ticker('PEPEUSDT', 500),
      ticker('ETHBTC', 5000),
      ticker('SOLUSDT', 600),
    ];
    const futures = [ticker('BTCUSDT', 2000), ticker('1000PEPEUSDT', 300), ticker('SOLUSDT', 400)];
    const universe = pickCoinUniverse(spot, futures, 10, NOW);
    expect(universe.map((u) => u.symbol)).toEqual(['BTCUSDT', 'SOLUSDT', 'PEPEUSDT']);
    expect(universe.map((u) => u.rank)).toEqual([1, 2, 3]);
    expect(universe.find((u) => u.symbol === 'PEPEUSDT')?.futuresSymbol).toBe('1000PEPEUSDT');
  });

  it('drops pairs whose ticker stopped updating, however much volume it still reports', () => {
    const spot = [ticker('BTCUSDT', 900), ticker('DEADUSDT', 5000, NOW - 5 * DAY)];
    expect(pickCoinUniverse(spot, [], 10, NOW).map((u) => u.symbol)).toEqual(['BTCUSDT']);
  });

  it('keeps BTC even when it falls outside the top N — every RS number is measured against it', () => {
    const spot = [ticker('ETHUSDT', 1000), ticker('SOLUSDT', 900), ticker('BTCUSDT', 10)];
    const universe = pickCoinUniverse(spot, [], 2, NOW);
    expect(universe.map((u) => u.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    expect(universe[0]?.rank).toBe(3);
    expect(universe[0]?.futuresSymbol).toBeNull();
  });
});

describe('isStableLike', () => {
  it('flags a pegged pair and leaves a coin that moves', () => {
    expect(isStableLike(bars(flat(30, 1).map((v, i) => v + (i % 2) * 0.001)))).toBe(true);
    expect(isStableLike(bars(trend(30, 0.01)))).toBe(false);
  });
});

describe('classifyFlow', () => {
  const read = (ret7d: number, skew7: number | null, oiChange: number | null, funding: number | null) =>
    classifyFlow({ ret7d, skew7, oiChange, funding }, T).flow;

  it('labels a rise by who drove it', () => {
    expect(read(8, 0.05, 2, 0.01)).toBe('spot_led');
    expect(read(8, 0.05, 15, 0.01)).toBe('spot_and_leverage');
    expect(read(8, 0, 15, 0.01)).toBe('leverage_led');
    expect(read(8, 0, 2, 0.05)).toBe('leverage_led');
    expect(read(8, 0.05, -15, 0.01)).toBe('short_covering');
    expect(read(8, 0, 2, 0.01)).toBe('up_unconfirmed');
  });

  it('calls a rise with OI up and shorts paying a squeeze, whatever spot did', () => {
    expect(read(8, 0, 15, -0.01)).toBe('short_squeeze');
    expect(read(8, 0.05, 250, -0.037)).toBe('short_squeeze');
    // Funding barely below zero is not shorts paying.
    expect(read(8, 0, 15, -0.001)).toBe('leverage_led');
    expect(read(8, 0.05, 15, -0.001)).toBe('spot_and_leverage');
    // OI falling stays short covering.
    expect(read(8, 0, -15, -0.01)).toBe('short_covering');
    // Without the price rise it is not a squeeze.
    expect(read(-8, 0, 15, -0.01)).toBe('shorts_building');
  });

  it('labels a fall', () => {
    expect(read(-8, -0.05, 15, 0)).toBe('spot_selling');
    expect(read(-8, 0, 15, 0)).toBe('shorts_building');
    expect(read(-8, 0, -15, 0)).toBe('long_unwind');
    expect(read(-8, 0, 0, 0)).toBe('down_unconfirmed');
  });

  it('labels a flat week', () => {
    expect(read(1, 0.05, 0, 0)).toBe('accumulation');
    expect(read(1, -0.05, 0, 0)).toBe('distribution');
    expect(read(1, 0, 15, 0)).toBe('leverage_building');
    expect(read(1, 0, 0, 0)).toBe('quiet');
  });

  it('never reads missing futures data as "no leverage" into a leverage label', () => {
    expect(read(8, 0, null, null)).toBe('up_unconfirmed');
    expect(read(8, 0.05, null, null)).toBe('spot_led');
  });
});

describe('readCoin', () => {
  const btc = bars(trend(40, 0.005));
  const base = {
    btcBars: btc,
    oiContracts: null,
    fundingRates: null,
    spotQuoteVolume24h: 100,
    futuresQuoteVolume24h: null,
    thresholds: T,
  };

  it('returns null without a week of history', () => {
    expect(readCoin({ ...base, symbol: 'NEWUSDT', bars: bars(flat(5)) })).toBeNull();
  });

  it('measures returns and strength against BTC on matching days', () => {
    const coin = bars(trend(40, 0.02), 0.05);
    const r = readCoin({ ...base, symbol: 'SOLUSDT', bars: coin });
    expect(r).not.toBeNull();
    expect(r?.ret7d).toBeCloseTo((1.02 ** 7 - 1) * 100, 6);
    expect(r?.rs7d).toBeCloseTo(((1.02 / 1.005) ** 7 - 1) * 100, 6);
    expect(r?.rs30d).toBeCloseTo(((1.02 / 1.005) ** 30 - 1) * 100, 6);
    expect(r?.rsAboveSma20).toBe(true);
    expect(r?.takerSkew7d).toBeCloseTo(0.05, 9);
    expect(r?.flow).toBe('spot_led');
    // BTC never closed red here, so there is nothing to average.
    expect(r?.downDayExcess).toBeNull();
    expect(r?.unknowns.some((u) => u.includes('perpetual'))).toBe(true);
  });

  it('scores BTC at zero against itself', () => {
    const r = readCoin({ ...base, symbol: 'BTCUSDT', bars: btc });
    expect(r?.rs7d).toBe(0);
    expect(r?.rs30d).toBe(0);
    expect(r?.rsAboveSma20).toBeNull();
  });

  it('measures how a coin holds up on the days BTC falls', () => {
    // BTC alternates −2% / +2%; the coin alternates −1% / +2%.
    const btcCloses = [100];
    const coinCloses = [100];
    for (let i = 1; i < 31; i += 1) {
      btcCloses.push((btcCloses[i - 1] as number) * (i % 2 ? 0.98 : 1.02));
      coinCloses.push((coinCloses[i - 1] as number) * (i % 2 ? 0.99 : 1.02));
    }
    const r = readCoin({ ...base, btcBars: bars(btcCloses), symbol: 'BNBUSDT', bars: bars(coinCloses) });
    expect(r?.downDays).toBe(15);
    expect(r?.downDayExcess).toBeCloseTo(1, 9);
  });

  it('reads OI in contracts and funding as an average', () => {
    const r = readCoin({
      ...base,
      symbol: 'DOGEUSDT',
      bars: bars(trend(40, 0.01)),
      futuresQuoteVolume24h: 400,
      oiContracts: [100, 101, 102, 103, 104, 105, 110, 120],
      fundingRates: Array.from({ length: 21 }, () => 0.0005),
    });
    expect(r?.oiChange7dPct).toBeCloseTo(20, 9);
    expect(r?.fundingAvg7dPct).toBeCloseTo(0.05, 9);
    expect(r?.spotPerpVolumeRatio).toBeCloseTo(0.25, 9);
    expect(r?.flow).toBe('leverage_led');
    expect(r?.unknowns).toEqual([]);
  });

  it('warns when spot volume is a thin slice of perp volume', () => {
    const r = readCoin({
      ...base,
      symbol: 'BATUSDT',
      bars: bars(trend(40, 0.01)),
      futuresQuoteVolume24h: 2500,
      oiContracts: [100, 101, 102, 103, 104, 105, 110, 120],
      fundingRates: Array.from({ length: 21 }, () => 0.0001),
    });
    expect(r?.spotPerpVolumeRatio).toBeCloseTo(0.04, 9);
    expect(r?.unknowns).toEqual([expect.stringContaining('Volume spot chỉ bằng 4% volume perp')]);
  });

  it('says when there is no taker split to read, instead of calling the week balanced', () => {
    const noTaker = bars(trend(40, 0.01)).map((b) => ({ ...b, quoteVolume: 0, takerBuyQuoteVolume: 0 }));
    const r = readCoin({ ...base, symbol: 'XYZUSDT', bars: noTaker });
    expect(r?.takerSkew7d).toBeNull();
    expect(r?.unknowns.some((u) => u.includes('mua/bán chủ động'))).toBe(true);
  });

  it('tells "futures unreadable this time" apart from "no perpetual"', () => {
    const r = readCoin({ ...base, symbol: 'ETHUSDT', bars: bars(trend(40, 0.01)), futuresUnreadable: true });
    expect(r?.unknowns).toHaveLength(1);
    expect(r?.unknowns[0]).toContain('không đọc được thị trường futures');
  });

  it('says what it could not read instead of leaving it blank', () => {
    const r = readCoin({ ...base, symbol: 'ARBUSDT', bars: bars(trend(20, 0.01)), futuresQuoteVolume24h: 50, oiContracts: [1, 2], fundingRates: [] });
    expect(r?.ret30d).toBeNull();
    expect(r?.unknowns).toHaveLength(3);
  });
});

describe('fundingPer8h', () => {
  const H = 3_600_000;
  it('leaves an 8h perp as it is and scales a 1h one up to the same footing', () => {
    expect(fundingPer8h([0, 8, 16].map((h) => ({ fundingTime: h * H, fundingRate: 0.0001 })))).toEqual([0.0001, 0.0001, 0.0001]);
    const hourly = fundingPer8h([0, 1, 2, 3].map((h) => ({ fundingTime: h * H, fundingRate: 0.0001 })));
    expect(hourly.every((r) => Math.abs(r - 0.0008) < 1e-12)).toBe(true);
  });

  it('takes the interval from the median gap, so one missing print does not rescale the week', () => {
    const rates = fundingPer8h([0, 8, 16, 32, 40].map((h) => ({ fundingTime: h * H, fundingRate: 0.0001 })));
    expect(rates.every((r) => Math.abs(r - 0.0001) < 1e-12)).toBe(true);
  });

  it('returns nothing it cannot scale', () => {
    expect(fundingPer8h([{ fundingTime: 0, fundingRate: 0.0001 }])).toEqual([]);
  });
});
