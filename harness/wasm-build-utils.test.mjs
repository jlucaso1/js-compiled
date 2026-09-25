import assert from "node:assert/strict";
import test from "node:test";
import { isPinnedBinaryen, js2ArtifactName, optimizerSkipped } from "./wasm-build-utils.mjs";
import { makeWasmtimeCommand, WASMTIME_SHA256, WASMTIME_VERSION } from "./wasm-toolchain.mjs";

test("js2wasm output naming and Binaryen version are explicit", () => {
  assert.equal(js2ArtifactName("/bench folder/10-fib.ts"), "10-fib.wasm");
  assert.equal(js2ArtifactName("hello.js"), "hello.wasm");
  assert.equal(isPinnedBinaryen("wasm-opt version 132 (version_132)"), true);
  assert.equal(isPinnedBinaryen("wasm-opt version 131"), false);
});

test("a skipped or unavailable -O3 optimizer is rejected", () => {
  for (const log of [
    "warning: Binaryen not found, skipping optimization",
    "wasm-opt is not available; optimization skipped",
    "Optimization not performed because binaryen is missing",
    "wasm-opt produced an invalid binary; shipping unoptimized output instead",
    "wasm-opt -O3 FAILED: shipping UNOPTIMIZED binary",
  ]) assert.equal(optimizerSkipped(log), true, log);
  assert.equal(optimizerSkipped("optimized with Binaryen wasm-opt"), false);
});

test("Wasm execution commands use pinned Wasmtime and disable its cache", () => {
  assert.equal(WASMTIME_VERSION, "49.0.1");
  assert.match(WASMTIME_SHA256, /^[a-f0-9]{64}$/);
  assert.deepEqual(makeWasmtimeCommand("build/f.wasm", "js2wasm").slice(1, -1), [
    "run", "-C", "cache=n", "-W", "gc=y,function-references=y,tail-call=y,exceptions=y",
  ]);
  assert.deepEqual(makeWasmtimeCommand("build/f.wasm", "assemblyscript").slice(1, -1), ["run", "-C", "cache=n"]);
});
