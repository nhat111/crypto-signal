import { describe, expect, it } from 'vitest';
import { parseBybitOpenInterest } from './bybit/openInterest.js';
import { parseGateOpenInterest } from './gate/openInterest.js';
import { parseOpenInterest } from './okx/coinScanData.js';

const D = Date.UTC(2026, 9, 15);
const DAY = 86_400_000;

describe('daily OI parsers', () => {
  it('OKX: oiCcy (coins), oldest first', () => {
    // Live rows, 1Dutc: [ts, oi in contracts, oiCcy in coins, oiUsd].
    const rows = [
      [String(D + DAY), '3011459.38', '30114.5938', '2471489655.86'],
      [String(D), '3057664.11', '30576.6411', '2490565262.84'],
    ];
    expect(parseOpenInterest(rows)).toEqual([
      { time: D, coins: 30576.6411 },
      { time: D + DAY, coins: 30114.5938 },
    ]);
  });

  it('Gate: contracts × quanto_multiplier, seconds to millis', () => {
    const rows = [
      { time: D / 1000, open_interest: 508328208 },
      { time: (D + DAY) / 1000, open_interest: 506004288 },
    ];
    const out = parseGateOpenInterest(rows, 0.0001);
    expect(out.map((r) => r.time)).toEqual([D, D + DAY]);
    expect(out[0]?.coins).toBeCloseTo(50832.8208, 6);
  });

  it('Bybit: newest-first strings, scaled for 1000x listings', () => {
    const rows = [
      { openInterest: '2', timestamp: String(D + DAY) },
      { openInterest: '1.5', timestamp: String(D) },
    ];
    expect(parseBybitOpenInterest(rows, 1000)).toEqual([
      { time: D, coins: 1500 },
      { time: D + DAY, coins: 2000 },
    ]);
  });
});
