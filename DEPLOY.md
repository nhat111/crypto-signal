# Deployment

Two hosts, because the workload splits cleanly: `apps/web` is stateless and
serverless-friendly; `apps/worker` holds a permanent Binance WebSocket
connection and `apps/api` serves it, so both need an always-on process —
something Vercel's serverless functions don't provide.

```
Vercel            → apps/web (Next.js dashboard)
Railway           → apps/worker + apps/api + Postgres (+ apps/telegram, optional)
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

### Redeploying: order doesn't matter

**`worker` and `api` both run migrations at boot** (both Dockerfiles' CMD
is `node db/migrate.mjs && npm run start …`), serialized behind a Postgres
advisory lock — whichever starts first applies what's pending, the other
blocks briefly and then finds nothing to do. So a service can never come up
querying a table that doesn't exist yet, and you can redeploy them in any
order. Migrations are idempotent; an extra redeploy is always safe.

`telegram` runs no migrations (it only calls the API), but **does** need a
restart to register new bot commands. `web` is on Vercel and only needs a
redeploy when its own code or `NEXT_PUBLIC_API_BASE_URL` changed.

If a service crash-loops right after a deploy, check its logs for a failed
migration first — the CMD chain means a migration error stops the service
from starting at all, deliberately, rather than letting it serve queries
against a half-applied schema.

### 1. Create the project and databases

1. Railway → **New Project → Deploy from GitHub repo** → `nhat111/crypto-signal`.
   Railway will auto-guess a build for the first service — ignore/delete
   that guess, you'll configure each service manually below.
2. **New → Database → PostgreSQL** (adds a `Postgres` service with
   `DATABASE_URL` auto-generated).

   There is deliberately **no Redis service**. An earlier design cached the
   latest snapshot there, but nothing ever read it back — the API queries
   Postgres directly. It was removed rather than kept "in case", because on
   Railway an idle service still bills for its memory every minute.

### 2. Worker service (required — this is the only process that talks to Binance)

1. On the auto-created service (or **New → GitHub Repo** again for a fresh
   one): **Settings → Source** — Root Directory empty/`/`.
2. **Settings → Build** — Builder: **Dockerfile**, Dockerfile Path:
   `Dockerfile.worker`.
3. **Variables** tab, add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
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
3. **Variables**: same `DATABASE_URL` reference as the
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

## Did the deploy actually land?

One request answers it:

```bash
curl -s <api-url>/health | jq '{status, version}'
```

```json
{
  "status": "ok",
  "version": {
    "commit": "66a894f",
    "commitSource": "RAILWAY_GIT_COMMIT_SHA",
    "startedAt": 1788019673995,
    "uptimeMs": 918,
    "schema": { "latest": "010_job_health.sql", "appliedAt": 1788019671224, "count": 10 }
  }
}
```

- **`commit`** — the build serving right now. Compare it to the commit you
  pushed. If it still shows the old one, the deploy did not roll over.
- **`uptimeMs`** — small means it just restarted. Large after you clicked
  redeploy means nothing was redeployed.
- **`schema.latest`** — the newest migration applied. Both api and worker
  migrate at boot, so this is how you confirm a schema change went through.
- **`commit: null`** — no platform variable was found. Not an error, and it
  never turns `/health` red; set `GIT_COMMIT` by hand if your platform is
  not among the ones read (`packages/shared/src/version.ts` lists them).

The worker has no HTTP surface, so it logs the same thing once at startup —
look for the `starting worker` line and its `commit` field. If that line is
absent from a recent restart, the worker is not running this build.

Redeploying only some services is normal, but the two must not drift apart
across a migration: api and worker both run migrations, so whichever
deploys first pulls the schema forward, and an old build then queries a
newer schema. That is fine for additive migrations (every one here so far)
and is why the order in the previous section is api first.

## Keeping it inside Railway's $5 credit

Railway bills memory and CPU **per minute, per service**, so the thing that
costs money here is how many processes sit running all month — not disk, and
not how much data the backfill wrote.

Roughly what each part costs (Railway's published rate is about $10 per
GB-month of memory; check your own usage page for the real figure, these are
measured RSS numbers from this app, not guesses):

| Service     | Memory | Notes                                        |
| ----------- | ------ | -------------------------------------------- |
| Postgres    | ~200MB | The floor. Nothing to tune without losing history. |
| worker      | ~71MB  | The only process that must run 24/7.         |
| api         | ~71MB  | Needed by the web dashboard and the bot.     |
| telegram    | ~71MB  | Optional — the dashboard works without it.   |

Two things were removed for exactly this reason:

- **Redis is gone.** The worker used to write a latest-snapshot cache there
  that nothing ever read — the API queries Postgres directly. A whole
  service billed every minute for nothing.
- **The services no longer run `tsx` in production.** They ran TypeScript
  through a transpiler at boot; each one now runs a pre-bundled `.cjs` on
  plain node. Measured: ~88MB → ~71MB per service.

If you are still over budget, in order of how much they save versus how much
they cost you:

1. **Drop the Telegram service** (~71MB). Alerts stop; everything else works.
2. **Trim `TIMEFRAMES`.** Four timeframes means four times the candles,
   metrics and health rows. `5m,1h` keeps the default view and the daily
   picture while cutting write volume by more than half.
3. **Do not add symbols.** Each one adds websocket streams, REST polls and
   rows on every timeframe, forever. Three is what the $5 tier comfortably
   holds.

Storage is genuinely not the concern: the whole schema grows on the order of
50MB a month at three symbols, and Railway charges cents per GB-month for it.
The 30-day historical replay adds roughly 60MB once.

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
is needed on `web` — it only reads what the worker persisted, through
`api`. The bot needs a restart to register its `/gems` command.

Migration `004_gem_scanner.sql` runs automatically on the worker's next
boot. Give it one scan interval (default 30 min) before expecting anything
in `/gems`, and note that the performance panel deliberately shows "not
enough data yet" until 20 surfaced tokens have a recorded outcome.

### Position watches ("/watch SYMBOL")

Unlike the rest of the gem scanner, this one **does** need `api` configured
too, not just `worker`: `/api/watches` reads its own `GEM_SCAN_ENABLED` and
`GEM_WATCH_*` env vars to know the sell-trigger defaults for a new watch, so
add the same `GEM_SCAN_ENABLED=true` (and optionally the `GEM_WATCH_*`
overrides) to the **`api`** service's variables as well. Without it,
`/watch` replies with "gem scanner is disabled" even while the worker is
scanning fine. Migration `005_gem_watches.sql` runs automatically on the
worker's next boot, same as the others. The bot needs a restart to register
`/watch`, `/watches`, `/unwatch`.
