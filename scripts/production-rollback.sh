#!/usr/bin/env sh
set -eu

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD='docker compose'
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD='docker-compose'
else
  echo 'Neither docker compose nor docker-compose is available on the server' >&2
  exit 1
fi

$COMPOSE_CMD stop web python-worker python-api >/dev/null 2>&1 || true
$COMPOSE_CMD -f docker-compose.node.yml up --build -d --remove-orphans postgres api web
