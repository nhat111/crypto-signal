#!/usr/bin/env bash
# One container, three processes — for free hosts that give a single service
# (Render free, Koyeb free, a spare VM). See Dockerfile.allinone and DEPLOY.md.
#
# api + worker are essential: if either exits, the container exits so the
# platform restarts it. telegram is optional and restarts on its own, so a
# bot crash never takes the collector down with it.
set -u

node db/migrate.mjs || exit 1

# Free hosts assign the public port through $PORT; honour it over API_PORT.
export API_PORT="${PORT:-${API_PORT:-4000}}"
export API_HOST="${API_HOST:-0.0.0.0}"

node api.cjs &
API_PID=$!
node worker.cjs &
WORKER_PID=$!

TG_PID=
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  (
    # The bot reads the symbol list from the api at boot — give it a moment.
    sleep 5
    while true; do
      NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:${API_PORT}" node telegram.cjs
      echo "telegram exited ($?) — restarting in 10s"
      sleep 10
    done
  ) &
  TG_PID=$!
fi

trap 'kill -TERM $API_PID $WORKER_PID $TG_PID 2>/dev/null' TERM INT

wait -n "$API_PID" "$WORKER_PID"
STATUS=$?
echo "api or worker exited ($STATUS) — stopping container"
kill -TERM $API_PID $WORKER_PID $TG_PID 2>/dev/null
exit "$STATUS"
