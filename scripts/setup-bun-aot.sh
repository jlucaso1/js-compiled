#!/usr/bin/env bash
# Keep the experimental compiler separate from stable Bun on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo "error: pinned Bun AOT artifact currently supports Linux x86_64 only" >&2
  exit 1
fi
readarray -t PIN < <(node -e 'const p=require("./scripts/bun-aot.json"); console.log(p.commit); console.log(p.bunPrVersion); console.log(p.binarySha256)')
COMMIT="${PIN[0]}"
BUN_PR_VERSION="${PIN[1]}"
SHA256="${PIN[2]}"
DEST="$PWD/vendor/bun-aot"
mkdir -p "$DEST"
if [ -f "$DEST/bun" ] && echo "$SHA256  $DEST/bun" | sha256sum --check --status; then
  echo "Reusing verified Bun AOT PR #45631 ${COMMIT}"
else
  command -v bunx >/dev/null || { echo "error: install stable Bun to provide bunx" >&2; exit 1; }
  TMP="$(mktemp -d "$DEST/download.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  # A PR number can fall back to an older build. A full commit cannot float.
  BUN_REPO_OWNER=oven-sh BUN_REPO_NAME=bun BUN_OUT_DIR="$TMP" bunx "bun-pr@${BUN_PR_VERSION}" "$COMMIT"
  BINARY="$TMP/bun-${COMMIT}-commit${COMMIT}"
  [ -f "$BINARY" ] || { echo "error: bun-pr did not provide the pinned commit" >&2; exit 1; }
  echo "$SHA256  $BINARY" | sha256sum --check --status || {
    echo "error: Bun AOT binary SHA-256 mismatch; refusing to execute" >&2
    exit 1
  }
  install -m 0755 "$BINARY" "$DEST/bun"
fi
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const pin = JSON.parse(readFileSync('scripts/bun-aot.json', 'utf8'));
const version = execFileSync('vendor/bun-aot/bun', ['--version'], { encoding: 'utf8' }).trim();
const revision = execFileSync('vendor/bun-aot/bun', ['--revision'], { encoding: 'utf8' }).trim();
if (!revision.includes(pin.commit.slice(0, 9))) throw new Error(`Unexpected Bun AOT revision: ${revision}`);
writeFileSync('vendor/bun-aot/provenance.json', JSON.stringify({ ...pin, version, revision }, null, 2) + '\n');
console.log(`Bun AOT PR #${pin.pr}: ${revision} (sha256 ${pin.binarySha256})`);
NODE
