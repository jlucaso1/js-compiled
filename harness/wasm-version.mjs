#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { packageMetadata, wasmToolchainMetadata, wasmtimeVersion } from "./wasm-toolchain.mjs";
import { isPinnedBinaryen } from "./wasm-build-utils.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const runner = process.argv[2];
const metadata = wasmToolchainMetadata();
const readPackage = (key, installPath = null) => {
  const entry = packageMetadata(key);
  const pkgPath = installPath ?? path.join(ROOT, "node_modules", entry.name, "package.json");
  const installed = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  if (installed !== entry.version) throw new Error(`${entry.name}: lockfile pins ${entry.version}, installed ${installed}`);
  return `${entry.name}@${installed} (npm integrity ${entry.integrity})`;
};
const binaryenVersion = () => {
  const wasmOpt = path.join(ROOT, "node_modules", ".bin", "wasm-opt");
  const result = spawnSync(wasmOpt, ["--version"], { encoding: "utf8", timeout: 10000 });
  const output = (result.stdout + result.stderr).trim();
  if (result.error || result.status !== 0 || !isPinnedBinaryen(output)) {
    throw new Error(`expected pinned Binaryen 132.0.0, got ${output || result.error?.message || "no version output"}`);
  }
  return output;
};

try {
  const host = wasmtimeVersion();
  if (runner === "js2wasm") {
    console.log(`${readPackage("js2wasm")} + Binaryen ${binaryenVersion()} + ${host} (archive SHA-256 ${metadata.wasmtime.archiveSha256})`);
  } else if (runner === "assemblyscript") {
    const ascBinaryen = readPackage("assemblyscriptBinaryen", path.join(ROOT, "node_modules", "assemblyscript", "node_modules", "binaryen", "package.json"));
    console.log(`${readPackage("assemblyscript")} + ${readPackage("wasiShim")} + ${ascBinaryen} + ${readPackage("typescript")} + ${host} (archive SHA-256 ${metadata.wasmtime.archiveSha256})`);
  } else {
    throw new Error(`unknown Wasm runner ${runner}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
