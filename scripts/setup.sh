#!/usr/bin/env bash
# Installs the toolchains the harness needs that npm cannot provide.
set -euo pipefail
cd "$(dirname "$0")/.."

# Porffor has no package.json on main, so it is vendored from git at a pinned commit.
PORFFOR_REF="${PORFFOR_REF:-1f4ae4ae3e0a5f0a93b3bc084359e1a3a23391fd}"
PORFFOR_COMMIT_FILE="vendor/porffor/.porffor_commit"
CURRENT_PORFFOR=""

if [ -d vendor/porffor/.git ]; then
  CURRENT_PORFFOR="$(git -C vendor/porffor rev-parse HEAD 2>/dev/null || true)"
elif [ -f "$PORFFOR_COMMIT_FILE" ]; then
  CURRENT_PORFFOR="$(cat "$PORFFOR_COMMIT_FILE" 2>/dev/null || true)"
fi

if [ -f vendor/porffor/runtime/index.js ] && [ -n "$CURRENT_PORFFOR" ] && [ "$CURRENT_PORFFOR" = "$PORFFOR_REF" ]; then
  echo "$CURRENT_PORFFOR" > "$PORFFOR_COMMIT_FILE"
  echo "porffor ${CURRENT_PORFFOR:0:7}"
else
  if [ -d vendor/porffor/.git ]; then
    git -C vendor/porffor fetch --depth 1 origin "$PORFFOR_REF"
    git -C vendor/porffor checkout -q FETCH_HEAD
  else
    mkdir -p vendor/porffor
    git -C vendor/porffor init -q
    git -C vendor/porffor remote add origin https://github.com/CanadaHonk/porffor.git 2>/dev/null || git -C vendor/porffor remote set-url origin https://github.com/CanadaHonk/porffor.git
    git -C vendor/porffor fetch --depth 1 origin "$PORFFOR_REF"
    git -C vendor/porffor checkout -q FETCH_HEAD
  fi
  CURRENT_PORFFOR="$(git -C vendor/porffor rev-parse HEAD)"
  echo "$CURRENT_PORFFOR" > "$PORFFOR_COMMIT_FILE"
  echo "porffor ${CURRENT_PORFFOR:0:7}"
fi

# Static Hermes (branch static_h)
HERMES_REF="${HERMES_REF:-static_h}"
HERMES_COMMIT_FILE="vendor/hermes/.hermes_commit"
BUILT_COMMIT_FILE="vendor/hermes/build/.built_commit"

LAST_BUILT_COMMIT=""
[ -f "$BUILT_COMMIT_FILE" ] && LAST_BUILT_COMMIT="$(cat "$BUILT_COMMIT_FILE" 2>/dev/null || true)"

CURRENT_HERMES=""
if [ -d vendor/hermes/.git ]; then
  CURRENT_HERMES="$(git -C vendor/hermes rev-parse HEAD 2>/dev/null || true)"
elif [ -f "$HERMES_COMMIT_FILE" ]; then
  CURRENT_HERMES="$(cat "$HERMES_COMMIT_FILE" 2>/dev/null || true)"
fi

if [ -f vendor/hermes/build/bin/shermes ] && [ -n "$LAST_BUILT_COMMIT" ] && { [ "$LAST_BUILT_COMMIT" = "$HERMES_REF" ] || { [ "$HERMES_REF" = "static_h" ] && [ "$CURRENT_HERMES" = "$LAST_BUILT_COMMIT" ]; }; }; then
  echo "$LAST_BUILT_COMMIT" > "$HERMES_COMMIT_FILE"
  echo "hermes ${LAST_BUILT_COMMIT:0:7}"
else
  if [ -d vendor/hermes/.git ]; then
    git -C vendor/hermes fetch --depth 1 origin "$HERMES_REF"
    git -C vendor/hermes checkout -q FETCH_HEAD
  else
    mkdir -p vendor/hermes
    git -C vendor/hermes init -q
    git -C vendor/hermes remote add origin https://github.com/facebook/hermes.git 2>/dev/null || git -C vendor/hermes remote set-url origin https://github.com/facebook/hermes.git
    git -C vendor/hermes fetch --depth 1 origin "$HERMES_REF"
    git -C vendor/hermes checkout -q FETCH_HEAD
  fi
  HERMES_COMMIT="$(git -C vendor/hermes rev-parse HEAD)"
  echo "$HERMES_COMMIT" > "$HERMES_COMMIT_FILE"
  echo "hermes ${HERMES_COMMIT:0:7}"

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
fi

command -v clang >/dev/null || echo "warning: clang not found (scriptc and shermes need it)"
command -v cc >/dev/null || echo "warning: cc not found (porffor needs it)"
