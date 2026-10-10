import { describe, expect, it } from 'vitest';
import type { LookupDTO } from './apiClient.js';
import { escapeHtml, formatLookup, lookupChartUrl } from './formatting.js';

function exchange(overrides: Partial<Extract<LookupDTO['result'], { kind: 'exchange' }>['technical']> = {}): LookupDTO {
  return {
    query: 'near',
    timeframe: '4h',
    result: {
      kind: 'exchange',
      symbol: 'NEARUSDT',
      source: 'binance',
      timeframe: '4h',
      technical: {
        barCount: 200,
        lastPrice: 4.915,
        rsi14: 49.6,
        trend: { direction: 'sideways', separationPct: 0.1 },
        atrPct: 1.8,
        support: { price: 4.65, distancePct: -5.39 },
        resistance: { price: 5.12, distancePct: 4.17 },
        rangePositionPct: 61,
        missing: [],
        ...overrides,
      },
      fundamentals: { unknowns: [] },
    },
  };
}

describe('formatLookup', () => {
  it('prints support/resistance as prices with their distance, never [object Object]', () => {
    const text = formatLookup(exchange());
    expect(text).toContain('Nearest low/high: 4.65 (-5.4%) / 5.12 (+4.2%)');
    expect(text).not.toContain('[object Object]');
  });

  it('still reads the bare numbers an older API sent', () => {
    expect(formatLookup(exchange({ support: 4.6, resistance: null }))).toContain('Nearest low/high: 4.6 / —');
  });

  it('links to the same lookup on the web when the web URL is configured', () => {
    const text = formatLookup(exchange(), 'https://trackingticker.vercel.app');
    expect(text).toContain('📈 <a href="https://trackingticker.vercel.app/lookup?q=NEARUSDT&amp;tf=4h">Xem chart</a>');
  });

  it('sends no link when it is not', () => {
    expect(formatLookup(exchange())).not.toContain('Xem chart');
  });
});

describe('lookupChartUrl', () => {
  it('builds the query the web page parses, and nothing without a base URL', () => {
    expect(lookupChartUrl('https://x.app', 'BTCUSDT', '1h')).toBe('https://x.app/lookup?q=BTCUSDT&tf=1h');
    expect(lookupChartUrl('', 'BTCUSDT', '1h')).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('escapes what Telegram HTML parse mode rejects', () => {
    // A no-op version shipped in #2: a token named "A<B" or "X&Y" made
    // Telegram refuse the whole /gems message ("can't parse entities").
    expect(escapeHtml('A<B> & C')).toBe('A&lt;B&gt; &amp; C');
  });
});
