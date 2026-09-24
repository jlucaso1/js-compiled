#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./runners.mjs";

const outDir = path.join(ROOT, "build", "jz-native-smoke");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const resultLine = (stdout) => stdout.trim().split(/\r?\n/).findLast((line) => line.startsWith("RESULT "))?.slice(7);
for (const bench of ["00-noop.ts", "10-fib.ts"]) {
  const source = path.join(ROOT, "benches", bench);
  const binary = path.join(outDir, bench.replace(/\.ts$/, ""));
  const built = spawnSync(process.execPath, [path.join(ROOT, "harness", "jz-native-build.mjs"), source, binary], { encoding: "utf8" });
  assert.equal(built.status, 0, `${bench} native build failed:\n${built.stderr}\n${built.stdout}`);
  const native = spawnSync(binary, [], { encoding: "utf8" });
  assert.equal(native.status, 0, `${bench} standalone binary failed: ${native.stderr}`);
  const reference = spawnSync(process.execPath, [source], { encoding: "utf8" });
  assert.equal(reference.status, 0, `${bench} Node reference failed: ${reference.stderr}`);
  const actual = resultLine(native.stdout);
  const expected = resultLine(reference.stdout);
  assert.notEqual(expected, undefined, `${bench}: Node reference omitted RESULT`);
  assert.notEqual(actual, undefined, `${bench}: native executable omitted RESULT`);
  assert.equal(actual, expected, `${bench} native RESULT differs from Node`);
  console.log(`${bench}: native output matches Node (${actual})`);
}
