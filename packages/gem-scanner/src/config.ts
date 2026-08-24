import { z } from 'zod';

/**
 * Every threshold and weight the gem scanner uses, in one place — same rule
 * the market-health side follows ("Tất cả threshold và weight phải
 * configurable"). Nothing below is hard-coded in the scoring logic itself.
 *
 * Defaults target the profile chosen for this scanner: small caps that have
 * already survived a while, not brand-new pools. They are starting points,
 * not tuned values — nothing here has been validated against recorded
 * outcomes yet (see the `/gems/performance` surface).
 */

const numeric = (defaultValue: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? defaultValue : Number(v)), z.number());

export const gemEnvSchema = z.object({
  GEM_SCAN_ENABLED: z
    .preprocess((v) => v === 'true' || v === '1', z.boolean())
    .default(false),
  GEM_CHAINS: z.string().default('solana'),
  GEM_SCAN_INTERVAL_MINUTES: numeric(30),

  /** Hard eligibility window — anything outside it isn't the kind of token this scanner is for. */
  GEM_MIN_LIQUIDITY_USD: numeric(50_000),
  GEM_MAX_LIQUIDITY_USD: numeric(5_000_000),
  GEM_MIN_VOLUME_24H_USD: numeric(25_000),
  GEM_MIN_AGE_DAYS: numeric(7),
  /** FDV ceiling — above this it's no longer a small cap worth "discovering". */
  GEM_MAX_FDV_USD: numeric(50_000_000),

  /** Scoring shape. */
  GEM_IDEAL_VOLUME_TO_LIQUIDITY: numeric(1.5),
  GEM_MAX_HEALTHY_VOLUME_TO_LIQUIDITY: numeric(10),
  GEM_IDEAL_AGE_DAYS: numeric(60),
  GEM_VERTICAL_PUMP_24H_PCT: numeric(100),

  /** Alerting. */
  GEM_ALERT_MIN_SCORE: numeric(70),
  GEM_ALERT_COOLDOWN_HOURS: numeric(24),

  RUGCHECK_API_KEY: z.string().default(''),
});

export interface GemThresholds {
  minLiquidityUsd: number;
  maxLiquidityUsd: number;
  minVolume24hUsd: number;
  minAgeDays: number;
  maxFdvUsd: number;
  idealVolumeToLiquidity: number;
  maxHealthyVolumeToLiquidity: number;
  idealAgeDays: number;
  verticalPump24hPct: number;
}

/** Must sum to 100. */
export interface GemScoreWeights {
  liquidityQuality: number;
  volumeConviction: number;
  buyPressure: number;
  survival: number;
  momentumStructure: number;
}

/** Must sum to 100. Independent of the gem score, like Health vs Risk on the market-health side. */
export interface GemRiskWeights {
  safety: number;
  concentration: number;
  liquidityFragility: number;
  ageRisk: number;
  pumpExhaustion: number;
}

export const GEM_SCORE_WEIGHTS: GemScoreWeights = {
  liquidityQuality: 25,
  volumeConviction: 25,
  buyPressure: 20,
  survival: 20,
  momentumStructure: 10,
};

export const GEM_RISK_WEIGHTS: GemRiskWeights = {
  safety: 35,
  concentration: 20,
  liquidityFragility: 20,
  ageRisk: 10,
  pumpExhaustion: 15,
};

export interface GemConfig {
  enabled: boolean;
  chains: string[];
  scanIntervalMinutes: number;
  thresholds: GemThresholds;
  scoreWeights: GemScoreWeights;
  riskWeights: GemRiskWeights;
  alert: { minScore: number; cooldownHours: number };
  rugcheckApiKey: string;
}

function assertSumsTo100(name: string, values: number[]): void {
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) throw new Error(`${name} weights must sum to 100, got ${sum}`);
}

export function loadGemConfig(env: NodeJS.ProcessEnv = process.env): GemConfig {
  const parsed = gemEnvSchema.parse(env);

  assertSumsTo100('gem score', Object.values(GEM_SCORE_WEIGHTS));
  assertSumsTo100('gem risk', Object.values(GEM_RISK_WEIGHTS));

  return {
    enabled: parsed.GEM_SCAN_ENABLED,
    chains: parsed.GEM_CHAINS.split(',').map((s) => s.trim()).filter(Boolean),
    scanIntervalMinutes: parsed.GEM_SCAN_INTERVAL_MINUTES,
    thresholds: {
      minLiquidityUsd: parsed.GEM_MIN_LIQUIDITY_USD,
      maxLiquidityUsd: parsed.GEM_MAX_LIQUIDITY_USD,
      minVolume24hUsd: parsed.GEM_MIN_VOLUME_24H_USD,
      minAgeDays: parsed.GEM_MIN_AGE_DAYS,
      maxFdvUsd: parsed.GEM_MAX_FDV_USD,
      idealVolumeToLiquidity: parsed.GEM_IDEAL_VOLUME_TO_LIQUIDITY,
      maxHealthyVolumeToLiquidity: parsed.GEM_MAX_HEALTHY_VOLUME_TO_LIQUIDITY,
      idealAgeDays: parsed.GEM_IDEAL_AGE_DAYS,
      verticalPump24hPct: parsed.GEM_VERTICAL_PUMP_24H_PCT,
    },
    scoreWeights: GEM_SCORE_WEIGHTS,
    riskWeights: GEM_RISK_WEIGHTS,
    alert: { minScore: parsed.GEM_ALERT_MIN_SCORE, cooldownHours: parsed.GEM_ALERT_COOLDOWN_HOURS },
    rugcheckApiKey: parsed.RUGCHECK_API_KEY,
  };
}
