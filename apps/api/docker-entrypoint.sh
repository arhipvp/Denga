#!/bin/sh
set -eu

BASELINE_MIGRATION="20260407110000_init"

run_migrations() {
  if migrate_output=$(npx prisma migrate deploy 2>&1); then
    printf '%s\n' "$migrate_output"
    return 0
  fi

  printf '%s\n' "$migrate_output" >&2

  if printf '%s' "$migrate_output" | grep -q 'P3005'; then
    echo "Existing database without Prisma migration history detected, applying baseline ${BASELINE_MIGRATION}." >&2
    npx prisma migrate resolve --applied "$BASELINE_MIGRATION"
    npx prisma migrate deploy
    return 0
  fi

  return 1
}

run_migrations
npm run prisma:seed
exec node apps/api/dist/main.js
