#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [ -f current-release.env ]; then
  cp current-release.env previous-release.env
fi
cp "$REMOTE_RELEASE_MANIFEST" current-release.env

release_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2}' "$REMOTE_RELEASE_MANIFEST" | tr -d '\r')"
if [ -n "$release_sha" ]; then
  printf '%s\n' "$release_sha" > DEPLOYED_SHA
fi
date -u +%Y-%m-%dT%H:%M:%SZ > DEPLOYED_AT_UTC
