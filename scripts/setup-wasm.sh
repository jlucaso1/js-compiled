#!/usr/bin/env bash
# Downloads the pinned Wasmtime host used to execute the Wasm benchmark runners.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=49.0.1
SHA256=c71f7e0d30a92e418f0d17db7c6d8f6664c1ad764340a1278678f4209deab534
ASSET="wasmtime-v${VERSION}-x86_64-linux.tar.xz"
URL="https://github.com/bytecodealliance/wasmtime/releases/download/v${VERSION}/${ASSET}"
DEST="vendor/wasmtime/wasmtime"
MARKER="vendor/wasmtime/.archive_sha256"

if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo "error: pinned Wasmtime ${VERSION} bundle is only provided for Linux x86_64" >&2
  exit 1
fi

if [ -x "$DEST" ] && [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$SHA256" ] && "$DEST" --version | grep -F "${VERSION}" >/dev/null; then
  echo "wasmtime ${VERSION} (sha256 ${SHA256})"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL --retry 3 "$URL" -o "$TMP/$ASSET"
echo "${SHA256}  $TMP/$ASSET" | sha256sum --check --status || {
  echo "error: Wasmtime archive SHA-256 mismatch" >&2
  exit 1
}
tar -xJf "$TMP/$ASSET" -C "$TMP"
install -D -m 0755 "$TMP/wasmtime-v${VERSION}-x86_64-linux/wasmtime" "$DEST"
printf '%s\n' "$SHA256" > "$MARKER"
"$DEST" --version | grep -F "${VERSION}" >/dev/null || {
  echo "error: installed Wasmtime does not report ${VERSION}" >&2
  exit 1
}
echo "wasmtime ${VERSION} (sha256 ${SHA256})"
