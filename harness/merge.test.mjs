import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

function shard(bench, startedAt, versions = { node: "v24", js2wasm: "0.71.0" }) {
  return {
    meta: {
      startedAt, finishedAt: startedAt, versions,
      toolchains: { wasmtime: { version: "49.0.1" } },
      opts: { runs: 2, warmup: 1, rssRuns: 2 },
      selectedRunners: ["node", "js2wasm"],
      wasmtimeHostVersion: "wasmtime 49.0.1",
    },
    benches: { [bench]: { file: bench, runners: {} } },
  };
}

function merge(dir, output) {
  return spawnSync(process.execPath, [path.join(ROOT, "harness", "merge.mjs"), dir, output], { encoding: "utf8" });
}

test("merge preserves per-shard toolchain/options metadata", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "merge-wasm-"));
  try {
    const shards = path.join(dir, "shards");
    mkdirSync(shards);
    writeFileSync(path.join(shards, "a.json"), JSON.stringify(shard("00-noop.ts", "2026-01-01T00:00:00.000Z")));
    writeFileSync(path.join(shards, "b.json"), JSON.stringify(shard("01-hello.ts", "2026-01-01T00:01:00.000Z")));
    const output = path.join(dir, "merged.json");
    const result = merge(shards, output);
    assert.equal(result.status, 0, result.stderr);
    const merged = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(merged.meta.shards.length, 2);
    assert.equal(merged.meta.shards[0].toolchains.wasmtime.version, "49.0.1");
    assert.deepEqual(merged.meta.shards[0].opts, { runs: 2, warmup: 1, rssRuns: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merge rejects shards with different pinned runner versions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "merge-incompatible-"));
  try {
    const shards = path.join(dir, "shards");
    mkdirSync(shards);
    writeFileSync(path.join(shards, "a.json"), JSON.stringify(shard("00-noop.ts", "2026-01-01T00:00:00.000Z")));
    writeFileSync(path.join(shards, "b.json"), JSON.stringify(shard("01-hello.ts", "2026-01-01T00:01:00.000Z", { node: "v24", js2wasm: "0.72.0" })));
    const result = merge(shards, path.join(dir, "merged.json"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /incompatible shard toolchain\/options metadata/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
