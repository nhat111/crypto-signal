# Deployment

Two hosts, because the workload splits cleanly: `apps/web` is stateless and
serverless-friendly; `apps/worker` holds a permanent Binance WebSocket
connection and `apps/api` serves it, so both need an always-on process —
something Vercel's serverless functions don't provide.

```
Vercel            → apps/web (Next.js dashboard)
Any Docker VPS    → apps/worker + apps/api + Postgres (+ apps/telegram, optional)
                    via docker-compose.prod.yml, Caddy in front for HTTPS
```

The backend used to run on Railway. Nothing in the code depends on it: every
service is a plain Dockerfile configured by environment variables, so any
host that runs containers 24/7 works. The VPS route below is the one the
repo ships config for.

## Web dashboard — Vercel

Already deployed. To redeploy or set up again:

1. Vercel → **Add New → Project → Import Git Repository** → `nhat111/crypto-signal`.
2. **Root Directory**: `apps/web`. Framework auto-detects as Next.js.
3. **Environment Variables**: `NEXT_PUBLIC_API_BASE_URL` = the API's
   public HTTPS URL (`https://<API_DOMAIN>`, see below) — this is baked in at build time, so changing it
   requires a redeploy, not just a settings save.
4. Deploy. Future pushes to the connected branch redeploy automatically.

## Backend — any VPS with Docker

What it needs from the machine:

- **~1GB RAM** at runtime (Postgres ~200MB + ~71MB per Node service). The
  first build (`npm install` + esbuild) wants more — on a 1GB box add 2GB of
  swap first.
- **A region Binance serves.** Binance blocks US IPs (HTTP 451) — pick
  Singapore, Tokyo, Frankfurt or similar, never a US datacenter.
- **Ports 80 and 443 open** to the internet (Caddy's certificate check and
  the dashboard's traffic). Nothing else needs to be open; Postgres is not
  published.

Free or cheap hosts that fit: Oracle Cloud *Always Free* (ARM, plenty of RAM
— remember to also open 80/443 in the VCN security list, not just the
firewall), or any ~$4–6/month VPS (Hetzner, DigitalOcean, Vultr, …).

### 1. First setup

```bash
# on the VPS
curl -fsSL https://get.docker.com | sh
git clone https://github.com/nhat111/crypto-signal.git && cd crypto-signal
cp .env.example .env
```

Edit `.env`:

- `POSTGRES_PASSWORD` — `openssl rand -hex 24`. Letters and digits only; it
  goes into a URL.
- `API_DOMAIN` — a hostname pointing at the VPS. No domain of your own?
  `api.<ip-with-dashes>.sslip.io` (e.g. `api.203-0-113-7.sslip.io`) resolves
  to that IP with no setup, and Caddy gets a real certificate for it.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_IDS`, `SYMBOLS`, … — same
  variables as before, all in the one file. `DATABASE_URL` in `.env` is
  ignored by the production stack; it is built from `POSTGRES_PASSWORD`.

Then:

```bash
./scripts/deploy-vps.sh
curl https://<API_DOMAIN>/health
```

The script pulls, exports `GIT_COMMIT` (so `/status` shows which build is
serving — a VPS injects no commit variable on its own) and runs
`docker compose -f docker-compose.prod.yml up -d --build`. **Run the same
script for every later deploy.** Logs: `docker compose -f
docker-compose.prod.yml logs -f worker` (or `api`, `telegram`, `caddy`).

Last step: in Vercel set `NEXT_PUBLIC_API_BASE_URL=https://<API_DOMAIN>`
and **Redeploy** — it is baked in at build time.

### 2. Bringing the data over from Railway (if it is still reachable)

Railway keeps a stopped project's volumes for a while after a trial ends.
If you can still open the Postgres service, copy its **public** connection
URL (Postgres → Connect → Public Network) and on the VPS:

```bash
# stop the writers so the restore lands on a quiet database
docker compose -f docker-compose.prod.yml stop worker api telegram

docker run --rm postgres:16-alpine pg_dump --no-owner --no-acl -Fc \
  "<railway public DATABASE_URL>" > railway.dump

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U crypto -d crypto_market_health < railway.dump

./scripts/deploy-vps.sh
```

If Railway has already deleted it, skip this: the worker starts from an
empty database, and `BACKFILL_DAYS=30` (see "Running the historical replay"
below) recovers the last 30 days — the most Binance serves for open interest.

### Settings that now live in `.env`

Everywhere below that says "worker service → **Variables**", on the VPS it
means: edit `.env`, then `./scripts/deploy-vps.sh` (or `docker compose -f
docker-compose.prod.yml up -d` to apply env changes without a rebuild). All
services read the same `.env`, so a variable meant for the worker is also
visible to the api — harmless, since each only reads its own.

You also have a shell now, so the one-off jobs no longer need the
environment-variable trick: `docker compose -f docker-compose.prod.yml exec
worker node backfill.cjs` runs the replay directly.

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

### Worker configuration

- (optional) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_IDS` for proactive
  alert pushes from the worker itself.
- Everything else (`SYMBOLS`, `TIMEFRAMES`, all `THRESH_*`) has working
  defaults — only set them if you want to override.
- `FUTURES_ONLY_SYMBOLS` — comma-separated symbols with a Binance Futures
  listing but no Spot listing (e.g. `HYPEUSDT`). Reduced feature set, no
  Health Score, no fabricated spot data — see ASSUMPTIONS.md §15.

**Symbols are read by the worker only.** The worker registers each one in
the `symbols` table at startup, and `api` reads the list back from there
(`getEnabledSymbols`), so `api`/`web` need no symbol config of their own.
The `telegram` service reads the list from the API at boot to register its
per-symbol commands — **restart it after adding a symbol** or the new
`/command` won't exist yet.

First boot runs migrations automatically (`db/migrate.mjs`, see the
`Dockerfile.worker` CMD) then starts backfilling history — check logs for
`"backfill complete"` per symbol/timeframe.

`curl https://<API_DOMAIN>/health` should return `{"status":"ok",...}` (or
`"degraded"` with `no_data_yet` right after the worker's first boot).

**Do not wire `/health` as a container healthcheck that restarts the api.** It reports on
things outside the api — collector freshness and the worker's heartbeat —
so it answers "is the system working", not "is this process alive". Wired
as a platform healthcheck it would restart the *api* when the
*worker* dies, which fixes nothing and hides the api's own state behind
someone else's. Point external uptime monitoring at it by all means; that
is what it is for.

### Health alerts on Telegram

Set `TELEGRAM_ALERT_CHAT_IDS` on the **worker** (comma-separated chat ids)
and it reports its own failures: a symbol that stops producing snapshots,
a Binance socket that is not open, a background job that has never
succeeded, and the collector losing its heartbeat.

It reports **transitions only** — once when something breaks, once when it
recovers, silence in between. That is deliberate: an alert repeating every
cycle gets muted within a day, and a muted alert looks like coverage while
providing none. Leave the variable unset and no alerting runs at all, and
no queries are made for it.

A restart re-announces whatever is still broken, because the "already told
you" set lives in memory. One duplicate message after a deploy costs less
than a table and a migration to avoid it.

### Which timeframes are allowed to wake you

The same chat ids also receive **signal** alerts, and those fire once per
closed candle on **every** frame in `TIMEFRAMES` — so a 5m and a 15m candle
push too. `TELEGRAM_DEFAULT_TIMEFRAME` does not change this: it only
governs what the bot answers when you *ask* it something.

Set `ALERT_TIMEFRAMES` on the **worker** to choose. For spot, `1h,4h`: a
15m reading flips several times inside one decision, and 4h is the horizon
`/performance` measures outcomes at.

Filtering here silences Telegram only — every signal is still written and
still scored, so `/signals` and `/performance` see the frames you muted.

Two guards, because the failure mode is silence and silence looks like a
calm market: a frame that is not in `TIMEFRAMES` is logged and ignored
rather than obeyed, and if *every* name is unrecognised the whole list is
ignored instead of turning alerting off. The boot log always states what
is armed:

```
signal alerts armed for timeframes  alertTimeframes=["1h","4h"] collected=["5m","15m","1h","4h"]
```

`/status` says the same thing without a log, under **Kết nối Binance**:

- `Khung được bắn: 1h, 4h` — the variable took effect.
- `Khung được bắn: 5m, 15m, 1h, 4h` plus a grey note that nothing is being
  filtered — either unset, or set to everything; the page does not guess
  which.
- An amber note naming a frame that is not in `TIMEFRAMES` — a typo, which
  is dropped rather than obeyed and would otherwise look like a quiet
  market.
- No row at all — the worker predates the field and has not redeployed.

### Telegram bot (optional)

Runs as the `telegram` service in `docker-compose.prod.yml` and talks to the
api over the compose network (`http://api:4000`). If `TELEGRAM_BOT_TOKEN` is
unset it logs a warning and exits — safe to leave in. Restart it after
adding a symbol so the new `/command` is registered:
`docker compose -f docker-compose.prod.yml restart telegram`.

## Did the deploy actually land?

**Open `/status` in the dashboard.** It answers this and the checks below
without a terminal, which matters because the times you most need it — a
deploy from a phone, a job that has been failing all week — are exactly
when psql and curl are not available. Four cards, each with its own
verdict: the build serving, collector freshness per symbol, whether the
outcome tracker is keeping up, and whether any background job is failing.

The same thing over HTTP, if you have a shell:

```bash
curl -s <api-url>/health | jq '{status, version}'
```

```json
{
  "status": "ok",
  "version": {
    "commit": "66a894f",
    "commitSource": "GIT_COMMIT",
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

The worker has no HTTP surface, so it writes its build into the database at
boot and `/status` lists it under the api's own commit. Two different
commits there means that service has not been redeployed yet — which is the
normal way this goes wrong, since the services deploy one at a time. It
also still logs the same fields on the `starting worker` line.

Redeploying only some services is normal, but the two must not drift apart
across a migration: api and worker both run migrations, so whichever
deploys first pulls the schema forward, and an old build then queries a
newer schema. That is fine for additive migrations (every one here so far)
and is why the order in the previous section is api first.

## Proving the alert path actually works

`/status` shows how many chats the worker could alert, which proves the
variable was read and nothing more. A mistyped chat id counts exactly the
same as a correct one — the send returns 400 and is swallowed, because an
undeliverable alert must never take the collector down — so "đang bật · 1
kênh" can sit over a channel that will never receive anything.

To settle it, send a real message:

1. Add `TELEGRAM_ALERT_TEST=1` to `.env`
2. `docker compose -f docker-compose.prod.yml up -d worker`
3. A message arrives in each configured chat within a few seconds of boot
4. The logs say `alert self-test: every chat received the message`, or
   `alert self-test: some chats did NOT receive the message` naming each
   failing id and Telegram's own reason — "chat not found" means the id is
   wrong, "bot was blocked by the user" means somebody blocked the bot
5. Remove the variable, or it sends again on every restart

`alert self-test asked for, but no chat ids are configured` means
`TELEGRAM_ALERT_CHAT_IDS` is empty — a different problem from a wrong id,
with a different fix.

If **nothing at all** appears, work down this list; each line rules out the
one above it:

- `/status` → **build** → does `worker — commit` match what you pushed? An
  older commit means this deploy predates the feature and the variable is
  being read by nobody.
- The boot log always prints `health alerts armed` with `selfTest: true` or
  `false`. `false` with the variable set means it is on the wrong service
  (it must be on `worker`) or misspelled; no such line at all means the
  build is older than this feature.
- `alert self-test starting` without a result line means the sends are
  still in flight or the process died mid-boot — check for a crash.

## Running the historical replay

With a shell on the VPS, the simplest way is to run it directly:
`docker compose -f docker-compose.prod.yml exec worker node backfill.cjs`.

It can also be triggered by an environment variable (the way it was done on
Railway, which had no shell):

1. Add `BACKFILL_DAYS=30` to `.env`
2. `docker compose -f docker-compose.prod.yml up -d worker`
3. Watch the logs for `history replay complete`, then check `/status` →
   **Tác vụ nền** for `history_backfill`
4. Remove the variable when you are done (optional — see below)

If the logs say `history replay already ran recently — skipping`, the
20-hour cooldown is holding. Add `BACKFILL_FORCE=1` alongside
`BACKFILL_DAYS` and redeploy to run anyway, then remove it. The cooldown
exists so a crash-looping container cannot fire a fresh 30-day replay on
every restart; forcing it is a deliberate, one-off act.

When `/status` → **Chấm kết quả tín hiệu** shows a backlog with
`Chấm được ngay` at 0, the **Vì sao chưa chấm được?** button on that card
runs the two diagnostic queries and names the cause: no 5m candles at all,
signals older than the candles held, a hole in the candles, or the
resolver disagreeing with itself. It is a scan, so it runs only on that
click, never on the page's 30-second poll — and it exists because the
alternative was a psql session, which this platform only offers from a
laptop.

**5m is not optional.** Outcomes are priced off futures 5m candles, so a
replay stores them for every symbol even when `TIMEFRAMES` leaves 5m out —
without them every signal stays `pending` and `resolvableNow` is 0 forever,
on `/status` → **Chấm kết quả tín hiệu**. They are stored for pricing only:
no 5m signals are written, so excluding 5m from `TIMEFRAMES` still means
no 5m rows on `/performance`. Live signals need live 5m candles, though —
if `TIMEFRAMES` omits 5m, only the replayed window can ever be scored.

It runs after the collector is already live and is never awaited, so live
candle collection does not wait on it, and nothing it does can take the
worker down.

**It will not re-run on a restart.** Containers restart on their own — a
crash loop, a platform migration, an out-of-memory kill — and a variable
left set would otherwise fire a fresh 30-day replay, and hundreds of
upstream requests, every single time. A successful run inside the last 20
hours suppresses the next one, which also means the variable is safe to
leave in place: it degrades to "replay at most once a day" rather than
being something you must remember to remove.

A value that is not a positive number is ignored with a warning rather than
being guessed at, so a typo cannot quietly become some arbitrary window.

**This is time-sensitive.** Binance serves open-interest history for the
last 30 days only, so every day the replay goes unrun is a day of history
that can never be recovered.

From a laptop against the production database, the same job is `node backfill.cjs` inside the worker
image, or `npm run backfill -w @crypto-signal/worker` from a clone.

## Keeping it small

On a VPS the bill is flat, so the question is whether it fits in RAM, not
per-minute cost. Measured RSS:

| Service     | Memory | Notes                                        |
| ----------- | ------ | -------------------------------------------- |
| Postgres    | ~200MB | The floor. Nothing to tune without losing history. |
| worker      | ~71MB  | The only process that must run 24/7.         |
| api         | ~71MB  | Needed by the web dashboard and the bot.     |
| telegram    | ~71MB  | Optional — the dashboard works without it.   |
| caddy       | ~20MB  | HTTPS for the api.                           |

If the box is tight: drop the Telegram service, trim `TIMEFRAMES`
(`5m,1h` cuts write volume by more than half), and do not add symbols
casually — each adds websocket streams, REST polls and rows on every
timeframe. Storage grows roughly 50MB a month at three symbols; the 30-day
replay adds ~60MB once.

## Enabling the small-cap discovery scanner (optional)

A separate, opt-in subsystem — see ASSUMPTIONS.md §16 for what it can and
cannot tell you before relying on it.

On the **`worker`** service only, add:

- `GEM_SCAN_ENABLED=true`
- `GEM_CHAINS=solana` — comma-separated DexScreener chain slugs. `solana`
  (RugCheck) and the EVM chains GoPlus covers (`bsc`, `ethereum`, `base`,
  `polygon`, `arbitrum`, `avalanche`, `optimism`) have a safety screen;
  anything else is surfaced with a "no screen" badge and no gate. Both
  discovery feeds cover `solana`, `robinhood` and `bsc`; other chains run
  on DexScreener's paid-promotion feeds alone, which is a much narrower
  slice of the chain than it looks — `/status` names which source is
  missing.
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
