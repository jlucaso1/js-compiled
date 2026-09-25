#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { adaptAssemblyScriptSource, ADAPTER_VERSION } from "./assemblyscript-source.mjs";
import { WASMTIME, wasmToolchainMetadata, wasmtimeBytes, wasmtimeVersion, assertLinuxX64 } from "./wasm-toolchain.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ASC = path.join(ROOT, "node_modules", ".bin", "asc");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const fail = (message, status = 1) => { console.error(message); process.exit(status); };

const [sourceArg, outArg] = process.argv.slice(2);
if (!sourceArg || !outArg) fail("usage: assemblyscript-build.mjs <source.ts> <build/runner/artifact.wasm>");
assertLinuxX64();
const source = path.resolve(sourceArg);
const outPath = path.resolve(outArg);
const relOut = path.relative(path.join(ROOT, "build"), outPath);
if (relOut.startsWith("..") || path.isAbsolute(relOut) || !outPath.endsWith(".wasm")) {
  fail("refusing artifact path outside build/ or without .wasm extension");
}
if (!existsSync(source)) fail(`source does not exist: ${source}`);
if (!source.endsWith(".ts")) fail("UNSUPPORTED: AssemblyScript accepts only the canonical TypeScript fixtures in this runner");
const hostVersion = wasmtimeVersion();

const original = readFileSync(source, "utf8");
let input = source;
let sourceMode = "original";
let adaptation = null;
let generatedText = null;
if (path.basename(source) === "10-fib.ts") {
  try {
    const transformed = adaptAssemblyScriptSource(original, source);
    generatedText = transformed.source;
    const generatedDir = path.join(ROOT, "build", "assemblyscript", "generated");
    mkdirSync(generatedDir, { recursive: true });
    input = path.join(generatedDir, "10-fib.generated.ts");
    writeFileSync(input, generatedText);
    sourceMode = "adapted";
    adaptation = { version: ADAPTER_VERSION, rules: transformed.rules, helper: transformed.helperName };
  } catch (error) {
    fail(`UNSUPPORTED: ${error.message}`, 3);
  }
}

const manifestPath = `${outPath}.manifest.json`;
rmSync(outPath, { force: true });
rmSync(manifestPath, { force: true });
const args = [
  input,
  "--lib", "./node_modules/@assemblyscript/wasi-shim/assembly",
  "--use", "ASC_WASI=1",
  "--use", "console=wasi_console",
  "--use", "abort=wasi_abort",
  "--use", "trace=wasi_trace",
  "--use", "seed=wasi_seed",
  "--exportStart", "_start",
  "--runtime", "incremental",
  "-O3",
  "-o", outPath,
];
const compiled = spawnSync(ASC, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (compiled.error) fail(compiled.error.message);
if (compiled.status !== 0) {
  process.stdout.write(compiled.stdout ?? "");
  process.stderr.write(compiled.stderr ?? "");
  process.exit(compiled.status ?? 1);
}
if (!existsSync(outPath) || readFileSync(outPath).length === 0) fail("AssemblyScript did not emit a non-empty Wasm module");

const metadata = wasmToolchainMetadata();
const manifest = {
  artifactKind: "wasm",
  target: "Wasm32/WASI preview1",
  wasmtimeFlags: [],
  wasmtimeCache: "disabled",
  artifactPath: path.relative(ROOT, outPath),
  artifactBytes: readFileSync(outPath).length,
  artifactSha256: hash(readFileSync(outPath)),
  distributionFiles: [{ kind: "wasm-module", path: path.relative(ROOT, outPath), bytes: readFileSync(outPath).length }],
  runtimeDependencies: [{ kind: "wasmtime-host", path: path.relative(ROOT, WASMTIME), bytes: wasmtimeBytes(), version: hostVersion }],
  sourceMode,
  sourcePath: path.relative(ROOT, source),
  sourceSha256: hash(original),
  generatedPath: generatedText === null ? null : path.relative(ROOT, input),
  generatedSha256: generatedText === null ? null : hash(generatedText),
  adaptation,
  compileCommand: ["asc", ...args],
  runtime: "AssemblyScript incremental runtime linked into module; WASI shim",
  toolchain: metadata,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
