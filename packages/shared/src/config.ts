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
  // The web dashboard's public URL (e.g. https://trackingticker.vercel.app).
  // Optional: when set, /lookup ends with a link to the same lookup on the
  // web, where it has a chart. Unset, the bot simply sends no link.
  WEB_BASE_URL: z.string().default(''),
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
  // One morning message per day after the 1D close. On unless set to off/0/false.
  DAILY_DIGEST: z.string().default('on'),
  // Telegram message when a pullback / breakout-retest setup forms on 4H. On unless off/0/false.
  SETUP_ALERTS: z.string().default('off'),
  // The wide, REST-only read of the most-traded coins (/coins). On unless off/0/false.
  COIN_SCAN: z.string().default('on'),
  // How many coins it reads, by 24h spot volume. Each costs three REST requests a day.
  COIN_SCAN_TOP_N: numeric(30),
  // Exchanges whose daily OI is added to the scan's own (Binance or OKX), comma-separated: bybit, gate. Empty = own exchange only.
  COIN_SCAN_OI_VENUES: z.string().default('bybit,gate'),
  // 4H setups on the scanned coins (watchlist alerted, the rest kept as the baseline). On unless off/0/false; needs COIN_SCAN.
  COIN_SETUPS: z.string().default('on'),
  // How many scanned coins make the daily watchlist whose setups are alerted.
  COIN_WATCHLIST_SIZE: numeric(6),
  // Airdrop research list (/airdrops): tokenless protocols from DefiLlama. On unless off/0/false.
  AIRDROP_SCAN: z.string().default('on'),
  // Smallest TVL a candidate needs, in USD.
  AIRDROP_MIN_TVL_USD: numeric(10_000_000),
  // Candidates kept per day, largest TVL first.
  AIRDROP_MAX_CANDIDATES: numeric(150),
  // Sector read (/sectors): CoinGecko categories against BTC, once a day. On unless off/0/false.
  SECTOR_SCAN: z.string().default('on'),
  // Daily spot breakout list (/breakouts): 20-day high while BTC is up, paper-tracked. On unless off/0/false.
  SPOT_BREAKOUTS: z.string().default('on'),
  // Spot pairs read, comma-separated. Empty = the replayed list (DEFAULT_BREAKOUT_SYMBOLS).
  SPOT_BREAKOUT_SYMBOLS: z.string().default(''),
  // CoinGecko category ids, comma-separated. Empty = the default list (DEFAULT_SECTOR_CATEGORIES).
  SECTOR_CATEGORIES: z.string().default(''),
  // Largest coins read per category.
  SECTOR_COINS_PER_CATEGORY: numeric(30),
  // Optional free CoinGecko "demo" key; without it the public limit applies (a few calls a minute).
  COINGECKO_API_KEY: z.string().default(''),
  // Flywheel list (/flywheel): DefiLlama holders revenue, once a day. On unless off/0/false.
  FLYWHEEL_SCAN: z.string().default('on'),
  // Smallest 30-day payout to holders, in USD.
  FLYWHEEL_MIN_HOLDERS_REVENUE_30D: numeric(100_000),

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

  // Binance's market-data-only host. The spot adapter only ever reads
  // /api/v3/klines, which it serves identically, and it answered when
  // api.binance.com was refusing the server's IP — a Lookup then called
  // NEARUSDT unlisted. Futures has no such host, so fapi stays as it is.
  BINANCE_SPOT_REST_BASE: z.string().default('https://data-api.binance.vision'),
  BINANCE_SPOT_WS_BASE: z.string().default('wss://stream.binance.com:9443'),
  BINANCE_FUTURES_REST_BASE: z.string().default('https://fapi.binance.com'),
  // Market streams (klines, forceOrder) moved under /market. The bare host
  // still accepts the connection and then sends nothing — the socket reads
  // "open" on /status while no futures candle ever arrives.
  BINANCE_FUTURES_WS_BASE: z.string().default('wss://fstream.binance.com/market'),

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

/**
 * The wide coin scan's labels. Every number here is a first guess, not a
 * finding. The taker skew is the one with a measurement behind it: over
 * 30-day windows ten majors drifted between −3.1% and +1.0% (2026-10,
 * Binance spot), and a few percent is already a strong lean once a week of
 * candles is summed (a single 5m candle needs 15% — THRESH_CVD_SKEW_RATIO).
 * So 3% sits at the edge of ordinary drift. Funding is judged against
 * Binance's own 0.01%/8h baseline rather than against zero. Recorded per
 * day in coin_scan_rows so the labels can be judged against what price
 * did next, the same way signals are.
 */
export interface CoinScanThresholds {
  /** |7d return| at or above this is a move; below it, price is flat. */
  priceMovePct: number;
  /** 7d spot taker skew, (buy − sell) / total quote volume, that counts as net buying (or, negated, net selling). */
  takerSkew: number;
  /** 7d change in open interest, in contracts (not dollars, so price alone cannot move it), that counts as leverage building. */
  oiRisePct: number;
  /** Same, falling — positions closing. Negative. */
  oiFallPct: number;
  /** Average funding per 8h over 7d, in percent, that counts as longs paying up. */
  fundingElevatedPct: number;
  /** Same average at or below this (negative) counts as shorts paying: new open interest into a rise is then mostly shorts. */
  fundingShortsPayPct: number;
}

/**
 * The default sectors: the ones a narrative trade usually rotates through,
 * plus the three the "highest valued" argument names (chains, exchange
 * tokens, and stablecoin issuers, read here through DeFi/RWA since
 * stablecoins themselves do not move). CoinGecko category ids, verified
 * against /coins/categories/list (2026-10).
 */
export const DEFAULT_SECTOR_CATEGORIES = [
  'layer-1',
  'layer-2',
  'artificial-intelligence',
  'ai-agents',
  'meme-token',
  'solana-meme-coins',
  'decentralized-exchange',
  'decentralized-perpetuals',
  'lending-borrowing',
  'liquid-staking-governance-tokens',
  'real-world-assets-rwa',
  'depin',
  'gaming',
  'privacy-coins',
  'oracle',
  'prediction-markets',
  'exchange-based-tokens',
  'launchpad',
  'zero-knowledge-zk',
  'hyperliquid-ecosystem',
] as const;

export interface SpotBreakoutConfig {
  enabled: boolean;
  symbols: string[];
}

/**
 * The 41 OKX spot pairs the breakout rule was replayed on (ASSUMPTIONS
 * §27). The live record is only comparable with the replay on the same
 * kind of coins: liquid, long-listed majors. All are today's survivors,
 * which flatters the replay a little.
 */
export const DEFAULT_BREAKOUT_SYMBOLS: readonly string[] = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'TRX', 'LINK', 'AVAX', 'DOT', 'LTC', 'BCH', 'ETC',
  'NEAR', 'SUI', 'APT', 'ARB', 'OP', 'INJ', 'TIA', 'SEI', 'ATOM', 'AAVE', 'UNI', 'FIL', 'HBAR', 'RENDER',
  'FET', 'WLD', 'ENA', 'ICP', 'STX', 'ONDO', 'JUP', 'PYTH', 'LDO', 'CRV', 'GALA', 'POL', 'ALGO',
].map((s) => `${s}USDT`);

export function parseBreakoutSymbols(raw: string): string[] {
  const picked = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
    .map((s) => (s.endsWith('USDT') ? s : `${s}USDT`))
    .slice(0, 100);
  return picked.length > 0 ? picked : [...DEFAULT_BREAKOUT_SYMBOLS];
}

export interface SectorScanConfig {
  enabled: boolean;
  categories: string[];
  coinsPerCategory: number;
  coingeckoApiKey: string;
}

export interface FlywheelConfig {
  enabled: boolean;
  minHoldersRevenue30dUsd: number;
  maxRows: number;
}

export interface AirdropScanConfig {
  enabled: boolean;
  minTvlUsd: number;
  maxCandidates: number;
}

export interface CoinScanConfig {
  enabled: boolean;
  topN: number;
  thresholds: CoinScanThresholds;
  /** Run the 4H setup detector over the scanned coins. Off when the scan is. */
  setups: boolean;
  /** Coins on the daily watchlist; their setups are the ones alerted. */
  watchlistSize: number;
  /** Extra venues summed into the 7-day OI change (`bybit`, `gate`); the scan's own exchange is always in. */
  oiVenues: CoinScanOiVenue[];
  /** The intraday exit check on held and ⭐ coins (ASSUMPTIONS §22). */
  intraday: CoinWatchIntradayThresholds;
}

/** Moves since the last daily close, in percent. Under a day, so smaller than the scan's seven-day ones. */
export interface CoinWatchIntradayThresholds {
  priceMovePct: number;
  oiChangePct: number;
}

const COIN_WATCH_INTRADAY: CoinWatchIntradayThresholds = { priceMovePct: 3, oiChangePct: 5 };

export const COIN_SCAN_OI_VENUES = ['bybit', 'gate'] as const;
export type CoinScanOiVenue = (typeof COIN_SCAN_OI_VENUES)[number];

/** Unknown names are dropped rather than failing startup: a typo costs one venue, not the worker. */
export function parseOiVenues(raw: string): CoinScanOiVenue[] {
  const wanted = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
  return COIN_SCAN_OI_VENUES.filter((v) => wanted.has(v));
}

const COIN_SCAN_THRESHOLDS: CoinScanThresholds = {
  priceMovePct: 3,
  takerSkew: 0.03,
  oiRisePct: 10,
  oiFallPct: -10,
  fundingElevatedPct: 0.03,
  fundingShortsPayPct: -0.005,
};

export interface AppConfig {
  databaseUrl: string;
  apiPort: number;
  apiHost: string;
  apiBaseUrl: string;
  telegramBotToken: string;
  /** Public web dashboard URL without a trailing slash, or '' when unset. */
  webBaseUrl: string;
  telegramApiRoot: string;
  telegramDefaultTimeframe: Timeframe;
  telegramAlertTest: boolean;
  /** The once-a-day summary after the daily close. On by default; DAILY_DIGEST=off disables it. */
  dailyDigest: boolean;
  /**
   * Push a message when a 4H entry setup forms. Off by default since the
   * 18-month replay (ASSUMPTIONS §21) found no edge; setups are still
   * recorded and scored. SETUP_ALERTS=on turns the push back on.
   */
  setupAlerts: boolean;
  telegramAlertChatIds: string[];
  coinScan: CoinScanConfig;
  airdrop: AirdropScanConfig;
  sectors: SectorScanConfig;
  spotBreakouts: SpotBreakoutConfig;
  flywheel: FlywheelConfig;
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
/** Lowercased, deduplicated, at most 40 (each is one request a day); empty means the default list. */
export function parseSectorCategories(raw: string): string[] {
  const ids = [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 40);
  return ids.length > 0 ? ids : [...DEFAULT_SECTOR_CATEGORIES];
}

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
    webBaseUrl: parsed.WEB_BASE_URL.trim().replace(/\/+$/, ''),
    telegramApiRoot: parsed.TELEGRAM_API_ROOT,
    telegramAlertChatIds: parsed.TELEGRAM_ALERT_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    coinScan: {
      enabled: isEnabledFlag(parsed.COIN_SCAN),
      // Clamped: 0 would read as "the scan found nothing", and a few hundred
      // is a few hundred REST calls into an IP that shares its ban with others.
      topN: Math.min(100, Math.max(5, Math.round(parsed.COIN_SCAN_TOP_N) || 30)),
      thresholds: COIN_SCAN_THRESHOLDS,
      setups: isEnabledFlag(parsed.COIN_SCAN) && isEnabledFlag(parsed.COIN_SETUPS),
      watchlistSize: Math.min(20, Math.max(0, Math.round(parsed.COIN_WATCHLIST_SIZE))),
      oiVenues: parseOiVenues(parsed.COIN_SCAN_OI_VENUES),
      intraday: COIN_WATCH_INTRADAY,
    },
    airdrop: {
      enabled: isEnabledFlag(parsed.AIRDROP_SCAN),
      minTvlUsd: Math.max(0, parsed.AIRDROP_MIN_TVL_USD),
      // Clamped: each row is stored once a day and kept 120 days.
      maxCandidates: Math.min(500, Math.max(10, Math.round(parsed.AIRDROP_MAX_CANDIDATES) || 150)),
    },
    sectors: {
      enabled: isEnabledFlag(parsed.SECTOR_SCAN),
      categories: parseSectorCategories(parsed.SECTOR_CATEGORIES),
      // Clamped: 250 is CoinGecko's page size, and under 10 a median says little.
      coinsPerCategory: Math.min(100, Math.max(10, Math.round(parsed.SECTOR_COINS_PER_CATEGORY) || 30)),
      coingeckoApiKey: parsed.COINGECKO_API_KEY.trim(),
    },
    spotBreakouts: {
      enabled: isEnabledFlag(parsed.SPOT_BREAKOUTS),
      symbols: parseBreakoutSymbols(parsed.SPOT_BREAKOUT_SYMBOLS),
    },
    flywheel: {
      enabled: isEnabledFlag(parsed.FLYWHEEL_SCAN),
      minHoldersRevenue30dUsd: Math.max(0, parsed.FLYWHEEL_MIN_HOLDERS_REVENUE_30D),
      maxRows: 100,
    },
    symbols: parsed.SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean),
    futuresOnlySymbols: parsed.FUTURES_ONLY_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean),
    timeframes,
    telegramDefaultTimeframe: pickDefaultTimeframe(parsed.TELEGRAM_DEFAULT_TIMEFRAME, timeframes),
    telegramAlertTest: isEnabledFlag(parsed.TELEGRAM_ALERT_TEST),
    dailyDigest: !['off', '0', 'false', 'no'].includes(parsed.DAILY_DIGEST.trim().toLowerCase()),
    setupAlerts: ['on', '1', 'true', 'yes'].includes(parsed.SETUP_ALERTS.trim().toLowerCase()),
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
