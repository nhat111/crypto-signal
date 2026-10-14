import { describe, expect, it } from 'vitest';
import { pickWatchlist, type WatchlistCandidate } from './watchlist.js';

const coin = (symbol: string, rs30d: number | null, over: Partial<WatchlistCandidate> = {}): WatchlistCandidate => ({
  symbol,
  rs30d,
  rsAboveSma20: true,
  flow: 'leverage_led',
  fundamentals: null,
  ...over,
});
const fundamentals = (bull: number, bear: number): WatchlistCandidate['fundamentals'] => ({
  chain: null,
  protocol: null,
  bull: Array.from({ length: bull }, (_, i) => `bull ${i}`),
  bear: Array.from({ length: bear }, (_, i) => `bear ${i}`),
  unknowns: [],
});

describe('pickWatchlist', () => {
  it('keeps coins beating BTC with RS still rising, strongest first, up to the size', () => {
    const rows = [coin('AUSDT', 10), coin('BUSDT', 50), coin('CUSDT', 30), coin('DUSDT', 20)];
    expect(pickWatchlist(rows, 3).map((r) => r.symbol)).toEqual(['BUSDT', 'CUSDT', 'DUSDT']);
  });

  it('drops coins weaker than BTC, with no RS, or whose RS has turned down', () => {
    const rows = [coin('AUSDT', -1), coin('BUSDT', null), coin('CUSDT', 40, { rsAboveSma20: false }), coin('DUSDT', 40, { rsAboveSma20: null }), coin('EUSDT', 5)];
    expect(pickWatchlist(rows).map((r) => r.symbol)).toEqual(['EUSDT']);
  });

  it('drops a week of selling flow but keeps a dip without one', () => {
    const rows = [
      coin('AUSDT', 50, { flow: 'spot_selling' }),
      coin('BUSDT', 40, { flow: 'shorts_building' }),
      coin('CUSDT', 30, { flow: 'distribution' }),
      coin('DUSDT', 20, { flow: 'long_unwind' }),
      coin('EUSDT', 10, { flow: 'spot_led' }),
    ];
    expect(pickWatchlist(rows).map((r) => r.symbol)).toEqual(['DUSDT', 'EUSDT']);
  });

  it('drops a coin whose usage only points down, not one with mixed or no figures', () => {
    const rows = [coin('AUSDT', 50, { fundamentals: fundamentals(0, 1) }), coin('BUSDT', 40, { fundamentals: fundamentals(1, 1) }), coin('CUSDT', 30)];
    expect(pickWatchlist(rows).map((r) => r.symbol)).toEqual(['BUSDT', 'CUSDT']);
  });

  it('leaves out the excluded symbols — the core coins are scanned anyway', () => {
    expect(pickWatchlist([coin('SOLUSDT', 50), coin('AUSDT', 10)], 6, ['SOLUSDT']).map((r) => r.symbol)).toEqual(['AUSDT']);
  });
});
