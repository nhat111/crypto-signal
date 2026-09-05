import { describe, expect, it } from 'vitest';
import { COMPARABLE_FAILURES, isComparableReject, sampleRejects } from './baseline.js';
import type { EligibilityFailure } from './scoring.js';

describe('isComparableReject', () => {
  it('accepts a token that was simply the wrong profile', () => {
    // Each of these is something a person could genuinely have bought that
    // day instead — which is the whole definition of a control here.
    for (const failure of COMPARABLE_FAILURES) {
      expect(isComparableReject([failure], 0.01), failure).toBe(true);
    }
  });

  it('refuses a token nobody could have traded', () => {
    // A pool this thin prints a price you could not have transacted at.
    // Counting its "return" as an alternative is fiction, and fiction that
    // happens to make the scanner look better.
    expect(isComparableReject(['liquidity_too_low'], 0.01)).toBe(false);
    expect(isComparableReject(['volume_too_low'], 0.01)).toBe(false);
  });

  it('refuses a token we could not read', () => {
    expect(isComparableReject(['missing_liquidity_data'], 0.01)).toBe(false);
    expect(isComparableReject(['missing_volume_data'], 0.01)).toBe(false);
    expect(isComparableReject(['missing_age_data'], 0.01)).toBe(false);
  });

  it('needs every reason to be comparable, not just one', () => {
    // A token that is both too big AND untradeable is still untradeable.
    // Taking the union would let the disqualifying half in through the
    // door the qualifying half opened.
    expect(isComparableReject(['fdv_too_high', 'liquidity_too_low'], 0.01)).toBe(false);
    expect(isComparableReject(['fdv_too_high', 'too_young'], 0.01)).toBe(true);
  });

  it('refuses a candidate with no usable price', () => {
    // Without a price at observation there is no return to compute later,
    // and inventing one is the failure this whole comparison exists to avoid.
    expect(isComparableReject(['too_young'], null)).toBe(false);
    expect(isComparableReject(['too_young'], 0)).toBe(false);
    expect(isComparableReject(['too_young'], -1)).toBe(false);
  });

  it('refuses a rejection with no stated reason', () => {
    // An empty failure list means it was not rejected by the gate at all.
    expect(isComparableReject([], 0.01)).toBe(false);
  });
});

describe('sampleRejects', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it('keeps everything when there is less than the cap', () => {
    expect(sampleRejects([1, 2, 3], 5, () => 0)).toEqual([1, 2, 3]);
  });

  it('takes nothing when the control is switched off', () => {
    expect(sampleRejects(items, 0, () => 0)).toEqual([]);
  });

  it('returns exactly the cap when there is more', () => {
    expect(sampleRejects(items, 5, Math.random)).toHaveLength(5);
  });

  it('does not just take the head of the list', () => {
    // Candidates arrive in discovery order, which correlates with volume
    // and recency on every feed. Taking the first N would quietly build a
    // control of the biggest, newest rejects and compare against that.
    const last = () => 0.999999;
    expect(sampleRejects(items, 3, last)).not.toEqual([0, 1, 2]);
  });

  it('never returns a duplicate', () => {
    // A swap-based sample that picks the same index twice would count one
    // token twice in the baseline.
    for (let seed = 0; seed < 50; seed += 1) {
      let n = seed;
      const rng = () => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
      const picked = sampleRejects(items, 10, rng);
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it('only ever returns members of the input', () => {
    const rng = () => 0.5;
    for (const picked of [sampleRejects(items, 7, rng), sampleRejects(items, 1, rng)]) {
      for (const value of picked) expect(items).toContain(value);
    }
  });

  it('leaves the caller’s array alone', () => {
    const original = [1, 2, 3, 4, 5];
    sampleRejects(original, 2, () => 0.9);
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });

  it('reaches every element across enough draws', () => {
    // A biased sampler that can never pick certain positions would produce
    // a control group that is not a sample of the rejects at all.
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) for (const v of sampleRejects(items, 5, Math.random)) seen.add(v);
    expect(seen.size).toBe(items.length);
  });
});

describe('the failure taxonomy stays exhaustive', () => {
  it('classifies every eligibility failure as comparable or not', () => {
    // A new reason added to the gate must be a deliberate decision here.
    // Defaulting it into the control is how an untradeable token quietly
    // becomes the thing the scanner is measured against.
    const all: EligibilityFailure[] = [
      'liquidity_too_low',
      'liquidity_too_high',
      'volume_too_low',
      'too_young',
      'fdv_too_high',
      'extreme_pump',
      'missing_liquidity_data',
      'missing_volume_data',
      'missing_age_data',
    ];
    const comparable = all.filter((f) => isComparableReject([f], 1));
    expect(comparable.sort()).toEqual([...COMPARABLE_FAILURES].sort());
  });
});
