import { describe, expect, it } from 'vitest';
import { GEM_POOL_GONE_GRACE_MS, resolveGemOutcome } from './gems.js';

const base = {
  priceAtScan: 1,
  liquidityAtScanUsd: 100_000,
  overdueMs: 0,
  feedAnswered: true,
};

describe('resolveGemOutcome', () => {
  it('records the quoted move when the pool is still there', () => {
    expect(resolveGemOutcome({ ...base, quote: { priceUsd: 1.5, liquidityUsd: 90_000 } })).toEqual({
      price: 1.5,
      movePct: 50,
      basis: 'observed',
    });
  });

  it('waits on a missing pair until the grace period has passed', () => {
    expect(resolveGemOutcome({ ...base, quote: null, overdueMs: GEM_POOL_GONE_GRACE_MS - 1 })).toBeNull();
  });

  it('writes a pool that stayed gone off at -100%', () => {
    expect(resolveGemOutcome({ ...base, quote: null, overdueMs: GEM_POOL_GONE_GRACE_MS })).toEqual({
      price: 0,
      movePct: -100,
      basis: 'pool_gone',
    });
  });

  it('treats a pair with no price like a missing one', () => {
    const quote = { priceUsd: null, liquidityUsd: 5_000 };
    expect(resolveGemOutcome({ ...base, quote, overdueMs: 0 })).toBeNull();
    expect(resolveGemOutcome({ ...base, quote, overdueMs: GEM_POOL_GONE_GRACE_MS })?.basis).toBe('pool_gone');
  });

  it('never writes anything off on a pass where the feed returned nothing for the chain', () => {
    expect(
      resolveGemOutcome({ ...base, quote: null, overdueMs: 30 * GEM_POOL_GONE_GRACE_MS, feedAnswered: false }),
    ).toBeNull();
  });

  it('counts a drained pool as a loss even when its last quote is up', () => {
    // Up 200% on paper, with a fifth less than a fifth of the liquidity
    // left: there is nobody to sell that price to.
    expect(resolveGemOutcome({ ...base, quote: { priceUsd: 3, liquidityUsd: 19_999 } })).toEqual({
      price: 3,
      movePct: -100,
      basis: 'liquidity_collapsed',
    });
  });

  it('does not call a pool drained at exactly a fifth of its liquidity', () => {
    expect(resolveGemOutcome({ ...base, quote: { priceUsd: 1, liquidityUsd: 20_000 } })?.basis).toBe('observed');
  });

  it('cannot judge a collapse without liquidity on both ends', () => {
    expect(resolveGemOutcome({ ...base, liquidityAtScanUsd: null, quote: { priceUsd: 2, liquidityUsd: 1 } })?.basis).toBe(
      'observed',
    );
    expect(resolveGemOutcome({ ...base, quote: { priceUsd: 2, liquidityUsd: null } })?.basis).toBe('observed');
  });
});
