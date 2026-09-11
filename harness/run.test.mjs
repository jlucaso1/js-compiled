import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const supported = ["linux", "darwin"].includes(process.platform);

function runtime() {
  const fs = require("node:fs");
  const count = process.argv[1] + ".count";
  const n = fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) + 1 : 1;
  fs.writeFileSync(count, String(n));
  const failAt = { check: 1, warmup: 2, timing: 2, rss: 3 }[process.env.FIXTURE_PHASE];
  if (n === failAt) {
    const held = [];
    setInterval(() => held.push(Buffer.alloc(16 * 1024 * 1024, 1)), 25);
  } else {
    console.log("RESULT " + process.env.FIXTURE_OUTPUT);
  }
}

async function fixture({ phase = "none", runners = "perry", warmup = 0, output = "7" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "js-compiled-harness-"));
  try {
    mkdirSync(path.join(dir, "harness"));
    mkdirSync(path.join(dir, "benches"));
    for (const file of ["run.mjs", "exec.mjs", "runners.mjs", "report.mjs"]) {
      copyFileSync(path.join(import.meta.dirname, file), path.join(dir, "harness", file));
    }
    writeFileSync(path.join(dir, "benches", "test.ts"), 'console.log("RESULT 7");\n');
    const compiler = path.join(dir, "compiler.mjs");
    writeFileSync(compiler, `#!${process.execPath}
import { rmSync, writeFileSync } from "node:fs";
if (process.argv.includes("--version")) { console.log("fixture 1"); process.exit(0); }
const out = process.argv[process.argv.indexOf("-o") + 1];
const count = out + ".count";
rmSync(count, {force: true});
const phase = process.env.FIXTURE_PHASE;
writeFileSync(out, ${JSON.stringify(`#!${process.execPath}\n(${runtime.toString()})();\n`)}, {mode: 0o755});
if (phase === "build") { console.error("fixture build failed after writing output"); process.exit(2); }
`, { mode: 0o755 });
    const argv = [path.join(dir, "harness", "run.mjs"), `--runners=${runners}`, "--runs=1", `--warmup=${warmup}`, "--rss-runs=1", "--timeout=3", "--build-timeout=3", "--mem-limit-mb=192"];
    const log = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, argv, {
        cwd: dir, env: { ...process.env, PERRY_BIN: compiler, FIXTURE_PHASE: phase, FIXTURE_OUTPUT: output },
      });
      let log = "";
      child.stdout.on("data", (c) => { log += c; });
      child.stderr.on("data", (c) => { log += c; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(log) : reject(new Error(log)));
    });
    const results = JSON.parse(readFileSync(path.join(dir, "results", "latest.json"), "utf8"));
    const report = spawnSync(process.execPath, [path.join(dir, "harness", "report.mjs")], { cwd: dir, encoding: "utf8" });
    assert.equal(report.status, 0, report.stderr);
    const markdown = readFileSync(path.join(dir, "results", "REPORT.md"), "utf8");
    return { result: results.benches["test.ts"].runners.perry, reference: results.benches["test.ts"].reference, log, markdown };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("compiler nonzero exit fails even when it wrote a binary", { skip: !supported }, async () => {
  const { result } = await fixture({ phase: "build" });
  assert.equal(result.status, "build-failed");
  assert.equal(result.phase, "build");
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, undefined);
});

for (const phase of ["check", "warmup", "timing", "rss"]) {
  test(`memory limit failure in ${phase} is retained in result JSON`, { skip: !supported }, async () => {
    const { result, log } = await fixture({ phase, warmup: phase === "warmup" ? 1 : 0 });
    assert.equal(result.status, "out-of-memory", log);
    assert.equal(result.phase, phase);
    assert.ok(result.peakKb > 192 * 1024);
    assert.equal(result.maxRssKb ?? null, null);
  });
}

for (const runners of ["perry", "perry,node"]) {
  test(`Node is the oracle when runners=${runners}`, { skip: !supported }, async () => {
    const { result, reference, markdown } = await fixture({ runners, output: "9" });
    assert.equal(result.status, "ok");
    assert.equal(result.matchesReference, false);
    assert.equal(reference.output, "7");
    assert.match(markdown, /expected 7, got 9/);
    const timing = markdown.split("## Execution time")[1].split("## Peak memory")[0];
    assert.match(timing, /^\| test\s*\|.*\s-\s*\|$/m, "mismatched Perry result must not appear as a timing win");
  });
}
