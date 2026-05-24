#!/usr/bin/env sh
set -eu

export NODE_ENV="${NODE_ENV:-production}"
export DEMO_MODE="${DEMO_MODE:-true}"
export SERVER_HOST="${SERVER_HOST:-0.0.0.0}"
export SERVER_PORT="${SERVER_PORT:-3000}"
export VITE_DEMO_MODE="${VITE_DEMO_MODE:-true}"
export VITE_SERVER_URL="${VITE_SERVER_URL:-/}"
export G_SPOT_WEB_DIST_DIR="${G_SPOT_WEB_DIST_DIR:-/app/apps/web/dist}"

exec bun run --filter server start
