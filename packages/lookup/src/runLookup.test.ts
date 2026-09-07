import { describe, expect, it, vi } from 'vitest';
import { GLANCE_TIMEFRAMES, runLookup, type LookupDeps } from './runLookup.js';
import type { OhlcvBar } from '@crypto-signal/indicators';
import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';

const SOL_ADDRESS = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

const bars = (n: number): OhlcvBar[] =>
  Array.from({ length: n }, (_, i) => ({
    openTime: i * 3_600_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10,
  }));

function pair(overrides: Partial<GemPair> = {}): GemPair {
  return {
    chainId: 'solana',
    pairAddress: 'pool-1',
    dexId: 'raydium',
    baseToken: { address: SOL_ADDRESS, name: 'Test Token', symbol: 'TEST' },
    quoteToken: { address: 'sol', symbol: 'SOL' },
    priceUsd: 0.5,
    liquidityUsd: 200_000,
    fdvUsd: 10_000_000,
    marketCapUsd: 8_000_000,
    volume: { h1: 1, h6: 2, h24: 400_000 },
    priceChangePct: { m5: 0, h1: 0, h6: 0, h24: 0 },
    txns: { h1: null, h24: { buys: 10, sells: 5 } },
    pairCreatedAt: NOW - 30 * DAY,
    url: null,
    websites: [],
    socials: [],
    fetchedAt: NOW,
    ...overrides,
  };
}

const safety: SafetyReport = {
  chainId: 'solana',
  tokenAddress: SOL_ADDRESS,
  verdict: 'safe',
  flags: [],
  topHolderPct: 0.05,
  lpLocked: true,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  checkedAt: NOW,
};

function deps(overrides: Partial<LookupDeps> = {}): LookupDeps {
  return {
    fetchBars: async () => bars(120),
    searchPairs: async () => [pair()],
    screen: async () => safety,
    logger,
    ...overrides,
  };
}


describe('runLookup — exchange path', () => {
  it('finds a ticker on the first quote that has bars', async () => {
    const fetchBars = vi.fn(async (symbol: string) => (symbol === 'BTCUSDT' ? bars(120) : []));
    const result = await runLookup(deps({ fetchBars }), 'btc');

    expect(result.kind).toBe('exchange');
    expect(result).toMatchObject({ symbol: 'BTCUSDT', timeframe: '4h' });
    // One for the chosen frame, plus one per glance frame — bounded, and
    // the reason the route is not something to hammer.
    expect(fetchBars).toHaveBeenCalledTimes(1 + GLANCE_TIMEFRAMES.filter((tf) => tf !== '4h').length);
  });

  it('reads the other frames too, so one frame is never the whole answer', async () => {
    const result = await runLookup(deps(), 'BTC', { timeframe: '4h' });
    const frames = (result as { timeframes: Array<{ timeframe: string }> }).timeframes.map((t) => t.timeframe);
    expect(frames).toEqual(['1h', '1d']);
    expect(frames).not.toContain('4h');
  });

  it('drops a glance frame that failed instead of failing the lookup', async () => {
    // Context beside the answer must never take the answer down with it.
    const fetchBars = vi.fn(async (symbol: string, tf: string) => {
      if (tf === '1d') throw new Error('boom');
      return bars(120);
    });
    const result = await runLookup(deps({ fetchBars }), 'BTC', { timeframe: '4h' });
    expect(result.kind).toBe('exchange');
    expect((result as { timeframes: Array<{ timeframe: string }> }).timeframes.map((t) => t.timeframe)).toEqual(['1h']);
  });

  it('falls through to the next quote asset when the first is not listed', async () => {
    const fetchBars = vi.fn(async (symbol: string) => (symbol === 'FOOUSDC' ? bars(120) : []));
    const result = await runLookup(deps({ fetchBars }), 'FOO');

    expect(result).toMatchObject({ kind: 'exchange', symbol: 'FOOUSDC' });
    expect((result as { triedSymbols: string[] }).triedSymbols).toEqual(['FOOUSDT', 'FOOUSDC']);
  });

  /**
   * An unlisted symbol and a transient failure look identical from here —
   * Binance answers both with a 4xx — so one bad response must not be
   * allowed to declare a token unlisted.
   */
  it('keeps trying after a thrown request rather than giving up on the token', async () => {
    const fetchBars = vi.fn(async (symbol: string) => {
      if (symbol === 'FOOUSDT') throw new Error('boom');
      return symbol === 'FOOUSDC' ? bars(120) : [];
    });
    expect(await runLookup(deps({ fetchBars }), 'FOO')).toMatchObject({ kind: 'exchange', symbol: 'FOOUSDC' });
  });

  it('says which symbols it tried when none of them existed', async () => {
    const result = await runLookup(deps({ fetchBars: async () => [] }), 'NOPE');
    expect(result.kind).toBe('not_found');
    expect((result as { reason: string }).reason).toContain('NOPEUSDT');
    // And points at the other way in, since a DEX-only token has no ticker.
    expect((result as { reason: string }).reason).toContain('contract address');
  });

  it('honours an explicit timeframe', async () => {
    const fetchBars = vi.fn(async () => bars(120));
    await runLookup(deps({ fetchBars }), 'BTC', { timeframe: '1h' });
    expect(fetchBars).toHaveBeenCalledWith('BTCUSDT', '1h', 200);
  });

  it('reports the fundamental gaps rather than implying it has none', async () => {
    const result = await runLookup(deps(), 'BTC');
    expect((result as { fundamentals: { unknowns: string[] } }).fundamentals.unknowns.join(' ')).toContain('Market cap');
  });
});

describe('runLookup — address path', () => {
  it('reads a contract address without being told the chain', async () => {
    const result = await runLookup(deps(), SOL_ADDRESS);
    expect(result.kind).toBe('onchain');
    expect(result).toMatchObject({ fundamentals: { symbol: 'TEST', chainId: 'solana' } });
  });

  it('picks the deepest pool and lists the rest', async () => {
    // The deepest pool is the price a buyer actually gets — the same rule
    // the scanner uses, so the two cannot disagree about a token.
    const searchPairs = async () => [
      pair({ pairAddress: 'thin', liquidityUsd: 5_000, dexId: 'orca' }),
      pair({ pairAddress: 'deep', liquidityUsd: 900_000, dexId: 'raydium' }),
    ];
    const result = await runLookup(deps({ searchPairs }), SOL_ADDRESS);
    expect((result as { fundamentals: { liquidityUsd: number } }).fundamentals.liquidityUsd).toBe(900_000);
    expect((result as { otherPools: unknown[] }).otherPools).toHaveLength(1);
  });

  /**
   * The search matches more than the base token. A pool where the queried
   * address is the QUOTE side is a different token being priced against
   * it, and reporting that one would answer about the wrong asset.
   */
  it('ignores pools where the address is the quote side', async () => {
    const searchPairs = async () => [
      pair({ baseToken: { address: 'SomethingElse', name: 'Other', symbol: 'OTHER' } }),
    ];
    const result = await runLookup(deps({ searchPairs }), SOL_ADDRESS);
    expect(result.kind).toBe('not_found');
  });

  it('matches an EVM address case-insensitively', async () => {
    const evm = '0x198dBa421A7DB566a90dA5De7901ABe3443b1234';
    const searchPairs = async () => [
      pair({ chainId: 'bsc', baseToken: { address: evm.toLowerCase(), name: 'X', symbol: 'X' } }),
    ];
    expect(await runLookup(deps({ searchPairs }), evm)).toMatchObject({ kind: 'onchain' });
  });

  it('still answers when no safety screen covers the chain', async () => {
    // Unknown is a first-class outcome here, never a pass.
    const result = await runLookup(deps({ screen: async () => null }), SOL_ADDRESS);
    expect(result).toMatchObject({ kind: 'onchain', fundamentals: { safetyVerdict: null } });
    expect((result as { fundamentals: { unknowns: string[] } }).fundamentals.unknowns.join(' ')).toContain('Safety screen');
  });

  it('survives a screen that throws, and says nothing about safety', async () => {
    const result = await runLookup(deps({ screen: async () => { throw new Error('rate limited'); } }), SOL_ADDRESS);
    expect(result).toMatchObject({ kind: 'onchain', fundamentals: { safetyVerdict: null } });
  });

  it('reports a search outage as an outage, not as a missing token', async () => {
    // "This token does not exist" and "the source is down" send somebody
    // to two different places.
    const result = await runLookup(deps({ searchPairs: async () => { throw new Error('503'); } }), SOL_ADDRESS);
    expect((result as { reason: string }).reason).toContain('not responding');
  });

  it('says the token has no pool when the search comes back empty', async () => {
    const result = await runLookup(deps({ searchPairs: async () => [] }), SOL_ADDRESS);
    expect((result as { reason: string }).reason).toContain('No pool');
  });
});

describe('runLookup — refusals', () => {
  it('refuses nonsense before spending a request on it', async () => {
    const fetchBars = vi.fn(async () => bars(120));
    const searchPairs = vi.fn(async () => [pair()]);
    const result = await runLookup(deps({ fetchBars, searchPairs }), 'what should i buy');

    expect(result.kind).toBe('not_found');
    expect(fetchBars).not.toHaveBeenCalled();
    expect(searchPairs).not.toHaveBeenCalled();
  });

  it('explains a truncated address instead of searching for it as a ticker', async () => {
    const result = await runLookup(deps(), '0x198dBa421A7DB566');
    expect((result as { reason: string }).reason).toContain('40 hex characters');
  });
});
