# API Contract (apps/api)

Base URL: `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000` in dev).
All responses are JSON. No auth for MVP (read-only market data).

## `GET /health`
Returns `{ status: 'ok'|'degraded', version, checks }`. HTTP 200 or 503.

`version` carries `commit` (the build serving, short sha, `null` when no
platform variable is set), `commitSource` (which variable it came from),
`startedAt`, `uptimeMs`, and `schema` (`latest` migration filename,
`appliedAt`, `count`). It is deliberately outside `checks` — a missing
commit variable says nothing about health and must never turn the endpoint
red. This is how you confirm a deploy landed; see DEPLOY.md.

`checks` carries `database`, `symbols`, `symbolFreshness` and `collector`.

## `GET /api/status`
Everything needed to answer "is this thing working?" — read by the
dashboard's `/status` page, on demand rather than on a poll, because its
aggregates have no business running on an uptime probe.

```json
{
  "version": { "commit": "ff17908", "commitSource": "RAILWAY_GIT_COMMIT_SHA",
               "startedAt": 0, "uptimeMs": 0,
               "schema": { "latest": "010_job_health.sql", "appliedAt": 0 } },
  "services": [{ "service": "worker", "commit": "aaa1111",
                 "commitSource": "RAILWAY_GIT_COMMIT_SHA", "startedAt": 0 }],
  "collector": [{ "symbol": "BTCUSDT", "lastSnapshotAt": 0, "ageMs": 0 }],
  "outcomes": [{ "horizon": "1h", "resolved": 120, "pending": 8,
                 "resolvableNow": 8, "oldestPendingAt": 0 }],
  "jobs": [{ "jobName": "stablecoin_flow", "lastAttemptAt": 0,
             "lastSuccessAt": null, "consecutiveFailures": 14,
             "lastError": "totalCirculatingUSD: Required" }],
  "worker": { "service": "worker", "lastHeartbeatAt": 0, "ageMs": 12000,
              "connections": { "spot": "open", "futures": "open",
                               "liquidation": "closed" } },
  "serverTime": 0
}
```

`version` is the build of the process answering the request — the api.
`services` is every other service, each writing its own build into the
database at boot, because none of them has an HTTP surface to ask. They are
deployed separately, so a commit here that differs from `version.commit`
means that service has not rolled over yet. An empty array means nothing
has started since this was added.

`worker` is the collector's live state, republished every 60 seconds for
the same reason `services` exists — it has no HTTP surface to ask. It is
`null` until the first heartbeat, which is a cold start rather than a
fault. Read `ageMs` first: past three missed beats the row describes a
process that may no longer exist, so its `connections` must be shown as
unknown rather than as fact. An open socket beside a symbol that has gone
quiet in `collector` puts the fault in the pipeline, not the network —
which is the distinction the whole field exists to make.

Two fields carry most of the diagnostic weight:

- **`outcomes[].resolvableNow`** against `pending`. A backlog being worked
  through and one that can never be priced both look like "lots pending";
  only this separates them. Zero resolvable against a large pending count
  means those signals have no futures 5m candle to price against — usually
  a backfill run without `5m` in `BACKFILL_TIMEFRAMES` — and waiting will
  not fix it.
- **`jobs[].lastSuccessAt: null`** with `consecutiveFailures > 0`. The job
  has never once worked. That is broken, not slow to start.

`collector[].lastSnapshotAt` is `null` when a symbol has never produced a
snapshot, which is a different state from a very old one.

## `GET /api/overview`
```json
{
  "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  "timeframes": ["5m", "15m", "1h", "4h"],
  "rows": [
    {
      "symbol": "BTCUSDT",
      "timeframe": "15m",
      "timestamp": 1700000000000,
      "priceClose": 65000.5,
      "priceChangePct": 0.72,
      "healthScore": 62,
      "healthStatus": "NEUTRAL",
      "riskScore": 81,
      "dataQualityScore": 95
    }
  ]
}
```
`healthStatus` is one of `VERY_HEALTHY | HEALTHY | NEUTRAL | WEAK | VERY_WEAK`.
`rows` has up to `symbols.length * timeframes.length` entries (one per
symbol×timeframe combo that has data so far — may be fewer right after
startup). This single payload backs both the health/risk overview cards
**and** the heatmap grid (group by `timeframe` for the heatmap columns).

## `GET /api/symbols/:symbol?timeframe=15m&limit=200`
`symbol` uppercase e.g. `BTCUSDT`. `timeframe` one of `5m|15m|1h|4h`, default `15m`. `limit` max 1000, default 200 (number of historical points for the charts).
```json
{
  "symbol": "BTCUSDT",
  "timeframe": "15m",
  "latest": {
    "symbol": "BTCUSDT", "timeframe": "15m", "timestamp": 1700000000000,
    "priceClose": 65000.5, "priceChangePct": 0.72,
    "healthScore": 62, "healthStatus": "NEUTRAL", "riskScore": 81, "dataQualityScore": 95,
    "spotCvd": -1800000, "futuresCvd": 4200000,
    "openInterest": 55000, "fundingRatePct": 0.021,
    "liquidationLongUsd": 1200000, "liquidationShortUsd": 300000
  },
  "series": [
    {
      "timestamp": 1700000000000,
      "priceClose": 65000.5,
      "spotCvdCumulative": -1800000,
      "futuresCvdCumulative": 4200000,
      "openInterest": 55000,
      "fundingRatePct": 0.021,
      "liquidationLongUsd": 1200000,
      "liquidationShortUsd": 300000,
      "healthScore": 62,
      "riskScore": 81
    }
  ],
  "signals": [
    {
      "signalId": "uuid",
      "symbol": "BTCUSDT", "timeframe": "15m",
      "signalType": "LEVERAGED_RALLY",
      "severity": "HIGH", "confidence": 78,
      "timestamp": 1700000000000,
      "reasons": ["Price +0.80% (>= 0.3% threshold)", "..."],
      "metrics": { "priceChangePct": 0.8, "spotCvdSkewRatio": -0.21 }
    }
  ],
  "priceLevels": { "upper": 66200.0, "middle": 65100.0, "lower": 64000.0 }
}
```
`series` is ordered oldest→newest, one point per closed candle for that
(symbol, timeframe). `latest` is `null` if there's no data yet (collector
still warming up) — render an empty/loading state, not an error.
`signals` is the most recent 20 signals for this symbol+timeframe (any
type/severity) — use these as chart markers and/or a list under the charts.

`priceLevels` is a 20-period Bollinger Band (2 standard deviations) computed
fresh from the last 20 closed futures candles on this (symbol, timeframe) —
`upper`/`lower` are reference range edges (recent resistance/support-ish
levels), not a buy/sell instruction. `null` until 20 closed candles exist
for that timeframe.

Charts required (spec §18), all sourced from `series`:
1. Price (+ can overlay `signals` as markers)
2. Spot CVD (`spotCvdCumulative`)
3. Futures CVD (`futuresCvdCumulative`)
4. Open Interest (`openInterest`)
5. Funding (`fundingRatePct`)
6. Liquidations (`liquidationLongUsd` vs `liquidationShortUsd`, e.g. stacked/diverging bars)
7. Health (`healthScore`)
8. Risk (`riskScore`)

## `GET /api/signals?symbol=&timeframe=&signalType=&limit=`
All filters optional. Returns `{ signals: [...] }`, same shape as the
`signals` array above but across all symbols/timeframes matching the
filter, most recent first, default limit 50, max 500.

Valid `signalType` values (spec §7/§15, exactly 9):
`LEVERAGED_RALLY | SPOT_CONFIRMED_RALLY | SHORT_COVERING_POSSIBLE | SELLING_ABSORPTION_POSSIBLE | BULLISH_SPOT_DIVERGENCE | LONG_LIQUIDATION | SHORT_LIQUIDATION | LONG_CROWDING | SHORT_CROWDING`

Valid `severity` values: `INFO | LOW | MEDIUM | HIGH | EXTREME`.

## `GET /api/performance?horizon=1h&source=live`
`horizon` one of `15m|1h|4h|24h`, default `1h`.
`source` one of `live|backfill|all`, default `live` — see **Provenance** below.
```json
{
  "horizon": "1h",
  "results": [
    {
      "signalType": "LEVERAGED_RALLY",
      "sampleCount": 382,
      "horizon": "1h",
      "positiveMovePct": 61.0,
      "negativeMovePct": 39.0,
      "medianMovePct": -0.42,
      "sufficientData": true
    }
  ]
}
```
The response also carries a `baseline` — the control every result must be
read against:
```json
{
  "baseline": {
    "horizon": "1h",
    "sampleCount": 34210,
    "positiveMovePct": 51.4,
    "medianMovePct": 0.02,
    "fromMs": 1700000000000,
    "toMs": 1700600000000
  }
}
```
It is what price did over the same horizon starting from an *arbitrary*
moment: every futures 5m candle in the window the recorded outcomes span,
measured the same way signal outcomes are (first candle at or after
T + horizon, 30-minute tolerance). Without it a hit rate is unreadable — a
signal at 55% has no edge if price rose 55% of the time anyway. All fields
are `null`/0 until outcomes exist to bound the window.

### Provenance (`source`)
Every stored row records whether the collector **observed** it (`live`) or
whether it was **replayed** — the signal engine re-run over historical
market data (`backfill`). The two are reported separately by default
because they are not equal evidence:

- Binance publishes **no history for liquidations at all**; they exist only
  from the moment a websocket connected. `LONG_LIQUIDATION` and
  `SHORT_LIQUIDATION` therefore **cannot fire in replayed history**, and a
  count of 0 there means unmeasurable, not "never happened". Replayed
  `futures_metrics` rows store `NULL` liquidation figures, never `0`.
- Open interest history reaches back **30 days**, which bounds how far a
  replay can go for the five rules that read it.
- Replayed signals score a lower `dataQuality`, so their confidence is
  lower than a live signal in the same market state. That is intended.

A replay never overwrites a live row; a live observation does upgrade a
replayed one. Run it with `npm run backfill -w @crypto-signal/worker` locally, or
`node backfill.cjs` inside the deployed worker container (the image ships
bundles, not a workspace). `BACKFILL_DAYS` is the same variable either way; `BACKFILL_SYMBOLS`
and `BACKFILL_TIMEFRAMES` narrow it further. It is a one-shot job, not a scheduled one, and is safe to re-run.

`positiveMovePct`/`negativeMovePct` are percentages of samples that moved
up/down (spec §24 "Positive move: 61%"), NOT the average magnitude.
`medianMovePct` is the median price move in %. **When `sufficientData` is
false (fewer than 30 recorded outcomes), the UI must show "not enough data
yet" instead of the numbers** — spec §24/§12 forbid claiming a signal has
edge without real historical evidence. `sampleCount` may be 0 early on;
render that as "no signals of this type yet", not a chart with a zero bar.

## `GET /api/performance/:signalType?horizon=1h`
Same shape as one entry of `results` above, for a single signal type. 404
if `signalType` isn't one of the 9 valid values.

## Trade journal — `POST /api/journal`, `GET /api/journal`, `PATCH /api/journal/:id`, `DELETE /api/journal/:id`, `GET /api/journal/summary`
A manual log of trades a person actually took — separate from both the
signal engine and the gem scanner, which never write here. `chatId` scopes
entries to whoever logged them (a Telegram chat id, or the fixed string
`"web"` for entries made on the dashboard, which has no login).

`POST /api/journal` body: `{ chatId, symbol, side: "long"|"short", entryPrice, size?, note? }`
→ `{ trade }`, status `open`.

`GET /api/journal?chatId=&status=open|closed&limit=` — all filters
optional; omit `chatId` to get every chat's entries (what the web
dashboard does). Returns `{ trades: [...] }`, most recent first.
```json
{
  "id": "42", "chatId": "web", "symbol": "BTCUSDT", "side": "long",
  "entryPrice": 78000, "exitPrice": 79200, "size": 0.1,
  "pnlPct": 1.54, "pnlUsd": 120,
  "status": "closed", "note": "bullish divergence signal",
  "openedAt": 1700000000000, "closedAt": 1700003600000
}
```
`pnlPct`/`pnlUsd` are `null` until `exitPrice` is set — `pnlUsd` stays
`null` forever if `size` was never given. Both are computed server-side and
stored, not derived on read.

`PATCH /api/journal/:id` body: any subset of `{ symbol, side, entryPrice,
exitPrice, size, note }`. Setting `exitPrice` to a number is how a trade
gets closed (recomputes `pnlPct`/`pnlUsd`, sets `status: "closed"`);
setting it to `null` reopens the trade. 404 if the id doesn't exist.

`DELETE /api/journal/:id` → `{ deleted: true }`, or 404.

`GET /api/journal/summary?chatId=` → aggregate over **closed** trades only:
```json
{
  "openCount": 2, "closedCount": 14, "wins": 9, "losses": 5,
  "winRatePct": 64.3, "totalPnlUsd": 812.40, "avgPnlPct": 3.1
}
```
`winRatePct`/`avgPnlPct` are `null` when `closedCount` is 0, and
`totalPnlUsd` is `null` when no closed trade recorded a `size` — render
those as "—"/"not enough data" rather than a misleading `0%`/`$0.00`, same
rule as `/api/performance`.

## `GET /api/flow`
Macro context: total stablecoin circulating supply and how fast it's
growing, as a proxy for money entering or leaving crypto as a whole.
```json
{
  "stablecoin": {
    "latestUsd": 243100000000,
    "asOfDay": "2026-03-10",
    "change7d": { "changeUsd": 1800000000, "changePct": 0.75, "fromDay": "2026-03-03" },
    "change30d": { "changeUsd": -4200000000, "changePct": -1.70, "fromDay": "2026-02-08" }
  }
}
```
The response also carries `fetch` — whether the refresh behind those
numbers is actually working:
```json
{
  "fetch": {
    "lastAttemptAt": 1788017553473,
    "lastSuccessAt": null,
    "consecutiveFailures": 14,
    "lastError": "totalCirculatingUSD: Required"
  }
}
```
`stablecoin: null` on its own cannot say **why** it is empty, and the two
reasons are not remotely the same problem:

- `fetch: null` — the job has never run. Genuinely a fresh start.
- `lastSuccessAt: null` with `consecutiveFailures > 0` — it has run and
  **never once succeeded**. This is broken, not early, and the UI says so
  in those words rather than showing the reassuring "no data yet".
- `consecutiveFailures > 0` while `stablecoin` is present — the reading is
  real but going stale, which otherwise looks identical to a live one.

One or two failures after a good run is an upstream hiccup; the dashboard
only raises it from three in a row. `lastError` is truncated to 500 chars.

`stablecoin` is `null` until the worker's first refresh lands; each window
is `null` when history doesn't reach back far enough — render "no data yet"
rather than a zeroed reading, same rule as `/api/performance`.

`fromDay` is the day actually compared against, which is rarely exactly N
days back (the upstream series has gaps), so the UI can state what the
number really covers. `asOfDay` is the most recent data point — this is
**daily data and lags the market**.

Source is DefiLlama, refreshed a few times a day by the worker. It says
nothing about *which* asset the money buys, so it is context only — never
render it as trend confirmation or as a signal.

## Notes for the web app
- This API is the **only** thing apps/web talks to — never Binance, never
  Postgres directly (rule: "Không để Telegram/web gọi trực tiếp Binance",
  "Collector là source duy nhất cho market data").
- Poll `/api/overview` and the active symbol's `/api/symbols/:symbol` on an
  interval (e.g. every 15-30s) for a "live-ish" feel — there's no
  WebSocket/SSE from the API in this MVP.
- Color is UI-only (spec §19 "Màu chỉ dùng ở UI để biểu thị trạng thái.
  Không dùng màu để tính toán.") — never derive a number from a color or
  vice versa in application logic.
