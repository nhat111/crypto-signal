# Deployment

Two hosts, because the workload splits cleanly: `apps/web` is stateless and
serverless-friendly; `apps/worker` holds a permanent Binance WebSocket
connection and `apps/api` serves it, so both need an always-on process —
something Vercel's serverless functions don't provide.

```
Vercel            → apps/web (Next.js dashboard)
Railway           → apps/worker + apps/api + Postgres + Redis (+ apps/telegram, optional)
```

## Web dashboard — Vercel

Already deployed. To redeploy or set up again:

1. Vercel → **Add New → Project → Import Git Repository** → `nhat111/crypto-signal`.
2. **Root Directory**: `apps/web`. Framework auto-detects as Next.js.
3. **Environment Variables**: `NEXT_PUBLIC_API_BASE_URL` = the Railway API's
   public URL (see below) — this is baked in at build time, so changing it
   requires a redeploy, not just a settings save.
4. Deploy. Future pushes to the connected branch redeploy automatically.

## Backend — Railway

Railway needs the Dashboard for two things a committed config file can't
express: creating each service and pointing it at the right Dockerfile.
Everything else (the Dockerfiles themselves, migrations) is already in the
repo.

**Root Directory stays `/` (repo root) for every service below** — all four
Dockerfiles (`Dockerfile.worker`, `.api`, `.telegram`) were written with a
repo-root build context specifically so this works without per-service
subdirectory juggling.

### 1. Create the project and databases

1. Railway → **New Project → Deploy from GitHub repo** → `nhat111/crypto-signal`.
   Railway will auto-guess a build for the first service — ignore/delete
   that guess, you'll configure each service manually below.
2. **New → Database → PostgreSQL** (adds a `Postgres` service with
   `DATABASE_URL` auto-generated).
3. **New → Database → Redis** (adds a `Redis` service with `REDIS_URL`
   auto-generated — Railway may label this "Key Value").

### 2. Worker service (required — this is the only process that talks to Binance)

1. On the auto-created service (or **New → GitHub Repo** again for a fresh
   one): **Settings → Source** — Root Directory empty/`/`.
2. **Settings → Build** — Builder: **Dockerfile**, Dockerfile Path:
   `Dockerfile.worker`.
3. **Variables** tab, add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL` = `${{Redis.REDIS_URL}}`
   - (optional) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_IDS` if you want
     proactive alert pushes from the worker itself.
   - Everything else (`SYMBOLS`, `TIMEFRAMES`, all `THRESH_*`) has working
     defaults — only set them if you want to override.
   - `FUTURES_ONLY_SYMBOLS` — comma-separated symbols with a Binance
     Futures listing but no Spot listing (e.g. `HYPEUSDT`). Reduced feature
     set, no Health Score, no fabricated spot data — see ASSUMPTIONS.md §15.

   **Symbols are configured on the `worker` service only.** The worker
   registers each one in the `symbols` table at startup, and `api` reads
   the list back from there (`getEnabledSymbols`), so `api`/`web` need no
   symbol config of their own. The `telegram` service reads the list from
   the API at boot to register its per-symbol commands — **restart it after
   adding a symbol** or the new `/command` won't exist yet.
4. Deploy. First boot runs migrations automatically (`db/migrate.mjs`, see
   the `Dockerfile.worker` CMD) then starts backfilling history — check logs
   for `"backfill complete"` per symbol/timeframe.

### 3. API service (required — this is what apps/web talks to)

1. **New → GitHub Repo** → same repo again, as a second service.
2. **Settings → Build** — Dockerfile Path: `Dockerfile.api`.
3. **Variables**: same `DATABASE_URL` / `REDIS_URL` references as the
   worker, plus `API_HOST=0.0.0.0`, `API_PORT=4000` (already the defaults,
   fine to leave unset).
4. **Settings → Networking → Generate Domain** — exposes it publicly on
   port 4000. Copy that URL — it's what Vercel's
   `NEXT_PUBLIC_API_BASE_URL` should point to.
5. Sanity check once deployed: `curl https://<that-domain>/health` should
   return `{"status":"ok",...}` (or `"degraded"` with `no_data_yet` right
   after the worker's first deploy, before it's produced a snapshot yet).

### 4. Telegram bot (optional)

1. **New → GitHub Repo** → same repo, third service.
2. Dockerfile Path: `Dockerfile.telegram`.
3. Variables: `TELEGRAM_BOT_TOKEN` (from @BotFather),
   `NEXT_PUBLIC_API_BASE_URL` = the API service's **private** Railway URL
   (`http://<api-service-name>.railway.internal:4000` — check the API
   service's Settings → Networking → Private Networking for the exact
   hostname) so bot→api traffic stays inside Railway's network instead of
   round-tripping through the public internet.
4. If `TELEGRAM_BOT_TOKEN` is unset, this service just logs a warning and
   exits cleanly — safe to skip entirely for now.

### 5. Point the web dashboard at it

Back in Vercel: **Settings → Environment Variables** → set
`NEXT_PUBLIC_API_BASE_URL` to the API service's public Railway domain from
step 3.4 → **Redeploy** (env var changes don't apply retroactively to an
already-built deployment).

## Enabling the small-cap discovery scanner (optional)

A separate, opt-in subsystem — see ASSUMPTIONS.md §16 for what it can and
cannot tell you before relying on it.

On the **`worker`** service only, add:

- `GEM_SCAN_ENABLED=true`
- `GEM_CHAINS=solana` (Solana is the only chain with a safety screen wired
  up; others would be surfaced unverified)
- optionally `RUGCHECK_API_KEY` — without it, screening is attempted
  unauthenticated and degrades to "unverified", never to "safe"

Everything else has working defaults (`.env.example` lists them). No change
is needed on `api`, `web`, or `telegram` — they read what the worker
persisted, though the bot needs a restart to register its `/gems` command.

Migration `004_gem_scanner.sql` runs automatically on the worker's next
boot. Give it one scan interval (default 30 min) before expecting anything
in `/gems`, and note that the performance panel deliberately shows "not
enough data yet" until 20 surfaced tokens have a recorded outcome.
