#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$repo_root/node_modules/.bin:$PATH"
exec node "$repo_root/scripts/build-android-preview.ts" "$@"
