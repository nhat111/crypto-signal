import { describe, expect, it } from 'vitest';
import { GEM_RISK_WEIGHTS, GEM_SCORE_WEIGHTS, type GemThresholds } from './config.js';
import {
  buyPressureScore,
  checkEligibility,
  evaluateGem,
  momentumStructureScore,
  survivalScore,
  volumeConvictionScore,
} from './scoring.js';
import type { GemPair, SafetyReport } from './types.js';

const thresholds: GemThresholds = {
  minLiquidityUsd: 50_000,
  maxLiquidityUsd: 5_000_000,
  minVolume24hUsd: 25_000,
  minAgeDays: 7,
  maxFdvUsd: 50_000_000,
  idealVolumeToLiquidity: 1.5,
  maxHealthyVolumeToLiquidity: 10,
  idealAgeDays: 60,
  staleAgeDays: 365,
  verticalPump24hPct: 100,
  extremePump24hPct: 300,
};

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function pair(overrides: Partial<GemPair> = {}): GemPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair1',
    dexId: 'raydium',
    baseToken: { address: 'tok1', name: 'Test Token', symbol: 'TEST' },
    quoteToken: { address: 'sol', symbol: 'SOL' },
    priceUsd: 0.01,
    liquidityUsd: 300_000,
    fdvUsd: 5_000_000,
    marketCapUsd: 4_000_000,
    volume: { h1: 20_000, h6: 120_000, h24: 450_000 },
    priceChangePct: { m5: 0.2, h1: 1, h6: 4, h24: 12 },
    txns: { h1: { buys: 60, sells: 40 }, h24: { buys: 700, sells: 500 } },
    pairCreatedAt: NOW - 45 * DAY,
    url: 'https://dexscreener.com/solana/pair1',
    fetchedAt: NOW,
    ...overrides,
  };
}

function safety(overrides: Partial<SafetyReport> = {}): SafetyReport {
  return {
    chainId: 'solana',
    tokenAddress: 'tok1',
    verdict: 'safe',
    flags: [],
    topHolderPct: 8,
    lpLocked: true,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    checkedAt: NOW,
    ...overrides,
  };
}

function evaluate(p: GemPair, s: SafetyReport | null) {
  return evaluateGem({ pair: p, safety: s, thresholds, scoreWeights: GEM_SCORE_WEIGHTS, riskWeights: GEM_RISK_WEIGHTS, now: NOW });
}

describe('eligibility gate', () => {
  it('accepts a token inside every band', () => {
    expect(checkEligibility(pair(), thresholds, NOW)).toEqual([]);
  });

  it('rejects a pool younger than the minimum age — the whole point of scanning for survivors', () => {
    const young = pair({ pairCreatedAt: NOW - 2 * DAY });
    expect(checkEligibility(young, thresholds, NOW)).toContain('too_young');
  });

  it('rejects liquidity below the floor (cannot exit) and above the ceiling (no longer a small cap)', () => {
    expect(checkEligibility(pair({ liquidityUsd: 10_000 }), thresholds, NOW)).toContain('liquidity_too_low');
    expect(checkEligibility(pair({ liquidityUsd: 50_000_000 }), thresholds, NOW)).toContain('liquidity_too_high');
  });

  it('treats missing data as a failure, never as a pass', () => {
    expect(checkEligibility(pair({ liquidityUsd: null }), thresholds, NOW)).toContain('missing_liquidity_data');
    expect(checkEligibility(pair({ pairCreatedAt: null }), thresholds, NOW)).toContain('missing_age_data');
    expect(checkEligibility(pair({ volume: { h1: null, h6: null, h24: null } }), thresholds, NOW)).toContain(
      'missing_volume_data',
    );
  });

  it('does not disqualify on an unreported FDV — it is a bound, not a safety property', () => {
    expect(checkEligibility(pair({ fdvUsd: null }), thresholds, NOW)).toEqual([]);
  });

  it('hard-rejects a token already up past the extreme-pump cutoff, no matter how good everything else looks', () => {
    // Dinger-shaped case: +3268% in 24h on thin liquidity — already a
    // crowded trade, not an undiscovered one, so no score should rescue it.
    const alreadyPumped = pair({ priceChangePct: { m5: null, h1: null, h6: null, h24: 3268 } });
    expect(checkEligibility(alreadyPumped, thresholds, NOW)).toContain('extreme_pump');

    const result = evaluate(alreadyPumped, safety());
    expect(result.eligible).toBe(false);
    expect(result.score).toBeNull();
  });

  it('does not reject a mild pump below the extreme cutoff — only the soft momentum penalty applies there', () => {
    const mildPump = pair({ priceChangePct: { m5: null, h1: null, h6: null, h24: 102 } });
    expect(checkEligibility(mildPump, thresholds, NOW)).toEqual([]);
  });
});

describe('safety gate', () => {
  it('excludes a token the screen calls dangerous no matter how good the market data looks', () => {
    const result = evaluate(pair(), safety({ verdict: 'danger', flags: ['Mint authority is still active.'] }));
    expect(result.eligible).toBe(false);
    expect(result.score).toBeNull();
    expect(result.reasons.join(' ')).toContain('critical problem');
  });

  it('still scores a token whose screen came back unknown, but rates it riskier than a clean one', () => {
    const clean = evaluate(pair(), safety({ verdict: 'safe' }));
    const unverified = evaluate(pair(), safety({ verdict: 'unknown', mintAuthorityRevoked: null, lpLocked: null, topHolderPct: null }));

    expect(clean.eligible).toBe(true);
    expect(unverified.eligible).toBe(true);
    expect(unverified.riskScore).toBeGreaterThan(clean.riskScore);
  });

  it('rates a token with no screen at all as riskier than a screened-clean one', () => {
    const clean = evaluate(pair(), safety({ verdict: 'safe' }));
    const unscreened = evaluate(pair(), null);
    expect(unscreened.riskScore).toBeGreaterThan(clean.riskScore);
    expect(unscreened.reasons.join(' ')).toContain('unverified');
  });
});

describe('volume conviction', () => {
  it('rewards healthy turnover but penalizes volume far above liquidity (wash-trading shape)', () => {
    const healthy = volumeConvictionScore(pair({ liquidityUsd: 300_000, volume: { h1: null, h6: null, h24: 450_000 } }), thresholds);
    const absurd = volumeConvictionScore(pair({ liquidityUsd: 300_000, volume: { h1: null, h6: null, h24: 30_000_000 } }), thresholds);
    expect(healthy).toBeGreaterThan(80);
    expect(absurd).toBeLessThan(healthy);
  });

  it('scores zero when liquidity is unknown rather than assuming a ratio', () => {
    expect(volumeConvictionScore(pair({ liquidityUsd: null }), thresholds)).toBe(0);
  });
});

describe('buy pressure', () => {
  it('is derived from counted buy/sell transactions, never from price direction', () => {
    // A token whose price FELL but whose trades were mostly buys must still
    // score above neutral — proving direction isn't an input.
    const fellButBought = pair({ priceChangePct: { m5: null, h1: null, h6: null, h24: -20 }, txns: { h1: null, h24: { buys: 900, sells: 100 } } });
    expect(buyPressureScore(fellButBought)).toBeGreaterThan(50);

    const roseButSold = pair({ priceChangePct: { m5: null, h1: null, h6: null, h24: 20 }, txns: { h1: null, h24: { buys: 100, sells: 900 } } });
    expect(buyPressureScore(roseButSold)).toBeLessThan(50);
  });

  it('is neutral, not punitive, when no transaction data exists', () => {
    expect(buyPressureScore(pair({ txns: { h1: null, h24: null } }))).toBe(50);
  });
});

describe('momentum structure', () => {
  it('scores a vertical 24h pump near the floor — an already-found trade is not an undiscovered one', () => {
    const vertical = momentumStructureScore(pair({ priceChangePct: { m5: null, h1: null, h6: null, h24: 400 } }), thresholds);
    const steady = momentumStructureScore(pair({ priceChangePct: { m5: null, h1: null, h6: 4, h24: 12 } }), thresholds);
    expect(vertical).toBeLessThan(steady);
  });
});

describe('gem score and risk score are independent', () => {
  it('can rate a token well on merit while still rating it high risk', () => {
    // Strong market data, but concentrated ownership and an unverified screen.
    const risky = evaluate(
      pair(),
      safety({ verdict: 'caution', topHolderPct: 35, lpLocked: true, flags: ['Largest holder controls 35.0% of supply.'] }),
    );

    expect(risky.eligible).toBe(true);
    expect(risky.score).toBeGreaterThanOrEqual(50);
    expect(risky.riskScore).toBeGreaterThanOrEqual(40);
  });

  it('never returns a score for an ineligible token, so it cannot be ranked beside real candidates', () => {
    const result = evaluate(pair({ liquidityUsd: 1_000 }), safety());
    expect(result.eligible).toBe(false);
    expect(result.score).toBeNull();
    expect(result.components).toBeNull();
    // Risk is still computed — it doesn't depend on passing the gate.
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it('always explains itself, eligible or not', () => {
    expect(evaluate(pair(), safety()).reasons.length).toBeGreaterThan(0);
    expect(evaluate(pair({ liquidityUsd: 1_000 }), safety()).reasons.length).toBeGreaterThan(0);
  });

  it('always carries an explicit not-a-recommendation note on a surfaced candidate', () => {
    expect(evaluate(pair(), safety()).reasons.join(' ')).toContain('not a recommendation');
  });
});

describe('survival (age)', () => {
  const ages = [10, 14, 21, 30, 45, 60, 90, 120, 180, 270];

  it('ranks something — the old version scored every surviving token the same', () => {
    // The defect this replaced, stated as a property rather than a number:
    // 55 production scans out of 55 landed in one band because everything
    // past the ideal age returned exactly 100. A component that cannot
    // separate the population it sees carries weight and ranks nothing.
    const scores = new Set(ages.map((d) => survivalScore(d, thresholds)));
    expect(scores.size).toBeGreaterThan(5);
  });

  it('peaks at the ideal age rather than climbing forever', () => {
    expect(survivalScore(thresholds.idealAgeDays, thresholds)).toBe(100);
    // The specific failure: older used to mean better, without limit.
    expect(survivalScore(365 * 2, thresholds)).toBeLessThan(survivalScore(60, thresholds));
    expect(survivalScore(270, thresholds)).toBeLessThan(survivalScore(90, thresholds));
  });

  it('rises to the peak and falls after it, without a step in between', () => {
    const rising = [10, 21, 30, 45, 60];
    for (let i = 1; i < rising.length; i += 1) {
      expect(survivalScore(rising[i] as number, thresholds)).toBeGreaterThan(
        survivalScore(rising[i - 1] as number, thresholds),
      );
    }
    const falling = [60, 90, 180, 270];
    for (let i = 1; i < falling.length; i += 1) {
      expect(survivalScore(falling[i] as number, thresholds)).toBeLessThan(
        survivalScore(falling[i - 1] as number, thresholds),
      );
    }
  });

  it('scores a token too new or long dead at the floor, not at zero', () => {
    // Zero would be indistinguishable from "no age data", which is a
    // different statement — one is measured, the other is missing.
    expect(survivalScore(thresholds.minAgeDays, thresholds)).toBe(20);
    expect(survivalScore(thresholds.staleAgeDays + 1, thresholds)).toBe(20);
    expect(survivalScore(null, thresholds)).toBe(0);
  });

  it('survives a misconfigured window instead of dividing by zero', () => {
    const broken = { ...thresholds, idealAgeDays: 5, staleAgeDays: 3 };
    const score = survivalScore(30, broken);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

