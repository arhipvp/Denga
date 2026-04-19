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

service_container_id() {
  local service_name="$1"
  compose_with_release "$REMOTE_RELEASE_MANIFEST" ps -q "$service_name" | tr -d '\r' | head -n 1
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
  service_container_id "$service_name" | while read -r container_id; do
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

  container_id="$(service_container_id "$service_name")"
  if [ -z "$container_id" ]; then
    echo "No running container found for $service_name before promotion" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi

  actual_ref="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
  actual_image_id="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true)"
  actual_revision="$(docker image inspect "$actual_ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
  container_created="$(docker inspect --format '{{.Created}}' "$container_id" 2>/dev/null || true)"
  container_running="$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)"

  echo "Verified promotion candidate for $service_name:" \
    "container=$container_id" \
    "created=${container_created:-<unknown>}" \
    "running=${container_running:-<unknown>}" \
    "imageRef=${actual_ref:-<unknown>}" \
    "revision=${actual_revision:-<missing>}"

  if [ "$container_running" != "true" ]; then
    echo "Running $service_name is not in running state before promotion" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi

  if [ "$actual_ref" != "$expected_ref" ]; then
    echo "Running $service_name does not match release candidate manifest before promotion" >&2
    echo "Expected image ref: $expected_ref" >&2
    echo "Actual image ref: ${actual_ref:-<missing>}" >&2
    echo "Actual image id: ${actual_image_id:-<missing>}" >&2
    echo "Actual revision label: ${actual_revision:-<missing>}" >&2
    print_runtime_diagnostics "$service_name"
    return 1
  fi
}

echo 'Verifying candidate runtime before promotion'
compose_with_release "$REMOTE_RELEASE_MANIFEST" exec -T python-api python scripts/migrate.py verify-head
verify_running_service_release python-api
verify_running_service_release python-worker

tmp_stable="$(mktemp stable-release.XXXXXX.env)"
tmp_current="$(mktemp current-release.XXXXXX.env)"
tmp_previous="$(mktemp previous-release.XXXXXX.env)"
tmp_sha="$(mktemp DEPLOYED_SHA.XXXXXX)"
tmp_time="$(mktemp DEPLOYED_AT_UTC.XXXXXX)"
trap 'rm -f "$tmp_stable" "$tmp_current" "$tmp_previous" "$tmp_sha" "$tmp_time"' EXIT

cp "$REMOTE_RELEASE_MANIFEST" "$tmp_stable"
cp "$REMOTE_RELEASE_MANIFEST" "$tmp_current"

if [ -f stable-release.env ] && [ -s stable-release.env ]; then
  cp stable-release.env "$tmp_previous"
  mv "$tmp_previous" previous-release.env
else
  rm -f previous-release.env
fi

mv "$tmp_stable" stable-release.env
mv "$tmp_current" current-release.env

release_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2}' "$REMOTE_RELEASE_MANIFEST" | tr -d '\r')"
if [ -n "$release_sha" ]; then
  printf '%s\n' "$release_sha" > "$tmp_sha"
  mv "$tmp_sha" DEPLOYED_SHA
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$tmp_time"
mv "$tmp_time" DEPLOYED_AT_UTC
