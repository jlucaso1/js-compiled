#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WASMTIME, wasmToolchainMetadata, wasmtimeBytes, wasmtimeVersion, assertLinuxX64 } from "./wasm-toolchain.mjs";
import { isPinnedBinaryen, js2ArtifactName, optimizerSkipped } from "./wasm-build-utils.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = (name) => path.join(ROOT, "node_modules", ".bin", name);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const fail = (message) => { console.error(message); process.exit(1); };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) fail(result.error.message);
  return result;
}

const [sourceArg, outArg] = process.argv.slice(2);
if (!sourceArg || !outArg) fail("usage: js2wasm-build.mjs <source> <build/runner/artifact.wasm>");
assertLinuxX64();
const source = path.resolve(sourceArg);
const outPath = path.resolve(outArg);
const relOut = path.relative(path.join(ROOT, "build"), outPath);
if (relOut.startsWith("..") || path.isAbsolute(relOut) || !outPath.endsWith(".wasm")) {
  fail("refusing artifact path outside build/ or without .wasm extension");
}
if (!existsSync(source)) fail(`source does not exist: ${source}`);
const hostVersion = wasmtimeVersion();

const wasmOpt = BIN("wasm-opt");
if (!existsSync(wasmOpt)) fail("pinned Binaryen wasm-opt is missing; refusing to claim -O3 optimization");
const optVersion = run(wasmOpt, ["--version"], { cwd: ROOT });
const optText = (optVersion.stdout + optVersion.stderr).trim();
if (optVersion.status !== 0 || !isPinnedBinaryen(optText)) {
  fail(`expected Binaryen wasm-opt 132.0.0, got ${optText || "no version output"}`);
}

const outDir = `${outPath}.js2-output`;
const manifestPath = `${outPath}.manifest.json`;
rmSync(outPath, { force: true });
rmSync(manifestPath, { force: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const basename = js2ArtifactName(source);
const expectedOutput = path.join(outDir, basename);
const args = [source, "--target", "wasi", "-O3", "--no-wat", "--no-dts", "-o", outDir];
const env = {
  ...process.env,
  PATH: `${path.dirname(wasmOpt)}${path.delimiter}${process.env.PATH ?? ""}`,
};
const compiled = run(BIN("js2wasm"), args, { cwd: ROOT, env });
const log = `${compiled.stdout ?? ""}\n${compiled.stderr ?? ""}`;
if (compiled.error) fail(compiled.error.message);
if (compiled.status !== 0) {
  process.stdout.write(compiled.stdout ?? "");
  process.stderr.write(compiled.stderr ?? "");
  process.exit(compiled.status ?? 1);
}
if (optimizerSkipped(log)) {
  fail(`js2wasm reported that requested -O3 optimization was skipped: ${log.trim()}`);
}
if (!existsSync(expectedOutput)) {
  const names = existsSync(outDir) ? readdirSync(outDir).join(", ") : "missing output directory";
  fail(`js2wasm did not emit expected ${basename} in its output directory (found: ${names || "nothing"})`);
}
writeFileSync(outPath, readFileSync(expectedOutput));
if (!existsSync(outPath) || readFileSync(outPath).length === 0) fail("js2wasm emitted an empty Wasm module");
const sourceText = readFileSync(source, "utf8");
const metadata = wasmToolchainMetadata();
const manifest = {
  artifactKind: "wasm",
  target: "WasmGC/WASI preview1",
  wasmtimeFlags: ["-W", "gc=y,function-references=y,tail-call=y,exceptions=y"],
  wasmtimeCache: "disabled",
  runtime: "pinned Wasmtime WASI host process",
  artifactPath: path.relative(ROOT, outPath),
  artifactBytes: readFileSync(outPath).length,
  artifactSha256: hash(readFileSync(outPath)),
  distributionFiles: [{ kind: "wasm-module", path: path.relative(ROOT, outPath), bytes: readFileSync(outPath).length }],
  runtimeDependencies: [{ kind: "wasmtime-host", path: path.relative(ROOT, WASMTIME), bytes: wasmtimeBytes(), version: hostVersion }],
  sourceMode: "original",
  sourcePath: path.relative(ROOT, source),
  sourceSha256: hash(sourceText),
  generatedSha256: null,
  adaptation: null,
  compileCommand: ["js2wasm", ...args.slice(1)],
  optimization: { requested: "-O3", binaryen: optText, warningScanPassed: true },
  toolchain: metadata,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
rmSync(outDir, { recursive: true, force: true });
