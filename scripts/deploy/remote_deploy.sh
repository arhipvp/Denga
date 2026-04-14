#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD='docker compose'
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD='docker-compose'
else
  echo 'Neither docker compose nor docker-compose is available on the server' >&2
  exit 1
fi

compose_with_release() {
  local release_file="$1"
  shift
  $COMPOSE_CMD --env-file .env --env-file "$release_file" "$@"
}

mkdir -p backups
printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin

echo "Creating fresh production backup at $DEPLOY_BACKUP_FILE"
compose_with_release "$REMOTE_RELEASE_MANIFEST" up -d postgres
compose_with_release "$REMOTE_RELEASE_MANIFEST" exec -T postgres sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DEPLOY_BACKUP_FILE"

echo 'Pulling immutable release images'
compose_with_release "$REMOTE_RELEASE_MANIFEST" pull python-api python-worker web

echo 'Running Alembic migrations'
compose_with_release "$REMOTE_RELEASE_MANIFEST" run --rm -T python-api python scripts/migrate.py upgrade

echo 'Running bootstrap seed'
compose_with_release "$REMOTE_RELEASE_MANIFEST" run --rm -T python-api python scripts/bootstrap_seed.py

echo 'Starting python-api and python-worker'
compose_with_release "$REMOTE_RELEASE_MANIFEST" up -d --remove-orphans --force-recreate python-api python-worker
