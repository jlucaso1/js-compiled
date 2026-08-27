#!/usr/bin/env bash
# Installs the toolchains the harness needs that npm cannot provide.
set -euo pipefail
cd "$(dirname "$0")/.."

# Porffor has no package.json on main, so it is vendored from git at the latest commit.
PORFFOR_REF="${PORFFOR_REF:-main}"
if [ -d vendor/porffor/.git ]; then
  git -C vendor/porffor fetch --depth 1 origin "$PORFFOR_REF"
  git -C vendor/porffor checkout -q FETCH_HEAD
else
  mkdir -p vendor
  git clone --depth 1 --branch "$PORFFOR_REF" https://github.com/CanadaHonk/porffor.git vendor/porffor
fi
echo "porffor $(git -C vendor/porffor rev-parse --short HEAD)"

command -v clang >/dev/null || echo "warning: clang not found (scriptc needs it)"
command -v cc >/dev/null || echo "warning: cc not found (porffor needs it)"
