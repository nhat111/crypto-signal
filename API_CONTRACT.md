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
