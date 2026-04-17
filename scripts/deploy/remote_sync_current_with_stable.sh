#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [ ! -f stable-release.env ] || [ ! -s stable-release.env ]; then
  echo 'stable-release.env is missing; cannot sync current release marker' >&2
  exit 1
fi

tmp_current="$(mktemp current-release.XXXXXX.env)"
tmp_sha="$(mktemp DEPLOYED_SHA.XXXXXX)"
tmp_time="$(mktemp DEPLOYED_AT_UTC.XXXXXX)"
trap 'rm -f "$tmp_current" "$tmp_sha" "$tmp_time"' EXIT

cp stable-release.env "$tmp_current"
mv "$tmp_current" current-release.env

release_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2}' current-release.env | tr -d '\r')"
if [ -n "$release_sha" ]; then
  printf '%s\n' "$release_sha" > "$tmp_sha"
  mv "$tmp_sha" DEPLOYED_SHA
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$tmp_time"
mv "$tmp_time" DEPLOYED_AT_UTC
