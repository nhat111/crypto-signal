#!/usr/bin/env sh
# Pull the latest code and rebuild the production stack on the VPS.
#
#   ./scripts/deploy-vps.sh            # current branch
#   ./scripts/deploy-vps.sh main       # switch to a branch first
#
# GIT_COMMIT is exported so /health and /status show which build is
# serving — no platform injects it on a plain VPS.
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env here — copy .env.example to .env and fill in POSTGRES_PASSWORD and API_DOMAIN first." >&2
  exit 1
fi

if [ "${1:-}" != "" ]; then
  git fetch origin "$1"
  git checkout "$1"
fi
git pull --ff-only

GIT_COMMIT=$(git rev-parse HEAD)
export GIT_COMMIT

docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml ps
