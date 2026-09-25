import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptAssemblyScriptSource, formatSafeIntegerResult } from "./assemblyscript-source.mjs";

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

test("safe integer result formatting preserves JS integer spelling and rejects unsafe values", () => {
  assert.equal(formatSafeIntegerResult(0), "0");
  assert.equal(formatSafeIntegerResult(-0), "0");
  assert.equal(formatSafeIntegerResult(-7), "-7");
  assert.equal(formatSafeIntegerResult(Number.MAX_SAFE_INTEGER), "9007199254740991");
  assert.equal(formatSafeIntegerResult(Number.MIN_SAFE_INTEGER), "-9007199254740991");
  for (const value of [1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
    assert.throws(() => formatSafeIntegerResult(value), RangeError, `expected rejection for ${value}`);
  }
});
