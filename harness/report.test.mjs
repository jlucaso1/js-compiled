import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

test("report distinguishes adapted Wasm input and excludes mismatches from every ranking", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "report-wasm-"));
  try {
    const input = path.join(dir, "input.json");
    const md = path.join(dir, "REPORT.md");
    const html = path.join(dir, "index.html");
    const wasm = (fields = {}) => ({
      mode: "compiled", artifactKind: "wasm", status: "ok", matchesReference: true,
      sourceMode: "original", sourcePath: "benches/test.ts", sourceSha256: "a".repeat(64),
      moduleBytes: 1000, hostBytes: 20000000, maxRssKb: 1000,
      time: { min: 2, max: 2, mean: 2, median: 2, stddev: 0, runs: 2 }, buildMs: 10,
      ...fields,
    });
    const data = {
      meta: {
        startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
        cpuModel: "test cpu", cpus: 2, totalMemGb: 2, platform: "linux", arch: "x64",
        opts: { runs: 2, warmup: 1, rssRuns: 2 }, spawnOverheadMs: { median: 0.1 },
        wasmtimeHostVersion: "wasmtime 49.0.1",
        toolchains: { wasmtime: { version: "49.0.1" } },
      },
      benches: {
        "test.ts": {
          file: "test.ts", reference: { version: "node test", output: "7" },
          runners: {
            node: { mode: "interpreted", status: "ok", matchesReference: true, time: { min: 10, max: 10, mean: 10, median: 10, stddev: 0, runs: 2 }, maxRssKb: 1000, output: "7" },
            js2wasm: wasm({ matchesReference: false, output: "8", sourceSha256: undefined }),
            assemblyscript: wasm({ sourceMode: "adapted", sourcePath: "benches/test.ts", generatedPath: "build/assemblyscript/generated/test.ts", generatedSha256: "b".repeat(64), adaptation: { version: "assemblyscript-result-v1" } }),
          },
        },
      },
    };
    writeFileSync(input, JSON.stringify(data));
    const run = spawnSync(process.execPath, [path.join(ROOT, "harness", "report.mjs"), input, `--md=${md}`, `--html=${html}`], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const markdown = readFileSync(md, "utf8");
    const page = readFileSync(html, "utf8");
    assert.match(markdown, /Wasm input provenance/);
    assert.match(markdown, /adapted/);
    assert.match(markdown, /assemblyscript-result-v1/);
    assert.match(markdown, /original-input passing \(Wasm\)/);
    assert.match(markdown, /adapted-input passing \(Wasm\)/);
    assert.match(markdown, /bbbbbbbbbbbbbbbb/);
    const timing = markdown.split("## Execution time")[1].split("## Peak memory")[0];
    assert.match(timing, /\| test\s+\|[^\n]*\s-\s+\|[^\n]*2\.00/);
    const moduleSize = markdown.split("## Wasm module size")[1].split("## Wasm host executable size")[0];
    assert.match(moduleSize, /\| test\s+\|\s+-\s+\|\s+\*\*0\.001\*\*/);
    assert.match(markdown, /output differs/);
    assert.match(page, /Wasm\/WASI input provenance/);
    assert.match(page, /not a self-contained Wasm executable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
