import { describe, expect, it } from 'vitest';
import { COIN_EDGE_MIN_SAMPLES, evaluateCoinScan, type CoinScanEdgeInputRow } from './coinScanEdge.js';

const DAY = 86_400_000;
/** Day index 20734 = 2026-10-09, a multiple of 7 — a cohort day on the 7-day grid. */
const day = (offset: number): string => new Date((20734 + offset) * DAY).toISOString().slice(0, 10);

function row(offset: number, symbol: string, close: number, extra: Partial<CoinScanEdgeInputRow> = {}): CoinScanEdgeInputRow {
  return { day: day(offset), symbol, close, rs30d: null, flow: 'quiet', exchange: 'binance', ...extra };
}

describe('evaluateCoinScan', () => {
  it('scores each coin against BTC over the horizon and counts a win only when it beat BTC', () => {
    const rows = [
      row(0, 'BTCUSDT', 100), row(7, 'BTCUSDT', 110),
      row(0, 'AUSDT', 10, { flow: 'spot_led' }), row(7, 'AUSDT', 12, { flow: 'spot_led' }), // +20% vs BTC +10%: win
      row(0, 'BUSDT', 10), row(7, 'BUSDT', 10.5), // +5%: loss
    ];
    const [report] = evaluateCoinScan(rows, 7);
    expect(report?.cohortDays).toBe(1);
    const spot = report?.flows.find((f) => f.flow === 'spot_led');
    expect(spot?.group).toMatchObject({ samples: 1, hitPct: 100 });
    expect(spot?.group.meanExcessPct).toBeCloseTo(10, 9);
    expect(spot?.baseline).toMatchObject({ samples: 2, hitPct: 50 });
    // One sample is not evidence.
    expect(spot?.verdict).toBeNull();
  });

  it('uses only cohort days on the horizon grid, so overlapping windows are not counted twice', () => {
    const rows: CoinScanEdgeInputRow[] = [];
    for (let d = 0; d <= 14; d += 1) {
      rows.push(row(d, 'BTCUSDT', 100), row(d, 'AUSDT', 10 + d));
    }
    const [report] = evaluateCoinScan(rows, 7);
    // Days 0 and 7 start a full window; days 1–6 and 8–14 are not on the grid.
    expect(report?.cohortDays).toBe(2);
    expect(report?.flows[0]?.group.samples).toBe(2);
  });

  it('never prices a sample across two exchanges, and reports each exchange on its own', () => {
    const rows = [
      row(0, 'BTCUSDT', 100), row(7, 'BTCUSDT', 100, { exchange: 'okx' }),
      row(0, 'AUSDT', 10), row(7, 'AUSDT', 20, { exchange: 'okx' }),
      row(14, 'BTCUSDT', 100, { exchange: 'okx' }), row(14, 'AUSDT', 30, { exchange: 'okx' }),
    ];
    const reports = evaluateCoinScan(rows, 7);
    expect(reports.map((r) => r.exchange)).toEqual(['binance', 'okx']);
    expect(reports.find((r) => r.exchange === 'binance')?.cohortDays).toBe(0);
    expect(reports.find((r) => r.exchange === 'okx')?.cohortDays).toBe(1);
  });

  it('judges the top fifth by RS against the bottom fifth once both have enough samples', () => {
    const rows: CoinScanEdgeInputRow[] = [];
    // 10 coins a cohort, 12 cohorts: top fifth = 2 a cohort = 24 samples.
    for (let c = 0; c < 12; c += 1) {
      const d0 = c * 14; // ends (d0 + 7) never coincide with the next start
      rows.push(row(d0, 'BTCUSDT', 100), row(d0 + 7, 'BTCUSDT', 100));
      for (let i = 0; i < 10; i += 1) {
        // The strongest by RS go on to beat BTC; the weakest do not.
        const close = i < 2 ? 12 : i >= 8 ? 8 : 10;
        rows.push(row(d0, `C${i}USDT`, 10, { rs30d: 100 - i * 10 }), row(d0 + 7, `C${i}USDT`, close));
      }
    }
    const [report] = evaluateCoinScan(rows, 7);
    const rs = report?.relativeStrength;
    expect(rs?.group.samples).toBe(24);
    expect(rs?.baseline.samples).toBe(24);
    expect(rs?.group.samples).toBeGreaterThanOrEqual(COIN_EDGE_MIN_SAMPLES);
    expect(rs?.group.hitPct).toBe(100);
    expect(rs?.baseline.hitPct).toBe(0);
    expect(rs?.verdict).toBe('beats');
  });

  it('withholds a verdict below the sample floor however lopsided the numbers', () => {
    const rows: CoinScanEdgeInputRow[] = [row(0, 'BTCUSDT', 100), row(7, 'BTCUSDT', 100)];
    for (let i = 0; i < 10; i += 1) rows.push(row(0, `C${i}USDT`, 10, { rs30d: 100 - i }), row(7, `C${i}USDT`, i < 2 ? 20 : 5));
    const [report] = evaluateCoinScan(rows, 7);
    expect(report?.relativeStrength.group.hitPct).toBe(100);
    expect(report?.relativeStrength.verdict).toBeNull();
  });
});
