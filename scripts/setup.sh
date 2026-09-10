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
  git clone --depth 1 --branch "$HERMES_REF" https://github.com/facebook/hermes.git vendor/hermes
fi
echo "hermes $(git -C vendor/hermes rev-parse --short HEAD)"

if [ ! -f vendor/hermes/build/bin/shermes ]; then
  echo "Building Static Hermes..."
  cmake -S vendor/hermes -B vendor/hermes/build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++
  cmake --build vendor/hermes/build --target shermes-dep -j"$(nproc)"
fi

command -v clang >/dev/null || echo "warning: clang not found (scriptc and shermes need it)"
command -v cc >/dev/null || echo "warning: cc not found (porffor needs it)"
command -v cmake >/dev/null || echo "warning: cmake not found (shermes needs it)"
command -v ninja >/dev/null || echo "warning: ninja not found (shermes needs it)"
