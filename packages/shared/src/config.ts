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

  API_PORT: numeric(4000),
  API_HOST: z.string().default('0.0.0.0'),
  NEXT_PUBLIC_API_BASE_URL: z.string().default('http://localhost:4000'),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  // Telegram's own host by default. Overridable because the failure that
  // matters here — the bundler renaming a class node-fetch matches by name
  // — only happens inside the polling loop, which cannot be reached unless
  // something answers getMe first. Also what a self-hosted Bot API server
  // would need.
  TELEGRAM_API_ROOT: z.string().default('https://api.telegram.org'),
  TELEGRAM_ALERT_CHAT_IDS: z.string().default(''),
  /**
   * Set to 1 to make the worker send one test message to every configured
   * alert chat at boot, then say per chat whether it landed.
   *
   * Needed because the count on /status only proves the variable was read.
   * A mistyped id counts the same as a working one — the send 400s and is
   * swallowed so a bad recipient cannot stop the collector — so "đang bật
   * · 1 kênh" can sit over a channel that will never receive anything.
   */
  TELEGRAM_ALERT_TEST: z.string().default(''),

  SYMBOLS: z.string().default('BTCUSDT,ETHUSDT,SOLUSDT'),
  /** Futures-only symbols (no Binance Spot listing) — see ASSUMPTIONS.md §15. Tracked with a reduced indicator/signal set. */
  FUTURES_ONLY_SYMBOLS: z.string().default(''),
  TIMEFRAMES: z.string().default('5m,15m,1h,4h'),
  /**
   * The timeframe the bot answers on when nobody names one.
   *
   * 4h rather than 15m. A spot buyer holds for days, and a 15-minute health
   * reading flips several times inside one of their decisions — it is the
   * noisiest frame collected, answering a question they are not asking.
   *
   * It also matches OUTCOME horizon the performance page and the signal
   * verdicts are measured at, so what the bot reports and the evidence
   * about whether that reading has ever been worth anything are finally on
   * the same clock.
   */
  TELEGRAM_DEFAULT_TIMEFRAME: z.string().default('4h'),

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
  // How many times its own recent volatility a candle has to move before
  // it counts as a shock. 3 is deliberately high: this alert exists to be
  // rare, and one that fires on an ordinary Tuesday gets muted.
  THRESH_PRICE_SHOCK_ATR_MULT: numeric(3),
  // A floor so a dead-flat market cannot manufacture a shock out of noise:
  // three times almost-nothing is still almost-nothing.
  THRESH_PRICE_SHOCK_MIN_MOVE_PCT: numeric(1),

  ALERT_COOLDOWN_MINUTES: numeric(30),
  // Which timeframes may push a Telegram alert. Empty = all collected.
  ALERT_TIMEFRAMES: z.string().default(''),
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
  priceShockAtrMult: number;
  priceShockMinMovePct: number;
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
  apiPort: number;
  apiHost: string;
  apiBaseUrl: string;
  telegramBotToken: string;
  telegramApiRoot: string;
  telegramDefaultTimeframe: Timeframe;
  telegramAlertTest: boolean;
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
    /** Frames allowed to push to Telegram. Signals on other frames are still recorded. */
    timeframes: Timeframe[];
    /** Names in ALERT_TIMEFRAMES that are not collected — logged at boot so a typo is visible. */
    ignoredTimeframes: string[];
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

/**
 * The timeframe the bot answers on when nobody names one.
 *
 * Falls back to the longest frame actually collected rather than to the
 * configured one: a default nobody collects filters every row out, and an
 * empty /status reads as a dead collector rather than as a typo in an env
 * var — a wrong diagnosis being the expensive kind of wrong here.
 *
 * Pure and exported so it can be tested without reaching into the config
 * cache, which exists for the whole process lifetime by design.
 */
/**
 * Whether an on/off environment variable is on.
 *
 * Accepts any non-empty value except an explicit off. Somebody setting a
 * switch in a Railway dashboard should not have to guess whether this
 * codebase spells it "1", "true" or "yes", and a flag that silently
 * ignores "true" is a flag that gets reported as broken.
 */
export function isEnabledFlag(value: string): boolean {
  return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

export function pickDefaultTimeframe(configured: string, collected: Timeframe[]): Timeframe {
  if (collected.includes(configured as Timeframe)) return configured as Timeframe;
  return collected[collected.length - 1] as Timeframe;
}

/**
 * Which timeframes are allowed to push a Telegram alert.
 *
 * TELEGRAM_DEFAULT_TIMEFRAME only governs what the bot answers when it is
 * *asked* — it never touched the push path, so a spot holder who moved
 * /status to 4h still got woken up by 5m and 15m candles. This is the
 * other half of that switch.
 *
 * Filtering here silences Telegram only. Every signal is still stored and
 * still scored on /performance: the point is to stop pushing frames the
 * reader does not trade, not to stop measuring them.
 *
 * Empty means every collected frame, so an unset variable changes nothing.
 * A name that is not collected is reported rather than obeyed, and if
 * *nothing* matches the whole list is ignored — a typo must not turn every
 * alert off, because total silence is indistinguishable from a calm market
 * and is the one failure this system must never fake.
 */
export function pickAlertTimeframes(
  configured: string,
  collected: Timeframe[],
): { timeframes: Timeframe[]; ignored: string[] } {
  const wanted = configured.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matched = collected.filter((tf) => wanted.includes(tf.toLowerCase()));
  const ignored = wanted.filter((w) => !collected.some((tf) => tf.toLowerCase() === w));

  // One fallback for both "unset" and "every name was a typo" — they must
  // land the same way, because in either case the alternative is no alerts
  // at all, and no alerts is indistinguishable from a calm market.
  return { timeframes: matched.length > 0 ? matched : collected, ignored };
}

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.parse(env);
  const timeframes = parsed.TIMEFRAMES.split(',').map((s) => s.trim()).filter(Boolean) as Timeframe[];

  const alertTimeframes = pickAlertTimeframes(parsed.ALERT_TIMEFRAMES, timeframes);

  assertSumsTo100('health', Object.values(HEALTH_WEIGHTS));
  assertSumsTo100('risk', Object.values(RISK_WEIGHTS));

  const config: AppConfig = {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    apiHost: parsed.API_HOST,
    apiBaseUrl: parsed.NEXT_PUBLIC_API_BASE_URL,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramApiRoot: parsed.TELEGRAM_API_ROOT,
    telegramAlertChatIds: parsed.TELEGRAM_ALERT_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    symbols: parsed.SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean),
    futuresOnlySymbols: parsed.FUTURES_ONLY_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean),
    timeframes,
    telegramDefaultTimeframe: pickDefaultTimeframe(parsed.TELEGRAM_DEFAULT_TIMEFRAME, timeframes),
    telegramAlertTest: isEnabledFlag(parsed.TELEGRAM_ALERT_TEST),
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
      priceShockAtrMult: parsed.THRESH_PRICE_SHOCK_ATR_MULT,
      priceShockMinMovePct: parsed.THRESH_PRICE_SHOCK_MIN_MOVE_PCT,
    },
    healthWeights: HEALTH_WEIGHTS,
    riskWeights: RISK_WEIGHTS,
    confidenceWeights: CONFIDENCE_WEIGHTS,
    alert: {
      cooldownMinutes: parsed.ALERT_COOLDOWN_MINUTES,
      confidenceDeltaRetrigger: parsed.ALERT_CONFIDENCE_DELTA_RETRIGGER,
      timeframes: alertTimeframes.timeframes,
      ignoredTimeframes: alertTimeframes.ignored,
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
