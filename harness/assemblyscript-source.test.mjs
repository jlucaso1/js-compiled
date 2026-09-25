import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { WASI } from "node:wasi";
import asc from "assemblyscript/asc";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptAssemblyScriptSource } from "./assemblyscript-source.mjs";

function withSource(source, callback) {
  const dir = mkdtempSync(path.join(tmpdir(), "as-source-adapter-"));
  const file = path.join(dir, "fixture.ts");
  writeFileSync(file, source);
  try { return callback(file); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("AST adapter preserves canonical bytes and evaluates one statically numeric RESULT expression once", () => {
  const source = "let acc: number = 5;\nacc += 3;\nconsole.log(\"RESULT \" + acc);\n";
  withSource(source, (file) => {
    const adapted = adaptAssemblyScriptSource(source, file);
    assert.equal(readFileSync(file, "utf8"), source);
    assert.equal(adapted.source.slice(0, adapted.source.indexOf("__assemblyscriptResultAdapter(")), "let acc: number = 5;\nacc += 3;\n");
    assert.equal((adapted.source.match(/__assemblyscriptResultAdapter\(acc\)/g) ?? []).length, 1);
    assert.match(adapted.source, /assert\(isFinite\(value\).*9007199254740991/);
    assert.match(adapted.source, /i64\(value\)\.toString\(\)/);
    assert.deepEqual(adapted.rules, [
      "replace only the final RESULT concatenation with a single helper call",
      "require TypeScript checker to infer a numeric result",
      "assert finite safe-integer value at runtime before integer formatting",
      "preserve all preceding source text and evaluate the result expression once",
    ]);
  });
});

test("AST adapter rejects malformed output, shadowed console, and unknown/non-numeric values", () => {
  const rejected = [
    ["console.log(\"RESULT \" + 1); console.log(\"later\");", /final console\.log/],
    ["const console = { log() {} }; console.log(\"RESULT \" + 1);", /console.*shadowed/],
    ["let value: any = 1; console.log(\"RESULT \" + value);", /not statically known/],
    ["console.log(\"RESULT \" + \"one\");", /not statically known/],
    ["console.log(\"RESULT\" + 1);", /final console\.log/],
  ];
  for (const [source, expected] of rejected) {
    withSource(source, (file) => assert.throws(() => adaptAssemblyScriptSource(source, file), expected));
  }
});

test("generated adaptation changes with benchmark source rather than a baked result", () => {
  const first = "let value: number = 11;\nconsole.log(\"RESULT \" + value);\n";
  const changed = "let value: number = 12;\nconsole.log(\"RESULT \" + value);\n";
  withSource(first, (file) => {
    const one = adaptAssemblyScriptSource(first, file).source;
    writeFileSync(file, changed);
    const two = adaptAssemblyScriptSource(changed, file).source;
    assert.notEqual(one, two);
    assert.match(one, /value: number = 11/);
    assert.match(two, /value: number = 12/);
    assert.doesNotMatch(two, /RESULT 12/);
  });
});

test("adapter chooses a collision-free generated helper name", () => {
  const source = "let __assemblyscriptResultAdapter: number = 1;\nconsole.log(\"RESULT \" + __assemblyscriptResultAdapter);\n";
  withSource(source, (file) => {
    const adapted = adaptAssemblyScriptSource(source, file);
    assert.equal(adapted.helperName, "__assemblyscriptResultAdapter1");
    assert.match(adapted.source, /__assemblyscriptResultAdapter1\(__assemblyscriptResultAdapter\)/);
  });
});

async function executeAdaptedSource(source) {
  const root = path.resolve(import.meta.dirname, "..");
  const build = path.join(root, "build");
  mkdirSync(build, { recursive: true });
  const dir = mkdtempSync(path.join(build, "as-formatter-test-"));
  const descriptors = [];
  try {
    const file = path.join(dir, "fixture.ts");
    writeFileSync(file, source);
    const adapted = adaptAssemblyScriptSource(source, file);
    const generated = path.join(dir, "generated.ts");
    const wasm = path.join(dir, "fixture.wasm");
    writeFileSync(generated, adapted.source);
    const compiled = await asc.main([
      generated,
      "--baseDir", root,
      "--lib", "./node_modules/@assemblyscript/wasi-shim/assembly",
      "--use", "ASC_WASI=1", "--use", "console=wasi_console",
      "--use", "abort=wasi_abort", "--use", "trace=wasi_trace",
      "--use", "seed=wasi_seed", "--exportStart", "_start",
      "--runtime", "incremental", "-O3", "-o", wasm,
    ]);
    assert.equal(compiled.error, null, compiled.stderr.toString());
    const stdoutPath = path.join(dir, "stdout");
    const stderrPath = path.join(dir, "stderr");
    const stdout = openSync(stdoutPath, "w+");
    descriptors.push(stdout);
    const stderr = openSync(stderrPath, "w+");
    descriptors.push(stderr);
    const wasi = new WASI({ version: "preview1", returnOnExit: true, stdout, stderr });
    const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    const status = wasi.start(instance);
    return { status, stdout: readFileSync(stdoutPath, "utf8"), stderr: readFileSync(stderrPath, "utf8") };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("generated AssemblyScript formatter preserves canonical Fibonacci parity", async () => {
  const file = path.resolve(import.meta.dirname, "../benches/10-fib.ts");
  const source = readFileSync(file, "utf8");
  const expected = execFileSync(process.execPath, [file], { encoding: "utf8" });
  const result = await executeAdaptedSource(source);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
});

test("generated AssemblyScript formatter preserves JS safe integer spelling", async () => {
  for (const literal of ["0", "-0", "-7", "9007199254740991", "-9007199254740991"]) {
    const source = `let value: number = ${literal};\nconsole.log("RESULT " + value);\n`;
    const result = await executeAdaptedSource(source);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `RESULT ${Number(literal)}\n`, literal);
    assert.equal(result.stderr, "");
  }
});

test("generated AssemblyScript formatter rejects non-finite and non-safe integers", async () => {
  for (const literal of ["1.5", "NaN", "Infinity", "-Infinity", "9007199254740992", "-9007199254740992"]) {
    const source = `let value: number = ${literal};\nconsole.log("RESULT " + value);\n`;
    const result = await executeAdaptedSource(source);
    assert.equal(result.status, 255, `${literal}: ${result.stderr}`);
    assert.equal(result.stdout, "", literal);
  }
});
