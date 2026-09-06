import { describe, expect, it } from 'vitest';
import { GeckoTerminalSource, stripNetworkPrefix, toGeckoNetwork } from './geckoterminal.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe('toGeckoNetwork', () => {
  it('maps only chains whose slug was actually verified', () => {
    // DexScreener and GeckoTerminal use different slugs for the same chain
    // often enough that guessing produces a 404 rather than an error worth
    // reading. Each entry here came from GeckoTerminal's own page, which
    // prints its network slug as "API-ID".
    expect(toGeckoNetwork('solana')).toBe('solana');
    expect(toGeckoNetwork('robinhood')).toBe('robinhood');
  });

  it('returns null for a chain nobody has confirmed', () => {
    // Null makes the source skip itself and report 'unsupported', which is
    // what puts "chỉ 1/2 nguồn phủ chain này" on /status. Guessing a slug
    // instead would send real requests that 404 and look like an outage.
    expect(toGeckoNetwork('bsc')).toBeNull();
    expect(toGeckoNetwork('hyperevm')).toBeNull();
    expect(toGeckoNetwork('')).toBeNull();
  });

  it('reports coverage through the interface the scanner reads', () => {
    // supportsChain is what the scanner calls; it must agree with the map
    // rather than being a second, drifting answer to the same question.
    const source = new GeckoTerminalSource({ logger });
    expect(source.supportsChain('robinhood')).toBe(true);
    expect(source.supportsChain('solana')).toBe(true);
    expect(source.supportsChain('bsc')).toBe(false);
  });
});

describe('stripNetworkPrefix', () => {
  it('removes the network prefix GeckoTerminal puts on token ids', () => {
    expect(stripNetworkPrefix('robinhood_0xabc', 'robinhood')).toBe('0xabc');
    expect(stripNetworkPrefix('solana_Abc123', 'solana')).toBe('Abc123');
  });

  it('leaves an id alone when the prefix is not there', () => {
    // A bare address must survive untouched, or the scanner would look up a
    // truncated one and silently find nothing.
    expect(stripNetworkPrefix('0xabc', 'robinhood')).toBe('0xabc');
    expect(stripNetworkPrefix('solana_Abc', 'robinhood')).toBe('solana_Abc');
  });
});
