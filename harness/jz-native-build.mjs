#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ROOT } from "./runners.mjs";
import { adaptNumericResult } from "./jz-native-source.mjs";

const [sourceFile, outputFile] = process.argv.slice(2);
if (!sourceFile || !outputFile) {
  console.error("usage: node harness/jz-native-build.mjs <source.js> <standalone-output>");
  process.exit(2);
}
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? (result.stderr || result.stdout || `${command} exited ${result.status}`).trim());
  }
  return result.stdout;
};
const fail = (message) => { console.error(message); process.exit(1); };
const jzDir = path.join(ROOT, "vendor", "jz");
const wabtDir = path.join(ROOT, "vendor", "wabt");
const wasm2c = path.join(wabtDir, "build", "wasm2c");
const runtimeDir = path.join(wabtDir, "wasm2c");
if (!existsSync(path.join(jzDir, "index.js")) || !existsSync(wasm2c)) fail("jz-native toolchain is not set up; run scripts/setup-jz-native.sh");

const source = readFileSync(sourceFile, "utf8");
let adapted;
try { adapted = adaptNumericResult(source); }
catch (error) { fail(error.message); }

let wasm;
try {
  const { compile } = await import(pathToFileURL(path.join(jzDir, "index.js")).href);
  // Keep module initialization in the measured executable. Snapshotting it
  // would move the top-level benchmark computation into compile time.
  wasm = compile(adapted, { host: "native", optimize: { level: "speed", snapshotInit: false } });
} catch (error) {
  fail(`jz compile failed: ${error?.message ?? error}`);
}
const module = new WebAssembly.Module(wasm);
const imports = WebAssembly.Module.imports(module);
if (imports.length) fail(`unsupported native imports: ${imports.map((x) => `${x.module}.${x.name}`).join(", ")}`);
const exports = WebAssembly.Module.exports(module).map((x) => x.name);
if (!exports.includes("benchResult")) fail("jz output did not export benchResult");

const dir = path.dirname(outputFile);
mkdirSync(dir, { recursive: true });
const wasmFile = `${outputFile}.wasm`;
const cFile = `${outputFile}.c`;
const mainFile = `${outputFile}-main.c`;
writeFileSync(wasmFile, wasm);
run(wasm2c, ["--enable-exceptions", "-n", "jzbench", "-o", cFile, wasmFile]);
writeFileSync(mainFile, `#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\n#include "jzbench.h"\n#include "wasm-rt-impl.h"\nint main(void) {\n  wasm_rt_init();\n  w2c_jzbench instance;\n  wasm2c_jzbench_instantiate(&instance);\n  u64 bits = w2c_jzbench_benchResult(&instance);\n  double result;\n  memcpy(&result, &bits, sizeof(result));\n  printf("RESULT %.17g\\n", result);\n  wasm2c_jzbench_free(&instance);\n  wasm_rt_free();\n  return 0;\n}\n`);
run("clang", [
  "-O3", "-I", runtimeDir, "-I", dir, cFile, mainFile,
  path.join(runtimeDir, "wasm-rt-impl.c"),
  path.join(runtimeDir, "wasm-rt-mem-impl.c"),
  path.join(runtimeDir, "wasm-rt-exceptions-impl.c"),
  "-lm", "-lpthread", "-o", outputFile,
]);
chmodSync(outputFile, 0o755);
