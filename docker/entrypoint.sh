#!/bin/sh
set -eu

ATTEMPTS=0
MAX_ATTEMPTS="${DB_WAIT_MAX_ATTEMPTS:-40}"

echo "Waiting for Postgres and running migrations..."
until bun run db:init >/tmp/coworker-db-init.log 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "Database init failed after ${MAX_ATTEMPTS} attempts."
    cat /tmp/coworker-db-init.log || true
    exit 1
  fi
  echo "Postgres not ready yet (attempt ${ATTEMPTS}/${MAX_ATTEMPTS}). Retrying in 3s..."
  sleep 3
done

echo "Database ready. Starting coworker backend..."
exec bun run src/index.ts
