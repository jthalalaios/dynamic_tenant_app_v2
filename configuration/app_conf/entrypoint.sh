#!/bin/sh
# Node.js container boot.
#
#   serve     (nodejs-app) dependencies → wait for DB → migrate (every boot) →
#             sync permissions → seed (first boot) → HTTP API (+ scheduler)
#   realtime  (realtime)   Socket.IO websocket server
#   anything else is executed as is, e.g. `docker compose exec nodejs-app npm test`
#
# Steps that must succeed fail the container instead of being silently skipped.
set -eu

APP_DIR="/app"
cd "$APP_DIR"

log() { echo "[entrypoint] $*"; }

cli() { node src/cli.ts "$@"; }

# Compose does not pass APP_ENV; fall back to the app's .env, then "production"
if [ -z "${APP_ENV:-}" ] && [ -f "$APP_DIR/.env" ]; then
  APP_ENV=$(sed -n 's/^APP_ENV=//p' "$APP_DIR/.env" | tail -n 1 | tr -d '"'"'"'\r')
fi
APP_ENV=${APP_ENV:-production}
export APP_ENV

# --------------------------------------------------------------- dependencies
# The named node_modules volume keeps the image's install; refresh it when
# package.json / package-lock.json changed since (npm ls fails on any mismatch)
ensure_dependencies() {
  if ! npm ls --depth=0 > /dev/null 2>&1; then
    log "node_modules out of date, installing dependencies..."
    npm ci --no-audit --no-fund
  fi
}

case "${1:-serve}" in
  serve)
    log "APP_ENV=$APP_ENV"
    ensure_dependencies

    # depends_on: service_healthy covers compose, but not restarts or external databases
    log "Waiting for the database..."
    cli db:wait

    # Remember whether this is the very first boot of this database, before migrating
    FIRST_BOOT=$(cli db:first-boot)

    # Always migrate: applies every migration added since the last boot (no-op when up to date)
    log "Running migrations..."
    cli migrate

    # Idempotent; picks up permissions added to src/config/permissions.ts
    log "Syncing permissions..."
    cli permissions:sync

    if [ "$FIRST_BOOT" = "1" ] || [ "${RUN_SEEDERS:-false}" = "true" ]; then
      log "Seeding database..."
      cli db:seed
    else
      log "Database already seeded (set RUN_SEEDERS=true to seed again)."
    fi

    log "Starting the HTTP API (scheduler: presence:close-stale, tokens:purge)..."
    if [ "$APP_ENV" = "production" ]; then
      exec node src/server.ts
    fi
    # Development: restart on every source change, like PHP picks up edits per request
    exec node --watch-path=src src/server.ts
    ;;

  realtime)
    ensure_dependencies
    log "Starting the realtime (Socket.IO) server..."
    if [ "$APP_ENV" = "production" ]; then
      exec node src/realtime.ts
    fi
    exec node --watch-path=src src/realtime.ts
    ;;

  *)
    exec "$@"
    ;;
esac
