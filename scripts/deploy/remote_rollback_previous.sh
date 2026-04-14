#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [ ! -f previous-release.env ]; then
  echo 'previous-release.env is missing; there is nothing to roll back to' >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD='docker compose'
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD='docker-compose'
else
  echo 'Neither docker compose nor docker-compose is available on the server' >&2
  exit 1
fi

tmp_release="$(mktemp current-release.XXXXXX.env)"
if [ -f current-release.env ]; then
  cp current-release.env "$tmp_release"
else
  : > "$tmp_release"
fi

cp previous-release.env current-release.env
if [ -s "$tmp_release" ]; then
  cp "$tmp_release" previous-release.env
fi
rm -f "$tmp_release"

set -a
. ./.env
. ./current-release.env
set +a

printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin
$COMPOSE_CMD pull python-api python-worker web >/dev/null
$COMPOSE_CMD up -d --remove-orphans --force-recreate python-api python-worker web

release_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2}' current-release.env | tr -d '\r')"
if [ -n "$release_sha" ]; then
  printf '%s\n' "$release_sha" > DEPLOYED_SHA
fi
date -u +%Y-%m-%dT%H:%M:%SZ > DEPLOYED_AT_UTC
