#!/usr/bin/env bash
# Installs the toolchains the harness needs that npm cannot provide.
set -euo pipefail
cd "$(dirname "$0")/.."

# Porffor has no package.json on main, so it is vendored from git at a pinned commit.
PORFFOR_REF="${PORFFOR_REF:-1f4ae4ae3e0a5f0a93b3bc084359e1a3a23391fd}"
if [ -d vendor/porffor/.git ]; then
  CURRENT_PORFFOR="$(git -C vendor/porffor rev-parse HEAD 2>/dev/null || true)"
  if [ "$CURRENT_PORFFOR" != "$PORFFOR_REF" ]; then
    git -C vendor/porffor checkout -q "$PORFFOR_REF" 2>/dev/null || {
      git -C vendor/porffor fetch --depth 1 origin refs/heads/main
      git -C vendor/porffor checkout -q "$PORFFOR_REF" 2>/dev/null || git -C vendor/porffor checkout -q FETCH_HEAD
    }
  fi
else
  mkdir -p vendor/porffor
  git clone --depth 1 https://github.com/CanadaHonk/porffor.git vendor/porffor
  if [ "$PORFFOR_REF" != "main" ]; then
    git -C vendor/porffor checkout -q "$PORFFOR_REF" 2>/dev/null || {
      git -C vendor/porffor fetch --depth 1 origin "$PORFFOR_REF" 2>/dev/null || git -C vendor/porffor fetch --depth 1 origin refs/heads/main
      git -C vendor/porffor checkout -q "$PORFFOR_REF" 2>/dev/null || git -C vendor/porffor checkout -q FETCH_HEAD
    }
  fi
fi
echo "porffor $(git -C vendor/porffor rev-parse --short HEAD)"

# Static Hermes (branch static_h)
HERMES_REF="${HERMES_REF:-static_h}"
if [ -d vendor/hermes/.git ]; then
  CURRENT_HERMES="$(git -C vendor/hermes rev-parse HEAD 2>/dev/null || true)"
  if [ "$CURRENT_HERMES" != "$HERMES_REF" ]; then
    git -C vendor/hermes checkout -q "$HERMES_REF" 2>/dev/null || {
      git -C vendor/hermes fetch --depth 1 origin refs/heads/static_h
      git -C vendor/hermes checkout -q "$HERMES_REF" 2>/dev/null || git -C vendor/hermes checkout -q FETCH_HEAD
    }
  fi
else
  mkdir -p vendor/hermes
  git clone --depth 1 --branch "$HERMES_REF" https://github.com/facebook/hermes.git vendor/hermes 2>/dev/null || {
    git clone --depth 1 --branch static_h https://github.com/facebook/hermes.git vendor/hermes
    if [ "$HERMES_REF" != "static_h" ]; then
      git -C vendor/hermes checkout -q "$HERMES_REF" 2>/dev/null || {
        git -C vendor/hermes fetch --depth 1 origin "$HERMES_REF" 2>/dev/null || git -C vendor/hermes fetch --depth 1 origin refs/heads/static_h
        git -C vendor/hermes checkout -q "$HERMES_REF" 2>/dev/null || git -C vendor/hermes checkout -q FETCH_HEAD
      }
    fi
  }
fi
HERMES_COMMIT="$(git -C vendor/hermes rev-parse HEAD)"
echo "hermes ${HERMES_COMMIT:0:7}"

BUILT_COMMIT_FILE="vendor/hermes/build/.built_commit"
LAST_BUILT_COMMIT=""
[ -f "$BUILT_COMMIT_FILE" ] && LAST_BUILT_COMMIT="$(cat "$BUILT_COMMIT_FILE")"

if [ ! -f vendor/hermes/build/bin/shermes ] || [ "$LAST_BUILT_COMMIT" != "$HERMES_COMMIT" ]; then
  command -v cmake >/dev/null || { echo "error: cmake not found (shermes build needs it)" >&2; exit 1; }
  command -v ninja >/dev/null || { echo "error: ninja not found (shermes build needs it)" >&2; exit 1; }
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
