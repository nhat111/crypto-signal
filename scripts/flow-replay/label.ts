/**
 * Labels every coin-day in the downloaded history with the production flow
 * read: `readCoin` from packages/indicators, the thresholds from
 * `loadConfig`, nothing re-implemented. Writes one CSV row per coin-day.
 *
 *   npx tsx scripts/flow-replay/label.ts <data dir from fetch.py> <out.csv>
 *
 * Timing matches the daily scan (~00:45 UTC, ASSUMPTIONS §18): the read for
 * day D uses the 62 bars closed through D, open interest up to the snapshot
 * at the next UTC midnight (the "forming day" point the scan sees), and the
 * funding printed in the 7 days before 00:45 on D+1.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fundingPer8h, readCoin, type CoinDailyBar } from '@crypto-signal/indicators';
import { loadConfig } from '@crypto-signal/shared';

const DAY_MS = 86_400_000;
const DAILY_BARS = 62; // apps/worker/src/coinScan.ts
const SCAN_DELAY_MS = 45 * 60_000;

interface CoinData {
  coin: string;
  spot: Array<[number, number, number, number]>;
  oi: Array<[number, number]>;
  funding: Array<[number, number]>;
}

const [dir, outPath] = process.argv.slice(2);
if (!dir || !outPath) {
  console.error('usage: label.ts <data dir> <out.csv>');
  process.exit(1);
}

const thresholds = loadConfig({}).coinScan.thresholds;
const coins: CoinData[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as CoinData);

const toBars = (c: CoinData): CoinDailyBar[] =>
  c.spot.map(([openTime, close, quoteVolume, takerBuyQuoteVolume]) => ({ openTime, close, quoteVolume, takerBuyQuoteVolume }));

const btc = coins.find((c) => c.coin === 'BTC');
if (!btc) throw new Error('BTC.json missing');
const btcBars = toBars(btc);

const cols = ['day', 'symbol', 'flow', 'ret7d', 'rs7d', 'rs30d', 'rsAboveSma20', 'skew7', 'oiChange7d', 'funding7d', 'hasOi', 'hasFunding'];
const lines = [cols.join(',')];
const num = (x: number | null | boolean): string => (x === null ? '' : String(x));

for (const c of coins) {
  const bars = toBars(c);
  for (let i = DAILY_BARS - 1; i < bars.length; i += 1) {
    const window = bars.slice(i + 1 - DAILY_BARS, i + 1);
    const day = (window[window.length - 1] as CoinDailyBar).openTime;
    const btcWindow = btcBars.filter((b) => b.openTime <= day).slice(-DAILY_BARS);
    const now = day + DAY_MS + SCAN_DELAY_MS;
    const oi = c.oi.filter(([t]) => t <= day + DAY_MS).map(([, coinsOi]) => coinsOi);
    const prints = c.funding.filter(([t]) => t >= now - 7 * DAY_MS && t <= now).map(([fundingTime, fundingRate]) => ({ fundingTime, fundingRate }));
    // No OI history yet for the day (before OKX's records start) is not
    // "no perpetual": the row is kept, flagged, and left out of the test.
    const hasOi = oi.length >= 8;
    const hasFunding = prints.length >= 6;
    const read = readCoin({
      symbol: `${c.coin}USDT`,
      bars: window,
      btcBars: btcWindow,
      oiContracts: hasOi ? oi : null,
      fundingRates: hasFunding ? fundingPer8h(prints) : null,
      spotQuoteVolume24h: 0,
      futuresQuoteVolume24h: c.oi.length > 0 ? 0 : null,
      thresholds,
    });
    if (!read) continue;
    lines.push(
      [
        new Date(day).toISOString().slice(0, 10),
        read.symbol,
        read.flow,
        num(read.ret7d),
        num(read.rs7d),
        num(read.rs30d),
        num(read.rsAboveSma20),
        num(read.takerSkew7d),
        num(read.oiChange7dPct),
        num(read.fundingAvg7dPct),
        String(hasOi),
        String(hasFunding),
      ].join(','),
    );
  }
}

writeFileSync(outPath, `${lines.join('\n')}\n`);
console.error(`${lines.length - 1} coin-days labelled -> ${outPath}`);
