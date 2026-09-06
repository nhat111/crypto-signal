import { describe, expect, it } from 'vitest';
import { journalPrefillHref, parseTradePrefill } from './journalPrefill';
import type { Gem } from './types';

function gem(overrides: Partial<Gem> = {}): Gem {
  return {
    scanId: 's1',
    chainId: 'solana',
    tokenAddress: 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub',
    symbol: 'NOVALUE',
    name: 'No Value Coin',
    dexId: 'raydium',
    url: null,
    scannedAt: 1_700_000_000_000,
    gemScore: 71,
    gemComponents: {},
    riskScore: 33,
    riskComponents: {},
    reasons: [],
    priceUsd: 0.00042,
    liquidityUsd: 219_370,
    volume24hUsd: 333_060,
    fdvUsd: 8_000_000,
    priceChange24hPct: 22,
    buys24h: 400,
    sells24h: 300,
    ageDays: 31,
    safetyVerdict: 'safe',
    safetyFlags: [],
    topHolderPct: 0.08,
    lpLocked: true,
    ...overrides,
  } as Gem;
}

function parseHref(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf('?')));
}

describe('journalPrefillHref', () => {
  it('points at the journal and defaults to spot', () => {
    const href = journalPrefillHref(gem());
    expect(href.startsWith('/journal?')).toBe(true);
    expect(parseHref(href).get('side')).toBe('spot');
  });

  it('carries the ticker as the symbol and the address in the note', () => {
    // A ticker is what the table shows and what /close takes; the address
    // is the only thing that says WHICH token, since tickers collide.
    const params = parseHref(journalPrefillHref(gem()));
    expect(params.get('symbol')).toBe('NOVALUE');
    expect(params.get('note')).toContain('bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub');
    expect(params.get('note')).toContain('solana');
    expect(params.get('note')).toContain('Gem 71');
  });

  it('sends the full price, not a rounded display string', () => {
    // The form is a text input, and rounding here would put a price the
    // user never paid one keystroke away from being logged as fact.
    expect(parseHref(journalPrefillHref(gem())).get('entry')).toBe('0.00042');
  });

  it('omits the price entirely when the scan has none', () => {
    // Null is not zero. An entry of "0" would be a lie the user has to
    // notice and delete.
    expect(parseHref(journalPrefillHref(gem({ priceUsd: null }))).has('entry')).toBe(false);
  });

  it('escapes a symbol that would otherwise break the query string', () => {
    const params = parseHref(journalPrefillHref(gem({ symbol: '富贵 & co' })));
    expect(params.get('symbol')).toBe('富贵 & co');
  });
});

describe('parseTradePrefill', () => {
  it('round-trips what journalPrefillHref writes', () => {
    // The reason both live in one file: a renamed key on either side
    // produces a link that still works and fills in nothing.
    const parsed = parseTradePrefill(parseHref(journalPrefillHref(gem())));
    expect(parsed).toEqual({
      symbol: 'NOVALUE',
      side: 'spot',
      entryPrice: '0.00042',
      note: 'solana · bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub · Gem 71',
    });
  });

  it('round-trips a gem with no price into an empty price box', () => {
    const parsed = parseTradePrefill(parseHref(journalPrefillHref(gem({ priceUsd: null }))));
    expect(parsed?.entryPrice).toBe('');
    expect(parsed?.symbol).toBe('NOVALUE');
  });

  it('is null when there is no symbol, rather than an empty draft', () => {
    expect(parseTradePrefill(new URLSearchParams(''))).toBeNull();
    expect(parseTradePrefill(new URLSearchParams('side=spot&entry=1'))).toBeNull();
    expect(parseTradePrefill(new URLSearchParams('symbol=&entry=1'))).toBeNull();
    expect(parseTradePrefill(new URLSearchParams('symbol=%20%20'))).toBeNull();
  });

  it('falls back to spot for a side that is missing or nonsense', () => {
    // A URL is user input. Refusing the whole draft over one bad field
    // would throw away the symbol and price for nothing.
    expect(parseTradePrefill(new URLSearchParams('symbol=X&side=sideways'))?.side).toBe('spot');
    expect(parseTradePrefill(new URLSearchParams('symbol=X'))?.side).toBe('spot');
    expect(parseTradePrefill(new URLSearchParams('symbol=X&side=SPOT'))?.side).toBe('spot');
  });

  it('honours a side that is genuinely long or short', () => {
    expect(parseTradePrefill(new URLSearchParams('symbol=X&side=long'))?.side).toBe('long');
    expect(parseTradePrefill(new URLSearchParams('symbol=X&side=short'))?.side).toBe('short');
  });

  it('drops a price that is not a number instead of putting it in the box', () => {
    expect(parseTradePrefill(new URLSearchParams('symbol=X&entry=abc'))?.entryPrice).toBe('');
    expect(parseTradePrefill(new URLSearchParams('symbol=X&entry='))?.entryPrice).toBe('');
    expect(parseTradePrefill(new URLSearchParams('symbol=X&entry=Infinity'))?.entryPrice).toBe('');
  });

  it('keeps a valid price exactly as written, including sub-cent precision', () => {
    expect(parseTradePrefill(new URLSearchParams('symbol=X&entry=0.000000123'))?.entryPrice).toBe('0.000000123');
  });
});
