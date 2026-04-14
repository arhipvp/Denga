#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [ ! -f current-release.env ]; then
  echo 'No current-release.env found on server, skipping rollback' >&2
  exit 0
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD='docker compose'
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD='docker-compose'
else
  echo 'Neither docker compose nor docker-compose is available on the server' >&2
  exit 1
fi

set -a
. ./.env
. ./current-release.env
set +a

printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin
$COMPOSE_CMD pull python-api python-worker web >/dev/null
$COMPOSE_CMD up -d --remove-orphans --force-recreate python-api python-worker web
