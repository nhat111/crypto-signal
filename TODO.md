# TODO.md

Tracks work by phase, matching the spec's own `Development Order` (§35).
Check items as they land; each phase's commit message references the phase.

## Phase 0 — Review
- [x] Read full spec.
- [x] Verify Binance endpoints (klines taker-volume, openInterestHist,
      fundingRate, forceOrder) against docs before coding.
- [x] `ASSUMPTIONS.md`.
- [x] `TODO.md` (this file).

## Phase 1 — Skeleton
- [x] npm workspaces monorepo (`packages/*`, `apps/*`).
- [x] Shared TS config (strict), lint, base package.

## Phase 2 — Binance Spot collector
- [x] REST client: klines, backfill.
- [x] WS kline stream client with reconnect/backoff.

## Phase 3 — Binance Futures collector
- [x] REST client: klines, openInterestHist, fundingRate, premiumIndex.
- [x] WS kline stream + forceOrder liquidation stream.

## Phase 4 — Normalizer
- [x] Convert raw REST/WS payloads into typed domain candles/events, all UTC.
- [x] Duplicate detection (same candle open-time re-delivered).
- [x] Out-of-order handling (event with older close time than last processed).
- [x] Gap/missing-data detection feeding data-quality score.

## Phase 5 — CVD
- [x] Spot CVD (cumulative + per-candle delta ratio).
- [x] Futures CVD (kept separate from spot).

## Phase 6 — OI + funding + liquidation
- [x] OI level, % change, velocity.
- [x] Funding rate + elevated/extreme classification.
- [x] Liquidation aggregation by side + spike anomaly score.
- [x] Basis (futures close - spot close).
- [x] Volume anomaly (z-score / multiplier).
- [x] Volatility / ATR / price structure.

## Phase 7 — Signal engine
- [x] `LEVERAGED_RALLY`
- [x] `SPOT_CONFIRMED_RALLY`
- [x] `SHORT_COVERING_POSSIBLE`
- [x] `SELLING_ABSORPTION_POSSIBLE`
- [x] `BULLISH_SPOT_DIVERGENCE`
- [x] `LONG_LIQUIDATION`
- [x] `SHORT_LIQUIDATION`
- [x] `LONG_CROWDING`
- [x] `SHORT_CROWDING`
- [x] Severity + confidence formula (data quality / confirmation / magnitude / historical).
- [x] Explainable `reasons[]` on every signal.

## Phase 8 — Health / Risk score
- [x] Health Score 0-100, weighted components, configurable weights.
- [x] Leverage Risk Score 0-100, independent of Health.

## Phase 9 — PostgreSQL persistence
- [x] Schema + migration runner.
- [x] `market_candles`, `spot_metrics`, `futures_metrics`, `funding_rates`,
      `open_interest`, `liquidations`, `market_signals`, `signal_outcomes`,
      `alert_events`, `bot_users`, `bot_settings`, `symbols`.
- [x] Retention: aggregated rows only, no raw tick table (see ASSUMPTIONS §13).

## Phase 10 — Web dashboard
- [x] Market overview (health/risk grid + heatmap across timeframes).
- [x] Symbol detail page.
- [x] Charts: price, spot CVD, futures CVD, OI, funding, liquidations,
      health, risk (all 8, via `lightweight-charts`).
- [x] Signals list + historical signal performance page (`/performance`,
      shows "not enough data yet" as the headline when `sufficientData`
      is false, not a footnote).
- [x] Signal markers overlaid directly on the price chart, colored by
      severity (`components/charts/PriceChart.tsx`).

## Phase 11 — Telegram bot
- [x] `/start /status /btc /eth /sol /market /signals /alerts /help`
- [ ] `/config` (spec lists it in §20 but gives no behavior — MVP alerts are
      configured via `bot_settings` row seeded per chat with defaults;
      an interactive `/config` UI is a TODO, not required to be useful).
- [x] Cooldown per (symbol, timeframe, signal type).
- [x] Re-alert only on severity increase / large confidence change / state change.

## Phase 12 — Historical validation
- [x] `signal_outcomes` rows populated by an outcome-tracker job at
      +15m/+1h/+4h/+24h after each signal fires.
- [x] Performance query/endpoint (win-rate, median move) computed from real
      `signal_outcomes` rows — returns "insufficient data" below a sample
      threshold rather than a fabricated number.

## Phase 13 — Testing
- [x] Unit tests: Healthy Rally, Leveraged Rally, Short Covering, Long
      Liquidation, Selling Absorption, Bullish Spot Divergence (spec §37).
- [x] Missing data → data quality LOW → confidence capped.
- [x] WS reconnect logic (pure state-machine test, no live socket needed).
- [x] Duplicate event ignored.
- [x] Out-of-order event ignored/rejected.

## Phase 14 — Observability
- [x] Structured logging (pino) across worker/api/telegram.
- [x] `/health` endpoint (API) reporting DB/Redis/collector freshness.
- [x] Data-quality score feeding confidence (not just logged).
- [x] Rate-limit backoff on Binance REST (429/418 handling).

## Phase 15 — Docker
- [x] `docker-compose.yml`: postgres, redis, api, worker, web, telegram.
- [x] Dockerfiles per app.

## Phase 16 — Futures-only symbols (post-MVP, added on request)
- [x] `FUTURES_ONLY_SYMBOLS` config for symbols with a Binance Futures
      listing but no Spot listing (e.g. HYPEUSDT) — reduced feature set,
      never fabricated spot data. See ASSUMPTIONS.md §15.

## Known limitations (carried forward, not silently hidden)
- [ ] Liquidation history cannot be backfilled on a cold start (exchange
      limitation, see ASSUMPTIONS §1/§6) — 24h rolling average anomaly needs
      ~24h of collector uptime before it's meaningful.
- [ ] Open Interest history backfill is capped at 30 days by Binance
      (`openInterestHist`); anything older is unavailable.
- [ ] AI summarization layer (spec §32) not built — explicitly optional/last
      in the spec's own priority order.
- [ ] Per-timeframe-specific thresholds (today one global threshold set
      applies across 5m/15m/1h/4h) — spec doesn't require per-timeframe
      tuning for MVP; noted as a future refinement once backtest data exists.
- [ ] Multi-exchange (Bybit/OKX) — abstraction exists, no second adapter
      implemented (explicitly out of scope for MVP per spec §34).
