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

if [ ! -f .env ]; then
  echo 'Missing .env in current directory' >&2
  exit 1
fi

read_compose_env() {
  var_name="$1"
  $COMPOSE_CMD run --rm --no-deps python-api python -c "import os; print(os.getenv('$var_name', ''))" | tr -d '\r'
}

echo 'Building release images before write freeze'
$COMPOSE_CMD build python-api python-worker web
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.migrate.yml build prisma-bootstrap

ADMIN_EMAIL_VALUE="${ADMIN_EMAIL:-$(read_compose_env ADMIN_EMAIL)}"
ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD:-$(read_compose_env ADMIN_PASSWORD)}"

if [ -z "$ADMIN_EMAIL_VALUE" ] || [ -z "$ADMIN_PASSWORD_VALUE" ]; then
  echo 'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env for contract verification' >&2
  exit 1
fi

NEXT_PUBLIC_API_URL_VALUE="${NEXT_PUBLIC_API_URL:-$(read_compose_env NEXT_PUBLIC_API_URL)}"
WEB_URL_VALUE="${WEB_URL:-$(read_compose_env WEB_URL)}"

if [ -n "$NEXT_PUBLIC_API_URL_VALUE" ]; then
  VERIFY_API_BASE_URL="${VERIFY_API_BASE_URL:-$NEXT_PUBLIC_API_URL_VALUE}"
else
  VERIFY_API_BASE_URL="${VERIFY_API_BASE_URL:-http://localhost:3001/api}"
fi

API_HEALTHCHECK_URL="${API_HEALTHCHECK_URL:-${VERIFY_API_BASE_URL%/api}/health/ready}"
APP_URL="${APP_URL:-${WEB_URL_VALUE:-http://localhost:3000}}"
VERIFY_ADMIN_EMAIL="${VERIFY_ADMIN_EMAIL:-$ADMIN_EMAIL_VALUE}"
VERIFY_ADMIN_PASSWORD="${VERIFY_ADMIN_PASSWORD:-$ADMIN_PASSWORD_VALUE}"

mkdir -p backups
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="backups/cutover-pre-${timestamp}.dump"
baseline_snapshot="backups/cutover-baseline-${timestamp}.json"

rollback() {
  echo 'Cutover failed, starting rollback to legacy Node runtime' >&2
  $COMPOSE_CMD stop web python-worker python-api >/dev/null 2>&1 || true
  $COMPOSE_CMD -f docker-compose.node.yml up --build -d --remove-orphans postgres api web
}

verify_url() {
  name="$1"
  url="$2"

  attempt=1
  while [ "$attempt" -le 18 ]; do
    if curl --fail --show-error --silent "$url" >/dev/null; then
      echo "$name is ready"
      return 0
    fi
    echo "$name is not ready yet (attempt $attempt/18), waiting 5s..."
    attempt=$((attempt + 1))
    sleep 5
  done

  echo "$name did not become ready in time" >&2
  return 1
}

verify_running_service() {
  service_name="$1"
  if ! $COMPOSE_CMD ps --status running --services | grep -Fx "$service_name" >/dev/null; then
    echo "Service $service_name is not running" >&2
    return 1
  fi
}

echo "Creating fresh production backup at $backup_file"
$COMPOSE_CMD up -d postgres
$COMPOSE_CMD exec -T postgres sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"

echo "Writing baseline invariants snapshot to $baseline_snapshot"
$COMPOSE_CMD run --rm python-api python scripts/verify_invariants.py --write "$baseline_snapshot"

echo 'Stopping legacy runtime to enforce write freeze'
$COMPOSE_CMD -f docker-compose.node.yml stop web api >/dev/null 2>&1 || true

echo 'Running Prisma migrations and bootstrap seed'
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.migrate.yml run --rm prisma-bootstrap

echo 'Starting python-api and python-worker'
$COMPOSE_CMD up --build -d --remove-orphans python-api python-worker

if ! verify_running_service python-worker || ! verify_url API "$API_HEALTHCHECK_URL"; then
  rollback
  exit 1
fi

echo 'Running contract verification against Python API'
if ! VERIFY_API_BASE_URL="$VERIFY_API_BASE_URL" \
  VERIFY_ADMIN_EMAIL="$VERIFY_ADMIN_EMAIL" \
  VERIFY_ADMIN_PASSWORD="$VERIFY_ADMIN_PASSWORD" \
  VERIFY_MEMBER_EMAIL="${VERIFY_MEMBER_EMAIL:-}" \
  VERIFY_MEMBER_PASSWORD="${VERIFY_MEMBER_PASSWORD:-}" \
  $COMPOSE_CMD run --rm python-api python scripts/verify_contract.py; then
  rollback
  exit 1
fi

echo 'Comparing post-start invariants against baseline snapshot'
if ! $COMPOSE_CMD run --rm python-api python scripts/verify_invariants.py --compare "$baseline_snapshot"; then
  rollback
  exit 1
fi

echo 'Starting web after automated gates passed'
$COMPOSE_CMD up -d web

if ! verify_url Web "$APP_URL"; then
  rollback
  exit 1
fi

echo 'Automated cutover gates passed.'
echo "Backup file: $backup_file"
echo "Baseline snapshot: $baseline_snapshot"
echo 'Keep maintenance window active until manual smoke is complete: login, dashboard, categories, latest backup, transaction CRUD, Telegram text flow, stats callback.'
