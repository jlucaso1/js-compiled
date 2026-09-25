import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Exercise the public benchmark CLI with a failed compiler and a failed version
// verifier, without requiring Wasmtime or native Wasm builds on the test host.
function runFixture(versionFails) {
  const dir = mkdtempSync(path.join(tmpdir(), "wasm-run-failure-"));
  try {
    mkdirSync(path.join(dir, "harness"));
    mkdirSync(path.join(dir, "benches"));
    for (const file of ["run.mjs", "exec.mjs"]) copyFileSync(path.join(import.meta.dirname, file), path.join(dir, "harness", file));
    writeFileSync(path.join(dir, "benches", "10-fib.ts"), 'console.log("RESULT 7");\n');
    writeFileSync(path.join(dir, "harness", "wasm-toolchain.mjs"), 'export const wasmToolchainMetadata = () => ({wasmtime: {version: "49.0.1"}}); export const wasmtimeVersion = () => "wasmtime 49.0.1";\n');
    writeFileSync(path.join(dir, "compiler.mjs"), 'console.error("adapted input compiler failed"); process.exit(2);\n');
    writeFileSync(path.join(dir, "harness", "runners.mjs"), `import path from "node:path";
export const ROOT = path.resolve(import.meta.dirname, "..");
export const CORE = ["node"];
export const missingDependency = () => null;
export const RUNNERS = {
  node: { mode: "interpreted", version: [process.execPath, "--version"], cmd: (file) => [process.execPath, file] },
  assemblyscript: {
    mode: "compiled", artifactKind: "wasm", artifactExtension: ".wasm",
    sourcePolicy: "original-or-restricted-adaptation",
    version: [process.execPath, "-e", ${JSON.stringify(versionFails ? 'console.error("installed version differs from lockfile"); process.exit(2)' : 'console.log("verified assemblyscript")')}],
    compile: () => [process.execPath, path.join(ROOT, "compiler.mjs")],
  },
};
`);
    const output = path.join(dir, "result.json");
    const result = spawnSync(process.execPath, [path.join(dir, "harness", "run.mjs"), "--runners=assemblyscript", "--benches=10-fib", "--quick", `--out=${output}`], { cwd: dir, encoding: "utf8", timeout: 20000 });
    return { result, data: result.status === 0 ? JSON.parse(readFileSync(output, "utf8")) : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("failed Wasm toolchain verification aborts before benchmarking", () => {
  const { result, data } = runFixture(true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assemblyscript toolchain version verification failed: installed version differs from lockfile/);
  assert.equal(data, null);
});

test("failed AssemblyScript compilation does not claim the original input was compiled", () => {
  const { result, data } = runFixture(false);
  assert.equal(result.status, 0, result.stderr);
  const record = data.benches["10-fib.ts"].runners.assemblyscript;
  assert.equal(record.status, "build-failed");
  assert.equal(record.sourceMode, null);
  assert.equal(record.phase, "build");
  assert.match(record.error, /adapted input compiler failed/);
});
