# Crypto Market Health Monitor

Telegram bot + web dashboard that answers one question deterministically:

> **Is this price move backed by real spot demand, or mostly leverage/futures activity — and how risky is the current positioning?**

Built from `crypto_market_health_monitor_spec.md` (the PRD). See
**`ASSUMPTIONS.md`** for every place the spec was ambiguous and what we
decided, and **`TODO.md`** for phase-by-phase status and known
limitations. **`API_CONTRACT.md`** documents the HTTP API the web and
Telegram apps consume.

Never: green candle = buy, red candle = sell. CVD comes from Binance's own
taker-buy-volume kline field. Never: a single "Score" — Health and Leverage
Risk are independent axes. Never: "market will dump" — signals are
explainable, probability/risk-framed, deterministic, and AI-free.

## Architecture

```
Binance Spot/Futures (REST + WS)
        |
apps/worker  (collector -> normalizer -> indicators -> signals -> health/risk -> persist)
        |                                                            |
   PostgreSQL  <---------------------------------------------  Redis (latest-snapshot cache)
        |
   apps/api  (Fastify, read-only)
    /      \
apps/web   apps/telegram
(Next.js)  (Telegraf, calls apps/api — never DB/Binance directly)
```

Packages (`packages/*`) are the deterministic engine, each independently
unit-tested and free of I/O:
- `shared` — domain types, central config (every threshold/weight),
  logger, UTC time helpers.
- `market-data` — Binance REST/WS adapters, candle normalizer
  (dedupe/out-of-order/gap detection), reconnect backoff.
- `indicators` — CVD, OI, funding, basis, volume anomaly, volatility,
  liquidation anomaly → `MarketSnapshot`.
- `signal-engine` — the 9 signal rules (spec §7/§15), confidence formula,
  severity escalation.
- `health-engine` — Health Score (spec §13 weights) and independent
  Leverage Risk Score.
- `db` — Postgres schema + typed repo functions (the only place SQL lives).

Apps (`apps/*`):
- `worker` — the only process that talks to Binance; owns the pipeline,
  scheduler (outcome tracking, retention, historical-score refresh),
  and Telegram alert push.
- `api` — Fastify, read-only, reads Postgres. Shared domain layer for web
  + Telegram (rule: no duplicated business logic between them).
- `web` — Next.js dashboard, pure client of `apps/api`.
- `telegram` — Telegraf bot, pure client of `apps/api`.

## Running locally

```bash
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN if you want the bot
docker compose up --build
```

This starts Postgres, Redis, runs migrations once, then starts worker, api
(`:4000`), web (`:3000`), and telegram. The Telegram bot silently no-ops
if `TELEGRAM_BOT_TOKEN` is empty — everything else still works.

### Without Docker

```bash
npm install
node --env-file=.env db/migrate.mjs   # requires a running Postgres — see .env.example
npm run dev:worker    # terminal 1
npm run dev:api       # terminal 2
npm run dev:web       # terminal 3
npm run dev:telegram  # terminal 4 (optional, needs TELEGRAM_BOT_TOKEN)
```

## Testing

```bash
npm test          # vitest — indicators, signal-engine, health-engine, market-data normalizer, worker alerting/state
npm run typecheck  # tsc --noEmit across every package/app
npm run build      # tsc build across every package/app (apps/web uses next build)
```

Unit tests cover the spec §37 required scenarios (Healthy Rally, Leveraged
Rally, Short Covering, Long Liquidation, Selling Absorption, Bullish Spot
Divergence) plus the §10/§29 reliability edge cases: missing/low-quality
data suppressing confidence, WS reconnect backoff policy, duplicate
candle events, and out-of-order candle events.

## What's real vs. what's a known limitation

Everything numeric comes from a verified Binance endpoint (see
ASSUMPTIONS.md §1) — nothing is simulated. The one hard limitation: Binance
has no market-wide historical liquidation endpoint, so liquidation data
(and its 24h rolling-average anomaly baseline) only starts accumulating
from the moment the worker first connects — see ASSUMPTIONS.md §6 and
TODO.md's "Known limitations" section.
