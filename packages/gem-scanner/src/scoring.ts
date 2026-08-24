import { clamp } from '@crypto-signal/shared';
import type { GemRiskWeights, GemScoreWeights, GemThresholds } from './config.js';
import type { GemPair, SafetyReport } from './types.js';

/**
 * Deterministic scoring for small-cap discovery.
 *
 * Two independent 0-100 scores, mirroring Health vs Leverage Risk on the
 * market-health side: an opportunity score and a risk score that must never
 * be netted into one number. A token can plausibly score 75 on merit and 85
 * on risk at the same time — that is exactly the situation a buyer needs to
 * see, and a single blended number would hide it.
 *
 * Every component is a pure function of already-fetched data, so the same
 * inputs always produce the same score and each one is unit-testable.
 */

export interface GemComponents {
  liquidityQuality: number;
  volumeConviction: number;
  buyPressure: number;
  survival: number;
  momentumStructure: number;
}

export interface GemRiskComponents {
  safety: number;
  concentration: number;
  liquidityFragility: number;
  ageRisk: number;
  pumpExhaustion: number;
}

export type EligibilityFailure =
  | 'liquidity_too_low'
  | 'liquidity_too_high'
  | 'volume_too_low'
  | 'too_young'
  | 'fdv_too_high'
  | 'missing_liquidity_data'
  | 'missing_volume_data'
  | 'missing_age_data';

export interface GemEvaluation {
  eligible: boolean;
  /** Why it didn't qualify. Empty when eligible. */
  failures: EligibilityFailure[];
  /** Null when ineligible — an unqualified token gets no score at all rather than a low one, so it can't be sorted alongside real candidates. */
  score: number | null;
  components: GemComponents | null;
  riskScore: number;
  riskComponents: GemRiskComponents;
  /** Plain-language explanation, always populated. */
  reasons: string[];
  ageDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageDaysOf(pair: GemPair, now: number): number | null {
  if (pair.pairCreatedAt === null) return null;
  return (now - pair.pairCreatedAt) / DAY_MS;
}

/**
 * Hard eligibility gate. Runs before scoring so the "hidden gem" list can
 * never contain something that simply isn't in the target profile.
 *
 * Missing data fails the gate rather than passing it: a token whose
 * liquidity we couldn't read is not the same as one we verified is liquid.
 */
export function checkEligibility(pair: GemPair, thresholds: GemThresholds, now: number): EligibilityFailure[] {
  const failures: EligibilityFailure[] = [];

  if (pair.liquidityUsd === null) {
    failures.push('missing_liquidity_data');
  } else {
    if (pair.liquidityUsd < thresholds.minLiquidityUsd) failures.push('liquidity_too_low');
    if (pair.liquidityUsd > thresholds.maxLiquidityUsd) failures.push('liquidity_too_high');
  }

  if (pair.volume.h24 === null) failures.push('missing_volume_data');
  else if (pair.volume.h24 < thresholds.minVolume24hUsd) failures.push('volume_too_low');

  const age = ageDaysOf(pair, now);
  if (age === null) failures.push('missing_age_data');
  else if (age < thresholds.minAgeDays) failures.push('too_young');

  // An unknown FDV doesn't disqualify — it's a "nice to have" bound, not a
  // safety property, and plenty of legitimate pairs omit it.
  if (pair.fdvUsd !== null && pair.fdvUsd > thresholds.maxFdvUsd) failures.push('fdv_too_high');

  return failures;
}

/** Peaks at the middle of the eligible liquidity band: deep enough to exit, small enough to still be undiscovered. */
export function liquidityQualityScore(pair: GemPair, thresholds: GemThresholds): number {
  if (pair.liquidityUsd === null) return 0;
  const { minLiquidityUsd: min, maxLiquidityUsd: max } = thresholds;
  if (pair.liquidityUsd <= min || pair.liquidityUsd >= max) return 20;

  // Log scale: the gap between $50k and $500k matters far more than
  // between $4M and $4.5M.
  const t = (Math.log(pair.liquidityUsd) - Math.log(min)) / (Math.log(max) - Math.log(min));
  const distanceFromIdeal = Math.abs(t - 0.5) * 2; // 0 at the middle, 1 at either edge
  return Math.round(clamp(100 - distanceFromIdeal * 60, 0, 100));
}

/**
 * Turnover (24h volume / liquidity). Real interest shows up as volume
 * against the pool's depth — but past a point, volume far exceeding
 * liquidity is the signature of wash trading rather than demand, so the
 * curve falls away again instead of rewarding it without limit.
 */
export function volumeConvictionScore(pair: GemPair, thresholds: GemThresholds): number {
  if (pair.volume.h24 === null || pair.liquidityUsd === null || pair.liquidityUsd <= 0) return 0;
  const ratio = pair.volume.h24 / pair.liquidityUsd;
  const { idealVolumeToLiquidity: ideal, maxHealthyVolumeToLiquidity: max } = thresholds;

  if (ratio <= 0) return 0;
  if (ratio <= ideal) return Math.round(clamp((ratio / ideal) * 100, 0, 100));
  if (ratio >= max) return 15;
  const over = (ratio - ideal) / (max - ideal);
  return Math.round(clamp(100 - over * 70, 0, 100));
}

/**
 * Buy vs sell transaction counts.
 *
 * This is counted trade-side data, never inferred from candle color — the
 * same rule the Binance side follows for CVD. It counts *transactions*,
 * not size, so it can be skewed by many tiny buys; it is one component
 * among five, weighted accordingly.
 */
export function buyPressureScore(pair: GemPair): number {
  const window = pair.txns.h24 ?? pair.txns.h1;
  if (!window) return 50; // no data: neutral, not a penalty
  const total = window.buys + window.sells;
  if (total === 0) return 50;
  const buyShare = window.buys / total;
  // 0.5 (balanced) maps to 50, 1.0 (all buys) to 100, 0 to 0.
  return Math.round(clamp(buyShare * 100, 0, 100));
}

/** Age as evidence of survival — the whole premise of scanning for tokens that already lasted, rather than fresh pools. */
export function survivalScore(ageDays: number | null, thresholds: GemThresholds): number {
  if (ageDays === null) return 0;
  if (ageDays >= thresholds.idealAgeDays) return 100;
  return Math.round(clamp((ageDays / thresholds.idealAgeDays) * 100, 0, 100));
}

/**
 * Rewards a move that is building steadily rather than going vertical.
 * A token already up 300% in 24h is not an undiscovered gem — it's a
 * trade someone else found first.
 */
export function momentumStructureScore(pair: GemPair, thresholds: GemThresholds): number {
  const h24 = pair.priceChangePct.h24;
  const h6 = pair.priceChangePct.h6;
  if (h24 === null) return 50;

  if (h24 >= thresholds.verticalPump24hPct) return 10;
  if (h24 <= -50) return 20;

  // Mild-to-solid positive drift scores best; flat and falling score lower.
  let score = clamp(50 + h24, 0, 100);

  // Penalize when most of the 24h move happened in the last 6h (vertical).
  if (h6 !== null && h24 > 0 && h6 > 0 && h6 / h24 > 0.8) score -= 20;

  return Math.round(clamp(score, 0, 100));
}

/** 0 = safest. Unknown is deliberately worse than confirmed-clean but better than confirmed-dangerous. */
export function safetyRiskScore(safety: SafetyReport | null): number {
  if (!safety) return 75;
  switch (safety.verdict) {
    case 'safe':
      return 10;
    case 'caution':
      return 55;
    case 'danger':
      return 100;
    case 'unknown':
      return 75;
  }
}

export function concentrationRiskScore(safety: SafetyReport | null): number {
  if (!safety || safety.topHolderPct === null) return 60; // unknown concentration is itself a risk
  return Math.round(clamp(safety.topHolderPct * 2.5, 0, 100));
}

/** Thin pools are easy to exit-scam and hard to sell into. */
export function liquidityFragilityRiskScore(pair: GemPair, thresholds: GemThresholds): number {
  if (pair.liquidityUsd === null) return 80;
  if (pair.liquidityUsd >= thresholds.maxLiquidityUsd) return 5;
  const t = clamp(
    (pair.liquidityUsd - thresholds.minLiquidityUsd) / (thresholds.maxLiquidityUsd - thresholds.minLiquidityUsd),
    0,
    1,
  );
  return Math.round(clamp(90 - t * 85, 0, 100));
}

export function ageRiskScore(ageDays: number | null, thresholds: GemThresholds): number {
  if (ageDays === null) return 80;
  if (ageDays >= thresholds.idealAgeDays) return 10;
  return Math.round(clamp(90 - (ageDays / thresholds.idealAgeDays) * 80, 0, 100));
}

/** How much of the potential move has already happened — i.e. how late this is. */
export function pumpExhaustionRiskScore(pair: GemPair, thresholds: GemThresholds): number {
  const h24 = pair.priceChangePct.h24;
  if (h24 === null) return 50;
  if (h24 <= 0) return 15;
  return Math.round(clamp((h24 / thresholds.verticalPump24hPct) * 100, 0, 100));
}

export interface EvaluateGemInput {
  pair: GemPair;
  safety: SafetyReport | null;
  thresholds: GemThresholds;
  scoreWeights: GemScoreWeights;
  riskWeights: GemRiskWeights;
  now: number;
}

export function evaluateGem(input: EvaluateGemInput): GemEvaluation {
  const { pair, safety, thresholds, now } = input;
  const ageDays = ageDaysOf(pair, now);

  const riskComponents: GemRiskComponents = {
    safety: safetyRiskScore(safety),
    concentration: concentrationRiskScore(safety),
    liquidityFragility: liquidityFragilityRiskScore(pair, thresholds),
    ageRisk: ageRiskScore(ageDays, thresholds),
    pumpExhaustion: pumpExhaustionRiskScore(pair, thresholds),
  };
  const riskScore = weightedRiskScore(riskComponents, input.riskWeights);

  const failures = checkEligibility(pair, thresholds, now);

  // A confirmed-dangerous safety verdict disqualifies outright, no matter
  // how good the market data looks. Everything else is reported with its
  // risk score rather than hidden, so the caller decides.
  const safetyDisqualifies = safety?.verdict === 'danger';

  if (failures.length > 0 || safetyDisqualifies) {
    return {
      eligible: false,
      failures,
      score: null,
      components: null,
      riskScore,
      riskComponents,
      reasons: [
        ...(safetyDisqualifies ? ['Excluded: the safety screen found a critical problem.'] : []),
        ...failures.map(describeFailure),
        ...(safety?.flags ?? []),
      ],
      ageDays,
    };
  }

  const components: GemComponents = {
    liquidityQuality: liquidityQualityScore(pair, thresholds),
    volumeConviction: volumeConvictionScore(pair, thresholds),
    buyPressure: buyPressureScore(pair),
    survival: survivalScore(ageDays, thresholds),
    momentumStructure: momentumStructureScore(pair, thresholds),
  };

  return {
    eligible: true,
    failures: [],
    score: weightedGemScore(components, input.scoreWeights),
    components,
    riskScore,
    riskComponents,
    reasons: buildReasons(pair, safety, components, ageDays),
    ageDays,
  };
}

/** Weights sum to 100 (enforced in config), so the weighted sum is already on a 0-100 scale. */
function weightedGemScore(c: GemComponents, w: GemScoreWeights): number {
  const total =
    c.liquidityQuality * w.liquidityQuality +
    c.volumeConviction * w.volumeConviction +
    c.buyPressure * w.buyPressure +
    c.survival * w.survival +
    c.momentumStructure * w.momentumStructure;
  return Math.round(clamp(total / 100, 0, 100));
}

function weightedRiskScore(c: GemRiskComponents, w: GemRiskWeights): number {
  const total =
    c.safety * w.safety +
    c.concentration * w.concentration +
    c.liquidityFragility * w.liquidityFragility +
    c.ageRisk * w.ageRisk +
    c.pumpExhaustion * w.pumpExhaustion;
  return Math.round(clamp(total / 100, 0, 100));
}

function describeFailure(failure: EligibilityFailure): string {
  switch (failure) {
    case 'liquidity_too_low':
      return 'Liquidity is below the minimum for this scanner — hard to exit.';
    case 'liquidity_too_high':
      return 'Liquidity is above the small-cap range this scanner looks at.';
    case 'volume_too_low':
      return '24h volume is below the minimum — not enough real trading.';
    case 'too_young':
      return 'The pool is newer than the minimum age — it has not survived long enough for this scanner.';
    case 'fdv_too_high':
      return 'Fully diluted valuation is above the small-cap ceiling.';
    case 'missing_liquidity_data':
      return 'Liquidity was not reported — not scored rather than assumed.';
    case 'missing_volume_data':
      return 'Volume was not reported — not scored rather than assumed.';
    case 'missing_age_data':
      return 'Pool creation time was not reported, so age could not be verified.';
  }
}

function buildReasons(pair: GemPair, safety: SafetyReport | null, components: GemComponents, ageDays: number | null): string[] {
  const reasons: string[] = [];

  if (pair.liquidityUsd !== null) reasons.push(`Liquidity $${formatCompact(pair.liquidityUsd)}.`);
  if (pair.volume.h24 !== null && pair.liquidityUsd) {
    reasons.push(`24h volume $${formatCompact(pair.volume.h24)} (${(pair.volume.h24 / pair.liquidityUsd).toFixed(2)}x liquidity).`);
  }

  const window = pair.txns.h24 ?? pair.txns.h1;
  if (window) {
    reasons.push(`${window.buys} buys vs ${window.sells} sells in the last 24h (transaction counts, not size).`);
  }

  if (ageDays !== null) reasons.push(`Pool is ${Math.floor(ageDays)} days old.`);
  if (pair.priceChangePct.h24 !== null) reasons.push(`Price ${pair.priceChangePct.h24 >= 0 ? '+' : ''}${pair.priceChangePct.h24.toFixed(1)}% over 24h.`);

  if (safety) {
    reasons.push(
      safety.verdict === 'safe'
        ? 'Safety screen found no critical problems.'
        : safety.verdict === 'unknown'
          ? 'Safety screen could not be completed — treat as unverified.'
          : `Safety screen: ${safety.verdict}.`,
    );
    reasons.push(...safety.flags);
  } else {
    reasons.push('No safety screen available for this chain — treat as unverified.');
  }

  reasons.push(
    'This is a screening result from public DEX data, not a recommendation. Small-cap tokens can lose most of their value quickly.',
  );

  return reasons;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
