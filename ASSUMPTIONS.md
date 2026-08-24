# ASSUMPTIONS.md

This file records every assumption made while implementing the Market Health
Monitor spec (`crypto_market_health_monitor_spec.md`). Read this before
trusting any number the app produces — it explains where the app is precise
(backed by an exchange field) and where it is a deliberate, documented
approximation.

## 1. Binance API verification (Phase 0 findings)

Verified via Binance public API docs / connector source before writing any
collector code. Nothing below is guessed.

| Need | Endpoint | Verified fact |
|---|---|---|
| Spot OHLCV | `GET /api/v3/klines` | Response array per candle: `[openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, numberOfTrades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]`. |
| Futures OHLCV | `GET /fapi/v1/klines` | Same 12-field shape as spot. |
| Spot/Futures taker buy volume | Same kline endpoints, field index 9/10 | Binance computes this itself from the tape; we do **not** derive it from candle color or reconstruct it from `aggTrades`. |
| Spot/Futures kline WS | `wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>` / `wss://fstream.binance.com/ws/<symbol>@kline_<interval>` | Payload's `k` object carries `V` (taker buy base volume), `Q` (taker buy quote volume), `x` (is this kline closed). We only act on `x === true`. |
| Futures Open Interest history | `GET /futures/data/openInterestHist` | `period` ∈ {5m,15m,30m,1h,2h,4h,6h,12h,1d} — **covers all four of our timeframes exactly**. `limit` default 30 / max 500. **Only the last 30 days are available** — this bounds how far back we can backfill OI on a cold start. |
| Futures current Open Interest | `GET /fapi/v1/openInterest` | Single latest snapshot, used only for the live "current OI" display, not for history. |
| Futures Funding Rate history | `GET /fapi/v1/fundingRate` | `limit` max 1000 per call; paginate with `startTime`/`endTime` for older history. |
| Futures current funding + mark price | `GET /fapi/v1/premiumIndex` | Returns `markPrice`, `indexPrice`, `lastFundingRate`, `nextFundingTime`. Polled on an interval; funding itself only *settles* every 8h, so the value is carried forward between settlements. |
| Futures liquidations | WS `<symbol>@forceOrder` / `!forceOrder@arr` | **Real-time only.** Confirmed there is no market-wide historical REST endpoint — `/fapi/v1/forceOrders` (account-scoped, requires API key) returns only the caller's own orders, not market liquidations. **We cannot backfill liquidation history on startup; the liquidation table only fills from the moment the collector first connects.** This is a hard exchange limitation, not a shortcut we took — see TODO.md. |
| Basis | Not a single field | Computed as `futuresClose - spotClose` from the two kline streams at matching candle close, not from a dedicated Binance "basis" endpoint (none exists for this pairing). |

## 2. CVD definition

The spec explicitly forbids `green candle = buy`. We use Binance's own
taker-buy-volume field from the kline response, which reflects real
aggressor-side trade classification (`isBuyerMaker` aggregated by Binance),
not candle color:

```
delta(candle) = takerBuyVolume - takerSellVolume
              = takerBuyVolume - (volume - takerBuyVolume)
              = 2*takerBuyVolume - volume
CVD(t) = CVD(t-1) + delta(t)
```

Spot and Futures CVD are stored and charted as **separate series**, never
merged, per spec section 6.

**Assumption:** for the *signal engine's* threshold comparisons we don't use
the raw delta (which scales with a symbol's absolute volume and would need a
different threshold per symbol/timeframe). We normalize it into a
**buy-skew ratio** `delta / volume ∈ [-1, 1]` and threshold that instead. The
raw cumulative CVD (unnormalized) is still what gets stored and charted,
matching the spec's dashboard mockup (`Spot CVD ▼ -1.8M`).

## 3. Timeframe candle source

We do not run a separate 1m aggregator. Each of the four required timeframes
(5m/15m/1h/4h) is collected as its **own native Binance kline stream**
(`@kline_5m`, `@kline_15m`, `@kline_1h`, `@kline_4h`), so a "5m candle" and a
"1h candle" both come directly from Binance's own bucketing, not from us
re-aggregating 1m bars. This avoids a whole class of aggregation-boundary
bugs at the cost of 4x the kline subscriptions per symbol/market — an
acceptable trade for MVP correctness.

## 4. Funding rate applied per timeframe row

Funding only *settles* every 8h (funding interval is itself configurable per
symbol on Binance, but 8h is the default/common case). For 5m/15m/1h rows we
store the **latest known funding rate at that timestamp** (carried forward
from the last settlement/poll), not a value that changes every candle. This
matches how the spec's dashboard mock shows a single funding value per
timeframe row.

## 5. Open Interest change basis

"OI change %" is computed against the **previous closed bucket of the same
timeframe** returned by `openInterestHist` (e.g., 15m OI change = this 15m
bucket vs the prior 15m bucket), not against a fixed rolling window.

## 6. Liquidation anomaly baseline

Spec section 10 wants `current_liquidation / rolling_average_24h`. Because
liquidation history cannot be backfilled (see §1), the rolling 24h average is
only meaningful after the collector has been running for 24h. **Assumption:**
until 24h of same-process liquidation data exists, liquidation anomaly is
reported as `DATA_QUALITY = LOW` and excluded from confidence-boosting —
never fabricated from a shorter window pretending to be 24h.

## 7. Health score & Leverage Risk score formulas

The spec gives an explicit **Health Score** weight table (§13) but does
**not** give a Risk Score formula — it only says the two scores must be
independent (§14). We designed the Risk Score weighting ourselves, using the
same "component 0-100, weighted sum" pattern as Health, built from: funding
extremity, OI velocity, basis extremity, liquidation anomaly, volume
extremity, and active crowding signals. Both weight tables live in
`packages/health-engine/src/weights.ts` and are overridable via env vars —
nothing is hard-coded in the scoring logic itself.

## 8. Confidence formula historical_score term

Spec §30: `confidence = 0.25*data_quality + 0.30*confirmation + 0.25*magnitude + 0.20*historical`.
`historical_score` requires backtest evidence (Phase 9) per signal type.
**Assumption:** until a signal type has ≥30 recorded outcomes with a known
`price_after_1h`, `historical_score` defaults to a neutral `50`, and the
signal's `reasons[]` array says so explicitly (e.g. "Historical performance:
not yet enough data (12/30 samples)") rather than silently presenting a
possibly-misleading number.

## 9. Signal rule thresholds

All numeric thresholds referenced in the spec (funding elevated/extreme,
volume anomaly multipliers, OI change %, price change %, liquidation spike
multiplier) are implemented as configurable values in
`packages/shared/src/config.ts`, seeded with the exact example numbers given
in the spec where the spec gives one (funding ±0.01%/±0.03%, volume 1.5x/2x/3x),
and with our own reasonable defaults where the spec only says "threshold
configurable" without a number (price change, spot/futures CVD skew, OI
change). These are documented inline in that file, not buried.

## 10. Data quality → confidence

Per spec §29/§30, a signal cannot get high confidence off incomplete data.
Our data-quality score per `(symbol, timeframe)` combination degrades when:
the WS collector has been disconnected/reconnecting recently, a kline gap is
detected (missing expected bucket), or a required indicator input (OI /
funding / liquidation) is stale beyond its expected refresh interval. This
score directly feeds the confidence formula's `data_quality` term (§8 above).

## 11. Exchange abstraction

Spec asks for an abstraction layer "for later Bybit/OKX". We defined a
minimal `ExchangeAdapter` interface in `packages/market-data/src/types.ts`
with only the methods the pipeline actually calls today (kline stream
subscribe, OI history, funding history, liquidation stream). We did **not**
build a full multi-exchange plugin system now (rule 14: don't over-engineer)
— only Binance is implemented; the interface exists so a second exchange is
additive, not a rewrite.

## 12. Redis usage

Used narrowly as a **latest-snapshot cache** (`ioredis`), written by the
worker after each pipeline pass and read by the API for low-latency
dashboard/bot reads. Postgres remains the source of truth for everything
historical (candles, metrics, signals, outcomes). We did not implement
Redis pub/sub or streams — not needed for MVP polling-frequency freshness.

## 13. "Không lưu mọi tick" (retention)

We never persist raw trades/aggTrades at all (we don't need them — see §2,
we get taker volume from klines directly). What we persist is one row per
`(symbol, market, timeframe, candle open time)` for candles/metrics — i.e.
already aggregated at the timeframe level, satisfying the "aggregate by
1m/5m/15m/1h/4h" instruction without a separate raw tick table.

## 14. AI layer (spec §32)

Not implemented in this MVP pass — explicitly marked optional in the spec
and last in the build order ("AI last"). `TODO.md` tracks it. The
architecture already isolates it correctly: an AI summarizer would sit
strictly downstream of the signal engine's JSON output and would only ever
receive already-computed deterministic numbers, never produce them.

## 15. Futures-only symbols (no Binance Spot listing — e.g. HYPEUSDT)

Some symbols (confirmed for HYPEUSDT at time of writing, via
`https://www.binance.com/en/futures/hypeusdt`) trade on Binance USDⓈ-M
Futures but have no Binance Spot listing. The spec's whole methodology is
built on comparing Spot vs Futures — without a Spot leg that comparison is
simply impossible, not something to approximate.

Added via the `FUTURES_ONLY_SYMBOLS` env var (disjoint from `SYMBOLS`),
these symbols get a **reduced** feature set rather than being silently
skipped or silently faked:

- **Available**: price, Futures CVD, OI (level/change/velocity), funding,
  liquidations, volatility, and the 5 signals that don't need Spot data
  (`SHORT_COVERING_POSSIBLE`, `LONG_LIQUIDATION`, `SHORT_LIQUIDATION`,
  `LONG_CROWDING`, `SHORT_CROWDING`) — verified none of these rules read
  `snapshot.spot` anywhere in `packages/signal-engine`.
- **Unavailable, reported as `null`/absent rather than guessed**: Spot CVD,
  basis (needs both a spot and futures close price), Health Score (spec
  §13's entire premise is spot-confirmed vs leverage-driven, which is
  unanswerable without spot), and the 4 spot-dependent signals
  (`LEVERAGED_RALLY`, `SPOT_CONFIRMED_RALLY`, `BULLISH_SPOT_DIVERGENCE`,
  `SELLING_ABSORPTION_POSSIBLE`).
- **Still fully computed**: Leverage Risk Score — it never depended on spot
  data in the first place (`packages/health-engine/src/riskScore.ts` has no
  `snapshot.spot` reference).

Mechanically: `MarketSnapshot.spot` is `SpotSnapshot | null`
(`packages/indicators/src/types.ts`); `computeFuturesOnlySnapshot` builds a
snapshot with `spot: null` and `basisPct/basisAbsolute` at `0` (not derived,
since there's no spot price to derive it from); every spot-dependent
signal rule starts with `if (!s.spot) return null;`; `computeHealth`
returns `null` when `snapshot.spot` is `null`; the worker never subscribes
these symbols on the Spot WebSocket at all (avoids the real operational
risk that one invalid stream name in a combined-stream subscription could
reject the whole connection, taking BTC/ETH/SOL spot data down with it) and
routes their futures candles straight to `processFuturesOnlyCandle`,
bypassing the spot/futures candle-pairing buffer entirely since there's
nothing to pair.
