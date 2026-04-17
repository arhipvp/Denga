#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [ ! -f stable-release.env ] || [ ! -s stable-release.env ]; then
  echo 'stable-release.env is missing; cannot restore last known good release' >&2
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

tmp_current="$(mktemp current-release.XXXXXX.env)"
tmp_sha="$(mktemp DEPLOYED_SHA.XXXXXX)"
tmp_time="$(mktemp DEPLOYED_AT_UTC.XXXXXX)"
trap 'rm -f "$tmp_current" "$tmp_sha" "$tmp_time"' EXIT

cp stable-release.env "$tmp_current"
mv "$tmp_current" current-release.env

printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin
$COMPOSE_CMD --env-file .env --env-file ./current-release.env pull python-api python-worker web >/dev/null
$COMPOSE_CMD --env-file .env --env-file ./current-release.env up -d --remove-orphans --force-recreate python-api python-worker web

release_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2}' current-release.env | tr -d '\r')"
if [ -n "$release_sha" ]; then
  printf '%s\n' "$release_sha" > "$tmp_sha"
  mv "$tmp_sha" DEPLOYED_SHA
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$tmp_time"
mv "$tmp_time" DEPLOYED_AT_UTC
