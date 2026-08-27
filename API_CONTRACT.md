# API Contract (apps/api)

Base URL: `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000` in dev).
All responses are JSON. No auth for MVP (read-only market data).

## `GET /health`
Returns `{ status: 'ok'|'degraded', checks: { database, collector } }`. HTTP 200 or 503.

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

## `GET /api/performance?horizon=1h`
`horizon` one of `15m|1h|4h|24h`, default `1h`.
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
