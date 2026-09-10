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

# Static Hermes (branch static_h)
HERMES_REF="${HERMES_REF:-static_h}"
if [ -d vendor/hermes/.git ]; then
  git -C vendor/hermes fetch --depth 1 origin "$HERMES_REF"
  git -C vendor/hermes checkout -q FETCH_HEAD
else
  mkdir -p vendor
  git clone --depth 1 --branch "$HERMES_REF" https://github.com/facebook/hermes.git vendor/hermes 2>/dev/null || {
    git clone --depth 1 https://github.com/facebook/hermes.git vendor/hermes
    git -C vendor/hermes fetch --depth 1 origin "$HERMES_REF"
    git -C vendor/hermes checkout -q FETCH_HEAD
  }
fi
HERMES_COMMIT="$(git -C vendor/hermes rev-parse HEAD)"
echo "hermes ${HERMES_COMMIT:0:7}"

BUILT_COMMIT_FILE="vendor/hermes/build/.built_commit"
LAST_BUILT_COMMIT=""
[ -f "$BUILT_COMMIT_FILE" ] && LAST_BUILT_COMMIT="$(cat "$BUILT_COMMIT_FILE")"

if [ ! -f vendor/hermes/build/bin/shermes ] || [ "$LAST_BUILT_COMMIT" != "$HERMES_COMMIT" ]; then
  echo "Building Static Hermes (${HERMES_COMMIT:0:7})..."
  cmake -S vendor/hermes -B vendor/hermes/build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++
  cmake --build vendor/hermes/build --target shermes-dep -j"$(nproc)"
  echo "$HERMES_COMMIT" > "$BUILT_COMMIT_FILE"
fi

command -v clang >/dev/null || echo "warning: clang not found (scriptc and shermes need it)"
command -v cc >/dev/null || echo "warning: cc not found (porffor needs it)"
command -v cmake >/dev/null || echo "warning: cmake not found (shermes needs it)"
command -v ninja >/dev/null || echo "warning: ninja not found (shermes needs it)"
