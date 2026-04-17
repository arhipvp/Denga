#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [ ! -f previous-release.env ] || [ ! -s previous-release.env ]; then
  echo 'previous-release.env is missing; there is nothing to roll back to' >&2
  exit 1
fi

if [ ! -f stable-release.env ] || [ ! -s stable-release.env ]; then
  echo 'stable-release.env is missing; cannot rotate rollback markers safely' >&2
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

tmp_stable="$(mktemp stable-release.XXXXXX.env)"
tmp_previous="$(mktemp previous-release.XXXXXX.env)"
tmp_current="$(mktemp current-release.XXXXXX.env)"
tmp_sha="$(mktemp DEPLOYED_SHA.XXXXXX)"
tmp_time="$(mktemp DEPLOYED_AT_UTC.XXXXXX)"
trap 'rm -f "$tmp_stable" "$tmp_previous" "$tmp_current" "$tmp_sha" "$tmp_time"' EXIT

cp previous-release.env "$tmp_stable"
cp previous-release.env "$tmp_current"
cp stable-release.env "$tmp_previous"

printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin
$COMPOSE_CMD --env-file .env --env-file "$tmp_current" pull python-api python-worker web >/dev/null
$COMPOSE_CMD --env-file .env --env-file "$tmp_current" up -d --remove-orphans --force-recreate python-api python-worker web

mv "$tmp_stable" stable-release.env
mv "$tmp_current" current-release.env
mv "$tmp_previous" previous-release.env

release_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2}' current-release.env | tr -d '\r')"
if [ -n "$release_sha" ]; then
  printf '%s\n' "$release_sha" > "$tmp_sha"
  mv "$tmp_sha" DEPLOYED_SHA
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$tmp_time"
mv "$tmp_time" DEPLOYED_AT_UTC
