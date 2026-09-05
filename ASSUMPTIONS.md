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

## 16. Small-cap discovery scanner ("hidden gems")

A second, opt-in product in the same codebase (`GEM_SCAN_ENABLED`). It
shares infrastructure with the market-health monitor — worker, database,
API, bot, web — and its discipline, but none of its data model: these
tokens trade only on DEXes, so there is no funding, no open interest, and
no spot-vs-futures divergence to compute.

### Data sources, and what could not be verified

| Need | Source | Status |
|---|---|---|
| Pair data (liquidity, volume, txn counts, price change, pool age) | DexScreener REST (`/tokens/v1/{chainId}/{addresses}`, documented cap 30 addresses/call) | **Not verified live.** The build environment's egress proxy blocks `api.dexscreener.com`, so endpoint paths and field names come from public documentation only. |
| Candidate discovery | DexScreener `/token-profiles/latest/v1`, `/token-boosts/latest/v1`; GeckoTerminal `/networks/{network}/pools` | Same — documented, not probed. |
| Solana token safety | RugCheck `/v1/tokens/{mint}/report` | Same. Documented to accept a per-developer `X-API-KEY`. |

Because none of it could be probed, **every response is validated against a
zod schema at the boundary** (`sources/http.ts`). A changed or misremembered
field name raises `UpstreamShapeError` with the actual payload logged,
rather than silently scoring `undefined`. A scanner quietly ranking tokens
on garbage numbers would be far worse than one that refuses to run.

### The sampling limitation (important)

DexScreener's public API has **no endpoint that lists or filters every pair
on a chain** — the website's screener filters aren't exposed. Discovery is
therefore candidate-feed + enrichment, and each feed is a biased sample:

- Profile/boost feeds list tokens whose teams **paid for marketing** — a
  self-selecting slice.
- GeckoTerminal top-pools is **volume-ranked**, which misses quiet tokens.

So the scanner sees *a sample of the chain, never all of it*. It cannot
claim to have found "the best" small cap, only the best among what it
looked at. Scan results record how many candidates each feed produced so
that coverage stays visible rather than implied.

### Scoring

Two independent 0-100 scores, mirroring Health vs Leverage Risk on the
market-health side and never blended into one number:

- **Gem Score** — liquidity quality (25), volume conviction (25), buy
  pressure (20), survival/age (20), momentum structure (10).
- **Risk Score** — safety (35), concentration (20), liquidity fragility
  (20), age risk (10), pump exhaustion (15).

Weights and every threshold live in `packages/gem-scanner/src/config.ts`
and are env-overridable, same rule as the rest of the project. **They are
starting points, not tuned values** — nothing here has been validated
against recorded outcomes yet.

Buy pressure uses DexScreener's counted buy/sell **transaction counts** —
real per-side trade data, consistent with the project's rule against
inferring flow from candle color. It counts transactions, not size, so many
tiny buys can skew it; it is one component of five, weighted accordingly.

### Safety is a gate, not a weight

- A `danger` verdict **disqualifies outright**, regardless of how good the
  market data looks.
- A screen that could not run reports `unknown`, **never `safe`**.
- Individual checks are `null` when unreported, never `false`: "we couldn't
  read whether the mint authority is revoked" and "the mint authority is
  NOT revoked" mean opposite things to a buyer.
- Chains with no safety source (i.e. anything that isn't Solana today) get
  no screen at all — surfaced as "no screen", scored as unverified.

### Outcome tracking

`gem_outcomes` records price at +24h and +7d, plus **liquidity at +7d**,
for the scans the scanner actually *called* (score ≥ alert threshold) — not
every routine rescan, which would flood the sample with duplicates. The
liquidity figure exists because "how often did this point at something
whose liquidity then vanished" is the number that matters most here, and an
average return would hide exactly that. The performance surface reports
"not enough data yet" below 20 recorded outcomes rather than quoting a win
rate off a handful of samples.

### Known limitations

- Solana only for safety screening. HyperEVM pair data is available through
  DexScreener (chain id `hyperevm`), but no EVM safety source is wired up,
  so those tokens would be surfaced unverified — which is why only
  `solana` is enabled by default.
- No honeypot simulation (would need a GoPlus-style EVM source).
- No holder-growth or social signals.
- Token names and symbols come from on-chain metadata that anyone can set;
  they are HTML-escaped before display but are not otherwise trustworthy.

### The control group (added later)

`gem_outcomes` answers "when the scanner called something, what happened",
and the score bands answer "did a higher score precede a better outcome".
Neither can answer the question the money depends on — **was passing the
filter worth anything at all** — because every row in both went through
the same filter. A hit rate with no control is the one thing this codebase
refuses to publish, and the gem page was publishing one.

So each scan keeps a bounded random sample (5) of the candidates it
**rejected** and prices them over the same horizons, from the same source,
against the same 3% round-trip cost floor. `gem_baseline_candidates` holds
both the observation and its outcome; there is no "did the scanner call
this one" question to answer for a control, so there is nothing for a
second table to hold.

**Only some rejections qualify**, and picking the wrong ones would flatter
the scanner rather than test it:

- `liquidity_too_low` / `volume_too_low` — a pool nobody trades. Its
  printed move is an artefact you could not have transacted at, so
  counting it as the alternative is fiction.
- `missing_*_data` — unreadable then, unpriceable honestly now.
- Anything the safety screen rejected never reaches the list at all:
  screening runs only after the market gate passes, and "you could have
  bought the rug instead" is not a comparison worth making.

What remains is tokens that were simply the wrong **profile** — too big,
too new, or already pumped — each of which was something a person could
genuinely have bought that day. The sample is random rather than the first
N, because candidates arrive in discovery order and that order correlates
with volume and recency on every feed we read; taking the head would
quietly build a control group of the biggest, newest rejects.

`failureCounts` is reported alongside, so a "market baseline" that turned
out to be entirely already-pumped tokens is visible rather than implied.

### Agresti-Caffo, and the hole it closed

The two-proportion margin used to be a plain Wald interval, which has a
hole at exactly the values this system produces early on: at 0% or 100%
the variance term for that arm is **zero**, so a *single* observation that
happened to go the right way produced a 9,8pp margin against a 50pp gap
and the page said "beats" — a rule against claiming edge without evidence,
defeated by having almost none.

One notional win and one notional loss are now added to each arm before
the variance is computed, and the verdict is decided on the correspondingly
shrunk difference (the raw difference is still what gets *reported* — that
is what actually happened). On production sample sizes this changes
nothing: 1,081pp against 1,081pp on the real signal counts. On thin ones it
refuses, which is the only direction worth erring in here.

`samplesNeeded` walks up from the closed-form estimate to the smallest
count that actually produces a verdict, rather than inverting the adjusted
formula in closed form — a function that promises a sample size which then
fails to deliver one is worse than a function that promises nothing.

## 17. Price-shock signals (`PRICE_SPIKE_UP` / `PRICE_SPIKE_DOWN`)

Not from the spec. Added because every other rule describes *structure* —
who is buying, with whose money, against what positioning — and none of
them answers the question a holder asks first: did the price just do
something violent? A large candle can pass every structural filter and
still be the only thing worth being woken up for.

**"Abnormal" is measured against the symbol's own recent range, not a
fixed percentage.** A fixed percentage is wrong for everything: 3% is a
crash for BTC on a quiet week and a rounding error for a small cap in a
bull run. The comparison is `|changePct| / baselineAtrPct`, where the
baseline is the mean true range of the **14 candles before this one**.

Three choices in there are deliberate and each has a test:

- **The baseline excludes the candle being judged.** `price.atrPct`
  includes it, which is right for describing a market and wrong for
  detecting a shock: a candle that moves five times the usual amount
  inflates its own denominator, so the biggest moves would be the ones
  that quietly stop qualifying.
- **No baseline means no signal, not a signal against zero.**
  `baselineAtrPct` is `null` below ten prior candles, and null below any
  movement at all. Read as 0 it would make every tick infinitely
  abnormal — an alert storm on every cold start, which is how a channel
  gets muted.
- **Up and down are separate types.** Their follow-through is different,
  and blending them would produce one hit rate that averages the two into
  a meaningless coin flip on `/performance`.

Defaults: `THRESH_PRICE_SHOCK_ATR_MULT=3` (severity escalates at 1,5× and
2× that) and `THRESH_PRICE_SHOCK_MIN_MOVE_PCT=1`, an absolute floor so a
flat market cannot manufacture a shock out of noise. Both are guesses at
"rare enough to be worth reading", not measured thresholds — the
`/performance` tab is what will eventually say whether either number is
right, and until it has 30 recorded outcomes per type it will say so.
