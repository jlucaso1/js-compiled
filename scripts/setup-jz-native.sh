#!/usr/bin/env bash
# Prepare the pinned jz wasm2c native toolchain. This build is intentionally
# kept in hosted CI; the native compiler and WABT are not npm dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

JZ_REF="${JZ_REF:-d3d5712b837df86265ccbbd955b76e4a6014a208}"
WABT_REF="${WABT_REF:-ff0ef7e0009402740c805a9744c09b05be063e48}"

clone_at() {
  local repo="$1" dir="$2" ref="$3"
  if [ ! -d "$dir/.git" ]; then
    mkdir -p "$(dirname "$dir")"
    git clone --depth 1 --filter=blob:none --no-checkout "https://github.com/${repo}.git" "$dir"
  fi
  local current
  current="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
  if [ "$current" != "$ref" ]; then
    git -C "$dir" fetch --depth 1 origin "$ref"
    git -C "$dir" checkout --detach -q FETCH_HEAD
  fi
}

clone_at dy/jz vendor/jz "$JZ_REF"
if [ "$(cat vendor/jz/.jz_commit 2>/dev/null || true)" != "$JZ_REF" ] || [ ! -d vendor/jz/node_modules/watr ]; then
  npm ci --prefix vendor/jz --omit=dev --ignore-scripts --no-audit --no-fund
fi
printf '%s\n' "$JZ_REF" > vendor/jz/.jz_commit

clone_at WebAssembly/wabt vendor/wabt "$WABT_REF"
if [ "$(cat vendor/wabt/.wabt_commit 2>/dev/null || true)" != "$WABT_REF" ] || [ ! -x vendor/wabt/build/wasm2c ]; then
  cmake -S vendor/wabt -B vendor/wabt/build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF -DBUILD_TOOLS=ON -DBUILD_LIBWASM=OFF
  cmake --build vendor/wabt/build --target wasm2c -j2
fi
printf '%s\n' "$WABT_REF" > vendor/wabt/.wabt_commit

command -v clang >/dev/null || { echo 'error: clang is required for jz-native' >&2; exit 1; }
printf 'jz %s\nwabt %s\n' "$JZ_REF" "$WABT_REF"
clang --version | head -1
vendor/wabt/build/wasm2c --version
