#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

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
