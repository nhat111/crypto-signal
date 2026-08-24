import { z } from 'zod';
import type { Timeframe } from './types.js';

/**
 * Single source of truth for every threshold/weight the spec requires to be
 * configurable (spec §9, §12, §13, rule "Tất cả threshold và weight phải
 * configurable"). Nothing here is a magic number buried in business logic —
 * indicators/signal-engine/health-engine all read from this object.
 *
 * Every field has a spec-given default where the spec gave one (funding,
 * volume anomaly), and a documented reasonable default otherwise
 * (ASSUMPTIONS.md §9).
 */

const numeric = (defaultValue: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? defaultValue : Number(v)), z.number());

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://crypto:crypto@localhost:5432/crypto_market_health'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  API_PORT: numeric(4000),
  API_HOST: z.string().default('0.0.0.0'),
  NEXT_PUBLIC_API_BASE_URL: z.string().default('http://localhost:4000'),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_ALERT_CHAT_IDS: z.string().default(''),

  SYMBOLS: z.string().default('BTCUSDT,ETHUSDT,SOLUSDT'),
  /** Futures-only symbols (no Binance Spot listing) — see ASSUMPTIONS.md §15. Tracked with a reduced indicator/signal set. */
  FUTURES_ONLY_SYMBOLS: z.string().default(''),
  TIMEFRAMES: z.string().default('5m,15m,1h,4h'),

  BINANCE_SPOT_REST_BASE: z.string().default('https://api.binance.com'),
  BINANCE_SPOT_WS_BASE: z.string().default('wss://stream.binance.com:9443'),
  BINANCE_FUTURES_REST_BASE: z.string().default('https://fapi.binance.com'),
  BINANCE_FUTURES_WS_BASE: z.string().default('wss://fstream.binance.com'),

  THRESH_PRICE_CHANGE_PCT: numeric(0.3),
  THRESH_CVD_SKEW_RATIO: numeric(0.15),
  THRESH_OI_CHANGE_PCT: numeric(2),
  THRESH_OI_STRONG_CHANGE_PCT: numeric(5),
  THRESH_FUNDING_ELEVATED_PCT: numeric(0.01),
  THRESH_FUNDING_EXTREME_PCT: numeric(0.03),
  THRESH_VOLUME_ELEVATED_MULT: numeric(1.5),
  THRESH_VOLUME_ABNORMAL_MULT: numeric(2),
  THRESH_VOLUME_EXTREME_MULT: numeric(3),
  THRESH_LIQUIDATION_SPIKE_MULT: numeric(3),
  THRESH_BASIS_ELEVATED_PCT: numeric(0.1),

  ALERT_COOLDOWN_MINUTES: numeric(30),
  ALERT_CONFIDENCE_DELTA_RETRIGGER: numeric(15),

  LOG_LEVEL: z.string().default('info'),

  ANTHROPIC_API_KEY: z.string().default(''),
});

export interface Thresholds {
  priceChangePct: number;
  cvdSkewRatio: number;
  oiChangePct: number;
  oiStrongChangePct: number;
  fundingElevatedPct: number;
  fundingExtremePct: number;
  volumeElevatedMult: number;
  volumeAbnormalMult: number;
  volumeExtremeMult: number;
  liquidationSpikeMult: number;
  basisElevatedPct: number;
}

/** Spec §13 example weights. Must sum to 100. */
export interface HealthWeights {
  spotConfirmation: number;
  futuresPositioning: number;
  openInterest: number;
  funding: number;
  liquidation: number;
  volume: number;
  priceStructure: number;
  divergence: number;
}

/**
 * Not given explicitly by the spec (only that Health and Risk must be
 * independent, §14) — our own weighting, documented in ASSUMPTIONS.md §7.
 * Must sum to 100.
 */
export interface RiskWeights {
  fundingExtremity: number;
  oiVelocity: number;
  basisExtremity: number;
  liquidationAnomaly: number;
  volumeExtremity: number;
  crowding: number;
}

export interface ConfidenceWeights {
  dataQuality: number;
  confirmation: number;
  magnitude: number;
  historical: number;
}

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  apiPort: number;
  apiHost: string;
  apiBaseUrl: string;
  telegramBotToken: string;
  telegramAlertChatIds: string[];
  symbols: string[];
  /** Symbols tracked in reduced (Futures-only, no Spot) mode — disjoint from `symbols`. */
  futuresOnlySymbols: string[];
  timeframes: Timeframe[];
  binance: {
    spotRestBase: string;
    spotWsBase: string;
    futuresRestBase: string;
    futuresWsBase: string;
  };
  thresholds: Thresholds;
  healthWeights: HealthWeights;
  riskWeights: RiskWeights;
  confidenceWeights: ConfidenceWeights;
  alert: {
    cooldownMinutes: number;
    confidenceDeltaRetrigger: number;
  };
  logLevel: string;
  anthropicApiKey: string;
}

const HEALTH_WEIGHTS: HealthWeights = {
  spotConfirmation: 25,
  futuresPositioning: 15,
  openInterest: 15,
  funding: 10,
  liquidation: 10,
  volume: 10,
  priceStructure: 10,
  divergence: 5,
};

const RISK_WEIGHTS: RiskWeights = {
  fundingExtremity: 25,
  oiVelocity: 20,
  basisExtremity: 15,
  liquidationAnomaly: 20,
  volumeExtremity: 10,
  crowding: 10,
};

const CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  dataQuality: 0.25,
  confirmation: 0.3,
  magnitude: 0.25,
  historical: 0.2,
};

function assertSumsTo100(name: string, values: number[]): void {
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(`${name} weights must sum to 100, got ${sum}`);
  }
}

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.parse(env);

  assertSumsTo100('health', Object.values(HEALTH_WEIGHTS));
  assertSumsTo100('risk', Object.values(RISK_WEIGHTS));

  const config: AppConfig = {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    apiPort: parsed.API_PORT,
    apiHost: parsed.API_HOST,
    apiBaseUrl: parsed.NEXT_PUBLIC_API_BASE_URL,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramAlertChatIds: parsed.TELEGRAM_ALERT_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    symbols: parsed.SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean),
    futuresOnlySymbols: parsed.FUTURES_ONLY_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean),
    timeframes: parsed.TIMEFRAMES.split(',').map((s) => s.trim()).filter(Boolean) as Timeframe[],
    binance: {
      spotRestBase: parsed.BINANCE_SPOT_REST_BASE,
      spotWsBase: parsed.BINANCE_SPOT_WS_BASE,
      futuresRestBase: parsed.BINANCE_FUTURES_REST_BASE,
      futuresWsBase: parsed.BINANCE_FUTURES_WS_BASE,
    },
    thresholds: {
      priceChangePct: parsed.THRESH_PRICE_CHANGE_PCT,
      cvdSkewRatio: parsed.THRESH_CVD_SKEW_RATIO,
      oiChangePct: parsed.THRESH_OI_CHANGE_PCT,
      oiStrongChangePct: parsed.THRESH_OI_STRONG_CHANGE_PCT,
      fundingElevatedPct: parsed.THRESH_FUNDING_ELEVATED_PCT,
      fundingExtremePct: parsed.THRESH_FUNDING_EXTREME_PCT,
      volumeElevatedMult: parsed.THRESH_VOLUME_ELEVATED_MULT,
      volumeAbnormalMult: parsed.THRESH_VOLUME_ABNORMAL_MULT,
      volumeExtremeMult: parsed.THRESH_VOLUME_EXTREME_MULT,
      liquidationSpikeMult: parsed.THRESH_LIQUIDATION_SPIKE_MULT,
      basisElevatedPct: parsed.THRESH_BASIS_ELEVATED_PCT,
    },
    healthWeights: HEALTH_WEIGHTS,
    riskWeights: RISK_WEIGHTS,
    confidenceWeights: CONFIDENCE_WEIGHTS,
    alert: {
      cooldownMinutes: parsed.ALERT_COOLDOWN_MINUTES,
      confidenceDeltaRetrigger: parsed.ALERT_CONFIDENCE_DELTA_RETRIGGER,
    },
    logLevel: parsed.LOG_LEVEL,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
  };

  cached = config;
  return config;
}

/** Test-only escape hatch so unit tests don't share the module-level cache. */
export function resetConfigCache(): void {
  cached = undefined;
}
