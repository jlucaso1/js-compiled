#!/usr/bin/env node
// Merges per-bench result shards (one CI job each) into a single result file.
//   node harness/merge.mjs results/shards results/latest.json
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";

const [inDir, outFile = "results/latest.json"] = process.argv.slice(2);
if (!inDir) {
  console.error("usage: node harness/merge.mjs <shard-dir> [out.json]");
  process.exit(1);
}

const files = [];
for (const entry of readdirSync(inDir, { recursive: true })) {
  const p = path.join(inDir, entry);
  if (entry.endsWith(".json") && statSync(p).isFile()) files.push(p);
}
if (!files.length) {
  console.error(`no json files under ${inDir}`);
  process.exit(1);
}

const shards = files.map((f) => JSON.parse(readFileSync(f, "utf8"))).sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt));
const compatibilityKeys = ["commit", "versions", "referenceVersion", "toolchains", "opts", "selectedRunners", "wasmtimeHostVersion"];
const stableMetadata = (meta) => JSON.stringify(Object.fromEntries(compatibilityKeys.map((key) => [key, meta[key] ?? null])));
const baselineMetadata = stableMetadata(shards[0].meta);
for (const shard of shards.slice(1)) {
  if (stableMetadata(shard.meta) !== baselineMetadata) {
    console.error(`incompatible shard toolchain/options metadata for benches ${Object.keys(shard.benches).join(", ")}`);
    process.exit(1);
  }
}

const merged = {
  meta: {
    ...shards[0].meta,
    startedAt: shards[0].meta.startedAt,
    finishedAt: shards[shards.length - 1].meta.finishedAt,
    // Each shard is its own CI job, so every bench compares runners on one
    // machine; across benches the hardware may differ.
    shards: shards.map((s) => ({
      benches: Object.keys(s.benches),
      cpuModel: s.meta.cpuModel,
      cpus: s.meta.cpus,
      spawnOverheadMs: s.meta.spawnOverheadMs?.median ?? null,
      versions: s.meta.versions ?? {},
      referenceVersion: s.meta.referenceVersion ?? null,
      toolchains: s.meta.toolchains ?? null,
      opts: s.meta.opts ?? null,
      selectedRunners: s.meta.selectedRunners ?? null,
      commit: s.meta.commit ?? null,
      wasmtimeHostVersion: s.meta.wasmtimeHostVersion ?? null,
    })),
  },
  benches: {},
};
for (const s of shards) Object.assign(merged.benches, s.benches);
merged.benches = Object.fromEntries(Object.entries(merged.benches).sort(([a], [b]) => a.localeCompare(b)));

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n");
console.log(`merged ${shards.length} shards, ${Object.keys(merged.benches).length} benches -> ${outFile}`);
