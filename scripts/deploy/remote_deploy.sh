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

expected_image_ref() {
  local service_name="$1"
  case "$service_name" in
    python-api)
      awk -F= '$1 == "PYTHON_API_IMAGE" {print $2}' "$REMOTE_RELEASE_MANIFEST" | tr -d '\r'
      ;;
    python-worker)
      awk -F= '$1 == "PYTHON_WORKER_IMAGE" {print $2}' "$REMOTE_RELEASE_MANIFEST" | tr -d '\r'
      ;;
    *)
      echo "Unsupported service for image lookup: $service_name" >&2
      return 1
      ;;
  esac
}

print_runtime_diagnostics() {
  local service_name="$1"
  echo "==== docker compose ps ====" >&2
  compose_with_release "$REMOTE_RELEASE_MANIFEST" ps >&2 || true
  echo "==== docker inspect $service_name ====" >&2
  compose_with_release "$REMOTE_RELEASE_MANIFEST" ps -q "$service_name" | while read -r container_id; do
    if [ -n "$container_id" ]; then
      docker inspect "$container_id" >&2 || true
    fi
  done
  echo "==== python-api logs ====" >&2
  compose_with_release "$REMOTE_RELEASE_MANIFEST" logs --tail=200 python-api >&2 || true
  echo "==== python-worker logs ====" >&2
  compose_with_release "$REMOTE_RELEASE_MANIFEST" logs --tail=200 python-worker >&2 || true
}

verify_running_service_release() {
  local service_name="$1"
  local expected_ref actual_ref actual_image_id actual_revision container_created container_running container_id
  expected_ref="$(expected_image_ref "$service_name")"
  if [ -z "$expected_ref" ]; then
    echo "Expected image ref is empty for $service_name" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi

  container_id="$(compose_with_release "$REMOTE_RELEASE_MANIFEST" ps -q "$service_name" | tr -d '\r' | head -n 1)"
  if [ -z "$container_id" ]; then
    echo "No running container found for $service_name after rollout" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi

  actual_ref="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
  actual_image_id="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true)"
  actual_revision="$(docker image inspect "$actual_ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
  container_created="$(docker inspect --format '{{.Created}}' "$container_id" 2>/dev/null || true)"
  container_running="$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)"

  echo "Verified runtime candidate for $service_name:" \
    "container=$container_id" \
    "created=${container_created:-<unknown>}" \
    "running=${container_running:-<unknown>}" \
    "imageRef=${actual_ref:-<unknown>}" \
    "revision=${actual_revision:-<missing>}"

  if [ "$container_running" != "true" ]; then
    echo "Running $service_name is not in running state" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi

  if [ "$actual_ref" != "$expected_ref" ]; then
    echo "Running $service_name does not match current-release.env" >&2
    echo "Expected image ref: $expected_ref" >&2
    echo "Actual image ref: ${actual_ref:-<missing>}" >&2
    echo "Actual image id: ${actual_image_id:-<missing>}" >&2
    echo "Actual revision label: ${actual_revision:-<missing>}" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi
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

echo 'Verifying running python-api and python-worker match current-release.env'
verify_running_service_release python-api
verify_running_service_release python-worker
