# CLAUDE.md

Guidance for Claude Code sessions in this repository. Read this first, then
the docs it points to; it is a map, not a copy of them.

## What this is

Crypto Market Health Monitor: a Telegram bot + web dashboard that asks one
question deterministically: **is a price move backed by real spot demand,
or mostly leverage?** Plus a daily wide coin scan, 4H entry setups, a gem
scanner and a trade journal. No AI in the signals, no single composite
score, no "buy/sell" wording.

- `README.md`: architecture, local run, testing.
- `ASSUMPTIONS.md`: every decision and why (numbered sections; the coin
  scan is §18, fundamentals §20, watchlist/setups §21, exit alert §22).
- `TODO.md`: phase-by-phase status. Tick items as they ship.
- `API_CONTRACT.md`: the HTTP API that web and Telegram consume. Update it
  with any payload change.
- `DEPLOY.md`: Render (worker + api + telegram in one container,
  `Dockerfile.allinone`) and Vercel (web).

## Layout

- `packages/*`: pure, unit-tested engine (`shared` config and thresholds,
  `market-data` Binance/OKX adapters, `indicators` incl. `coinScan.ts` and
  `watchlist.ts`, `signal-engine`, `health-engine`, `gem-scanner`,
  `lookup`, `db`, the only place SQL lives).
- `apps/worker`: the only process that talks to exchanges; scheduler,
  coin scan (`coinScan.ts`), exit alert (`coinWatch.ts`), digest
  (`trendCycle.ts`, `coinDigest.ts`), setups.
- `apps/api`: Fastify, read-only. `apps/web`: Next.js (see
  `apps/web/AGENTS.md`: this Next.js version differs from training data).
  `apps/telegram`: Telegraf, calls the API only.
- Airdrop research: `packages/indicators/src/airdrop.ts` (screen),
  `packages/market-data/src/airdrop/defillama.ts`, `packages/db/src/airdrop.ts`
  (candidates + farm log), `apps/worker/src/airdropScan.ts`,
  `apps/api/src/routes/airdrops.ts`, web `/airdrops` + `/guide/airdrop`,
  bot `/airdrops` + `/farm` (`apps/telegram/src/airdrop.ts`). ASSUMPTIONS §25.
- Sectors and flywheel: `packages/indicators/src/sectors.ts` and
  `flywheel.ts`, `packages/market-data/src/coingecko/markets.ts` and
  `defillama/holdersRevenue.ts`, `packages/db/src/sectorsFlywheel.ts`,
  worker `sectorScan.ts` + `flywheelScan.ts`, web `/narratives`, bot
  `/sectors` + `/flywheel`. ASSUMPTIONS §26.
- `db/migrations/NNN_*.sql`: forward-only, numbered.

## Conventions

- UI text (web labels, Telegram messages, reasons/unknowns) is Vietnamese.
  Code, identifiers, comments and commit messages are English.
- A new `CoinFlow` label touches: `packages/indicators/src/coinScan.ts`
  (union, `ALL_COIN_FLOWS`, `classifyFlow`), `apps/web/src/lib/types.ts`,
  `apps/web/src/lib/coinFlow.ts` (`FLOW_META`, test counts the labels),
  `apps/web/src/app/coins/page.tsx` (legend), `apps/telegram/src/apiClient.ts`,
  `apps/telegram/src/coinsFormat.ts`, `apps/worker/src/coinDigest.ts`,
  `API_CONTRACT.md`. Stored rows are never relabelled.
- Thresholds live in `packages/shared/src/config.ts`; test fixtures that
  build a full `CoinScanThresholds` must list every field.
- Explain the "why" in comments the way the surrounding code does; keep
  logic pure where it can be and test it without a database.

## Commands

```bash
npm ci
npx vitest run       # all tests (DB tests skip without TEST_DATABASE_URL)
npm run typecheck
npm run lint
(cd apps/web && npx next build)
```

CI (`.github/workflows/ci.yml`) runs these on every push with Postgres.
Run them before pushing.

## Production

- Default branch: `claude/crypto-market-health-monitor-qlja9s`. Merges
  auto-deploy: API/worker on Render (`https://crypto-signal-k771.onrender.com`),
  web on Vercel (`https://trackingticker.vercel.app`).
- `GET /api/status` shows the running commit and job health; `GET /api/coins`
  the latest scan (`exchange` is usually `okx`: Binance bans the shared
  Render IP).
- The coin scan runs once per UTC day after the daily close (~00:45–01:00
  UTC, 7–8h Vietnam). A deploy does not re-run a stored day, so label
  changes show from the next scan.

## Recent state (2026-10-22)

- PR #29: `short_squeeze` flow ("Short bị ép"), `fundingShortsPayPct`.
- PR #30: exit-side Telegram alert for held/⭐ coins (`coinWatch.ts`);
  thin-spot note relative to the day's median (`flagThinSpot`). First run
  with it: the scan of 16/10. Check `/api/status` jobs and the worker log
  line `coin watch alert sent` if it seems silent (no change = no message).
- Phase 21 (2026-10-21): gem scanner on by default (it had never been
  enabled in production); airdrop research list, farm log and strategy
  guide (migration 037).
- Phase 22 (2026-10-21): sector read against BTC and flywheel list
  (migration 038).
- PRs #42–45 (2026-10-21): /lookup shows the stored flow read, sectors,
  flywheel and the 1D levels; the coin scan reads the whole day from OKX
  when Binance futures refuses the server; guide on OI and funding.
- Intraday exit check (2026-10-22): hourly, held/⭐ coins on OKX against
  the last daily close, once per coin and kind a day (`coinWatchIntraday.ts`,
  migration 039, job `coin_watch_intraday`).
- Open questions, from `TODO.md`: the coin-scan edge report has 0 samples
  until enough days are stored (verdicts expected ~mid-December 2026);
  a stop on journal trades
  (R results); token unlock data (needs a paid source).
- Position sizing: `/risk` stores account + risk% per chat (migration 035);
  the setup alert and /setups size from it (`packages/shared/src/sizing.ts`,
  ASSUMPTIONS §23).
