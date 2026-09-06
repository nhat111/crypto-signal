import { describe, expect, it } from 'vitest';
import { computeUnrealized, resolveGemPrice, type MarkPrice } from './markPrice.js';

const row = (tokenAddress: string, symbol: string, priceUsd: number) => ({
  tokenAddress,
  symbol,
  priceUsd,
  at: 1_700_000_000_000,
});

const SOL = 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub';
const EVM = '0x198dBa421A7DB566a90dA5De7901ABe3443b1234';

describe('resolveGemPrice', () => {
  it('matches a contract address before anything else', () => {
    const gems = [row(SOL, 'NOVALUE', 0.00042), row('0xother', 'NOVALUE', 9)];
    // The ticker is ambiguous here; the address is not, so the address wins
    // outright rather than the ambiguity poisoning a precise lookup.
    expect(resolveGemPrice(SOL, gems)).toMatchObject({ priceUsd: 0.00042, source: 'gem_scan' });
  });

  it('matches an EVM address whatever casing it was pasted in', () => {
    const gems = [row(EVM.toLowerCase(), 'PONS', 1.5)];
    expect(resolveGemPrice(EVM, gems).priceUsd).toBe(1.5);
    expect(resolveGemPrice(EVM.toUpperCase(), gems).priceUsd).toBe(1.5);
  });

  it('matches a ticker when exactly one token carries it', () => {
    expect(resolveGemPrice('PONS', [row(EVM, 'PONS', 1.5)])).toMatchObject({ priceUsd: 1.5 });
    expect(resolveGemPrice('pons', [row(EVM, 'PONS', 1.5)])).toMatchObject({ priceUsd: 1.5 });
  });

  /**
   * The case worth refusing. Tickers are not unique across chains, and a
   * confident wrong price is what somebody sells on.
   */
  it('refuses to guess when two tokens share a ticker', () => {
    const gems = [row(SOL, 'PONS', 0.5), row(EVM, 'PONS', 40)];
    expect(resolveGemPrice('PONS', gems)).toMatchObject({
      priceUsd: null,
      unknownReason: 'ambiguous_ticker',
    });
  });

  it('says not_found rather than ambiguous when nothing matches at all', () => {
    // Two different fixes: one means "log the address", the other means
    // "this chain is not scanned". Collapsing them sends people the wrong way.
    expect(resolveGemPrice('NOSUCH', [row(EVM, 'PONS', 1)])).toMatchObject({ unknownReason: 'not_found' });
    expect(resolveGemPrice('NOSUCH', [])).toMatchObject({ unknownReason: 'not_found' });
  });

  it('never returns a price and a reason at the same time', () => {
    const found = resolveGemPrice('PONS', [row(EVM, 'PONS', 1.5)]);
    expect(found.unknownReason).toBeNull();
    const missing = resolveGemPrice('PONS', []);
    expect(missing.priceUsd).toBeNull();
    expect(missing.at).toBeNull();
  });
});

const mark = (priceUsd: number | null, unknownReason: MarkPrice['unknownReason'] = null): MarkPrice => ({
  priceUsd,
  at: priceUsd === null ? null : 1_700_000_000_000,
  source: priceUsd === null ? null : 'gem_scan',
  unknownReason,
});

describe('computeUnrealized', () => {
  it('prices an open spot buy against the current price', () => {
    const r = computeUnrealized({ side: 'spot', entryPrice: 100, size: 2 }, mark(130));
    expect(r.unrealizedPnlPct).toBeCloseTo(30, 5);
    expect(r.unrealizedPnlUsd).toBeCloseTo(60, 5);
  });

  it('inverts for a short, and only for a short', () => {
    expect(computeUnrealized({ side: 'short', entryPrice: 100, size: 1 }, mark(110)).unrealizedPnlPct).toBeCloseTo(-10, 5);
    expect(computeUnrealized({ side: 'long', entryPrice: 100, size: 1 }, mark(110)).unrealizedPnlPct).toBeCloseTo(10, 5);
    expect(computeUnrealized({ side: 'spot', entryPrice: 100, size: 1 }, mark(110)).unrealizedPnlPct).toBeCloseTo(10, 5);
  });

  it('knows the % without a size, and says nothing about the $', () => {
    const r = computeUnrealized({ side: 'spot', entryPrice: 100, size: null }, mark(150));
    expect(r.unrealizedPnlPct).toBeCloseTo(50, 5);
    expect(r.unrealizedPnlUsd).toBeNull();
  });

  it('reports null, never zero, when there is no price', () => {
    // Zero would render as "flat" — a claim about the position rather than
    // an admission that nothing is known about it.
    const r = computeUnrealized({ side: 'spot', entryPrice: 100, size: 2 }, mark(null, 'not_found'));
    expect(r.unrealizedPnlPct).toBeNull();
    expect(r.unrealizedPnlUsd).toBeNull();
    expect(r.markPriceUnknownReason).toBe('not_found');
  });

  it('refuses a zero or negative mark instead of reporting a total loss', () => {
    // A bad price of 0 turns every long into -100%, which is a far more
    // alarming lie than a blank.
    expect(computeUnrealized({ side: 'spot', entryPrice: 100, size: 1 }, mark(0)).unrealizedPnlPct).toBeNull();
    expect(computeUnrealized({ side: 'spot', entryPrice: 100, size: 1 }, mark(-5)).unrealizedPnlPct).toBeNull();
  });

  it('refuses a zero entry price rather than dividing by it', () => {
    expect(computeUnrealized({ side: 'spot', entryPrice: 0, size: 1 }, mark(10)).unrealizedPnlPct).toBeNull();
  });

  it('carries the price and its age through even when it cannot be used', () => {
    const r = computeUnrealized({ side: 'spot', entryPrice: 0, size: 1 }, mark(10));
    expect(r.markPrice).toBe(10);
    expect(r.markPriceSource).toBe('gem_scan');
  });
});
