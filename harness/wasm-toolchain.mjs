import { readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
export const WASMTIME_VERSION = "49.0.1";
export const WASMTIME_SHA256 = "c71f7e0d30a92e418f0d17db7c6d8f6664c1ad764340a1278678f4209deab534";
export const WASMTIME = path.join(ROOT, "vendor", "wasmtime", "wasmtime");

const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const packageVersions = {
  js2wasm: ["@loopdive/js2", "node_modules/@loopdive/js2"],
  assemblyscript: ["assemblyscript", "node_modules/assemblyscript"],
  wasiShim: ["@assemblyscript/wasi-shim", "node_modules/@assemblyscript/wasi-shim"],
  binaryen: ["binaryen", "node_modules/binaryen"],
  assemblyscriptBinaryen: ["binaryen", "node_modules/assemblyscript/node_modules/binaryen"],
  typescript: ["typescript", "node_modules/typescript"],
};

export function packageMetadata(key) {
  const [name, lockPath] = packageVersions[key];
  const entry = lock.packages[lockPath];
  return { name, version: entry?.version ?? null, integrity: entry?.integrity ?? null };
}

export function wasmToolchainMetadata() {
  return {
    js2wasm: packageMetadata("js2wasm"),
    assemblyscript: packageMetadata("assemblyscript"),
    wasiShim: packageMetadata("wasiShim"),
    js2Binaryen: packageMetadata("binaryen"),
    assemblyscriptBinaryen: packageMetadata("assemblyscriptBinaryen"),
    typescript: packageMetadata("typescript"),
    wasmtime: { version: WASMTIME_VERSION, archiveSha256: WASMTIME_SHA256 },
  };
}

export function wasmtimeVersion() {
  if (!existsSync(WASMTIME)) throw new Error(`pinned Wasmtime is missing: ${WASMTIME}`);
  const marker = path.join(ROOT, "vendor", "wasmtime", ".archive_sha256");
  if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== WASMTIME_SHA256) {
    throw new Error(`pinned Wasmtime archive checksum marker is missing or incorrect: ${marker}`);
  }
  const result = spawnSync(WASMTIME, ["--version"], { encoding: "utf8", timeout: 10000 });
  if (result.error || result.status !== 0) {
    throw new Error(`cannot query pinned Wasmtime: ${result.error?.message ?? result.stderr}`);
  }
  const version = (result.stdout + result.stderr).trim();
  if (!new RegExp(`\\b${WASMTIME_VERSION.replaceAll(".", "\\.")}\\b`).test(version)) {
    throw new Error(`expected Wasmtime ${WASMTIME_VERSION}, got ${version || "no version output"}`);
  }
  return version;
}

export function wasmtimeBytes() {
  return statSync(WASMTIME).size;
}

export function assertLinuxX64() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`pinned Wasmtime bundle is available only for linux/x64 (got ${process.platform}/${process.arch})`);
  }
}

export function makeWasmtimeCommand(artifactPath, runner) {
  const flags = runner === "js2wasm"
    ? ["-W", "gc=y,function-references=y,tail-call=y,exceptions=y"]
    : [];
  return [WASMTIME, "run", "-C", "cache=n", ...flags, path.resolve(artifactPath)];
}
