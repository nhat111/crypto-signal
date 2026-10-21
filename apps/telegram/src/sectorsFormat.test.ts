import { describe, expect, it } from 'vitest';
import { formatFlywheel, formatSectors, type SectorDTO } from './sectorsFormat.js';

const sector = (name: string, label: SectorDTO['label'], rs7d: number, previousLabel: SectorDTO['label'] | null = null): SectorDTO => ({
  name,
  median7dPct: rs7d + 2,
  median30dPct: 0,
  rs7d,
  breadth7dPct: 60,
  btc7dPct: 2,
  btc30dPct: -4,
  label,
  previousLabel,
  leaders: [{ symbol: 'TAO', change7dPct: 25 }],
});

describe('formatSectors', () => {
  it('groups by label, shows leaders for the rising groups and a label change', () => {
    const text = formatSectors({
      enabled: true,
      day: '2026-10-21',
      fetch: null,
      sectors: [sector('Meme', 'lagging', -5), sector('AI', 'leading', 8, 'emerging')],
    });
    expect(text.indexOf('Dẫn dắt')).toBeLessThan(text.indexOf('Yếu'));
    expect(text).toContain('TAO +25.0%');
    expect(text).toContain('hôm trước: Đang nổi');
    expect(text).toContain('BTC: +2.0% 7 ngày');
  });

  it('says why it is empty', () => {
    expect(formatSectors({ enabled: false, day: null, sectors: [], fetch: null })).toContain('SECTOR_SCAN=off');
    expect(formatSectors({ enabled: true, day: null, sectors: [], fetch: { lastSuccessAt: null, consecutiveFailures: 3, lastError: 'HTTP 429' } })).toContain('HTTP 429');
  });
});

describe('formatFlywheel', () => {
  it('lists payout, change, yield and price, and escapes names', () => {
    const text = formatFlywheel({
      enabled: true,
      day: '2026-10-21',
      fetch: null,
      rows: [{ name: 'Hyper<liquid>', symbol: 'HYPE', holdersRevenue30dUsd: 68.5e6, holdersRevenueChangePct: -13, yieldPct: 4.6, priceChange30dPct: null }],
    });
    expect(text).toContain('Hyper&lt;liquid&gt;');
    expect(text).toContain('$68.5M/30 ngày · -13.0% so tháng trước · 4.6%/năm vốn hoá');
    expect(text).not.toContain('giá');
  });
});
