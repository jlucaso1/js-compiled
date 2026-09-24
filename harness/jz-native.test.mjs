import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, RUNNERS } from "./runners.mjs";
import { adaptNumericResult } from "./jz-native-source.mjs";

test("jz-native wiring names the actual standalone compilation stages", () => {
  const runner = RUNNERS["jz-native"];
  assert.equal(runner.mode, "compiled");
  assert.equal(runner.tier, "extra");
  assert.match(runner.label, /jz.*wasm2c.*clang -O3/);
  assert.equal(runner.supports("00-noop.ts"), null);
  assert.equal(runner.supports("10-fib.ts"), null);
  assert.match(runner.supports("01-hello.ts"), /single numeric RESULT/);
});

test("jz-native adapts only a single final numeric RESULT and rejects extra output", () => {
  const noop = readFileSync(path.join(ROOT, "benches", "00-noop.ts"), "utf8");
  const fib = readFileSync(path.join(ROOT, "benches", "10-fib.ts"), "utf8");
  const hello = readFileSync(path.join(ROOT, "benches", "01-hello.ts"), "utf8");
  assert.match(adaptNumericResult(noop), /export function benchResult\(\) \{ return \(0\); \}/);
  assert.match(adaptNumericResult(fib), /acc\); \}/);
  assert.throws(() => adaptNumericResult(hello), /unsupported output/);
});

test("jz-native adapts typed functions and variables into executable JavaScript", async () => {
  const source = `function fib(n: number): number {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
  }
  let acc: number = 0;
  for (let i: number = 0; i < 6; i++) acc += fib(3 + i);
  console.log("RESULT " + acc);`;
  const adapted = adaptNumericResult(source);
  const module = await import(`data:text/javascript,${encodeURIComponent(adapted)}`);
  assert.equal(module.benchResult(), 52);
});
