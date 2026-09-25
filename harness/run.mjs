#!/usr/bin/env node
// Runs every (bench, runner) pair and writes a JSON result file.
process.removeAllListeners("warning");
import { createHash } from "node:crypto";
import { readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { RUNNERS, CORE, ROOT, missingDependency } from "./runners.mjs";
import { wasmToolchainMetadata, wasmtimeVersion } from "./wasm-toolchain.mjs";
import { timeRun, rssRun, stats } from "./exec.mjs";

const BENCH_DIR = path.join(ROOT, "benches");
const BUILD_DIR = path.join(ROOT, "build");
const STRIPPED_DIR = path.join(BUILD_DIR, "_stripped");
const RESULT_DIR = path.join(ROOT, "results");

const opts = {
  runners: CORE,
  benches: null,
  runs: 5,
  warmup: 1,
  rssRuns: 2,
  timeout: 300,
  buildTimeout: 300,
  memLimitMb: 4096,
  out: null,
  list: false,
};

for (const a of process.argv.slice(2)) {
  const i = a.indexOf("=");
  const [k, v] = i === -1 ? [a, null] : [a.slice(0, i), a.slice(i + 1)];
  if (k === "--runners") opts.runners = v === "all" ? Object.keys(RUNNERS) : v.split(",");
  else if (k === "--benches") opts.benches = v.split(",");
  else if (k === "--runs") opts.runs = Number(v);
  else if (k === "--warmup") opts.warmup = Number(v);
  else if (k === "--rss-runs") opts.rssRuns = Number(v);
  else if (k === "--timeout") opts.timeout = Number(v);
  else if (k === "--build-timeout") opts.buildTimeout = Number(v);
  else if (k === "--mem-limit-mb") opts.memLimitMb = Number(v);
  else if (k === "--out") opts.out = v;
  else if (k === "--list") opts.list = true;
  else if (k === "--quick") Object.assign(opts, { runs: 1, warmup: 0, rssRuns: 1 });
  else if (k === "--help" || k === "-h") {
    console.log(`usage: node harness/run.mjs [flags]

  --runners=a,b,c    default: ${CORE.join(",")} (use "all" for every runner)
  --benches=x,y      filter benches by substring
  --runs=N           timed runs per pair (default 5)
  --warmup=N         discarded runs before timing (default 1)
  --rss-runs=N       runs under GNU time for peak RSS (default 2)
  --timeout=S        per-run timeout in seconds (default 300)
  --build-timeout=S  per-build timeout in seconds (default 300)
  --mem-limit-mb=N   kill a run above this RSS, 0 disables (default 4096)
  --quick            --runs=1 --warmup=0 --rss-runs=1
  --out=FILE         result JSON path
  --list             list benches and runners`);
    process.exit(0);
  } else {
    console.error(`unknown flag: ${a}`);
    process.exit(1);
  }
}

const allBenches = readdirSync(BENCH_DIR).filter((f) => /\.(ts|js)$/.test(f)).sort();
const benches = opts.benches ? allBenches.filter((f) => opts.benches.some((p) => f.includes(p))) : allBenches;

if (opts.list) {
  console.log("benches:\n  " + allBenches.join("\n  "));
  console.log("\nrunners:");
  for (const [k, v] of Object.entries(RUNNERS)) console.log(`  ${k.padEnd(17)} ${v.mode.padEnd(12)} ${(v.artifactKind ?? "").padEnd(6)} ${v.tier}`);
  process.exit(0);
}
if (!benches.length) {
  console.error("no benches matched");
  process.exit(1);
}
for (const n of opts.runners) {
  if (!RUNNERS[n]) {
    console.error(`unknown runner: ${n}`);
    process.exit(1);
  }
}

const active = [];
const unavailable = new Map();
for (const name of opts.runners) {
  const missing = missingDependency(name);
  if (missing) {
    unavailable.set(name, missing);
    console.error(`unavailable ${name}: missing ${missing} (run scripts/setup.sh)`);
  } else active.push(name);
}
// A selected runner must never become its own correctness oracle.
const nodeIndex = active.indexOf("node");
if (nodeIndex > 0) {
  active.splice(nodeIndex, 1);
  active.unshift("node");
}

// Backstop for the RSS watchdog: children inherit oom_score_adj, so if a runner
// outruns the poll interval the kernel picks it, not the machine.
try {
  writeFileSync("/proc/self/oom_score_adj", "1000");
} catch {}

const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const firstLines = (t, n = 4) => clean(t).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n).join(" | ");

const limitKb = opts.memLimitMb * 1024;

function failure(r, phase) {
  const timeout = phase === "build" ? opts.buildTimeout : opts.timeout;
  return {
    status: r.memExceeded ? "out-of-memory" : r.timedOut ? "timeout" : phase === "build" ? "build-failed" : "run-failed",
    phase,
    exitCode: r.exitCode,
    signal: r.signal,
    peakKb: r.peakKb,
    error: r.memExceeded
      ? `exceeded ${opts.memLimitMb} MB RSS (peaked at ${Math.round(r.peakKb / 1024)} MB)`
      : r.timedOut ? `timeout > ${timeout}s`
      : r.spawnError || firstLines(r.stderr || r.stdout) || `exit ${r.exitCode}, signal ${r.signal}`,
  };
}

async function version(name) {
  const r = await timeRun(RUNNERS[name].version, { timeoutMs: 60000 });
  const lines = clean(r.stdout + r.stderr).trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const matched = lines.find((l) => l.includes("Static Hermes"));
  return matched || lines[0] || "unknown";
}

// Type annotations have no runtime meaning; stripping them only removes syntax
// a compiler front end may choke on.
function sourceFor(runner, bench) {
  const abs = path.join(BENCH_DIR, bench);
  if (runner.source !== "stripped-js" || !bench.endsWith(".ts")) return abs;
  mkdirSync(STRIPPED_DIR, { recursive: true });
  const out = path.join(STRIPPED_DIR, bench.replace(/\.ts$/, ".js"));
  writeFileSync(out, stripTypeScriptTypes(readFileSync(abs, "utf8"), { mode: "strip" }));
  return out;
}

async function build(name, runner, bench) {
  const outDir = path.join(BUILD_DIR, name);
  mkdirSync(outDir, { recursive: true });
  const extension = runner.artifactExtension ?? "";
  const outPath = path.join(outDir, path.basename(bench).replace(/\.(ts|js)$/, "") + extension);
  const manifestPath = `${outPath}.manifest.json`;
  rmSync(outPath, { force: true });
  rmSync(manifestPath, { force: true });
  const r = await timeRun(runner.compile(sourceFor(runner, bench), outPath), {
    cwd: BUILD_DIR,
    timeoutMs: opts.buildTimeout * 1000,
    memLimitKb: limitKb,
  });
  if (!r.ok || !existsSync(outPath)) {
    const unsupported = runner.unsupportedBuildMarker && `${r.stdout ?? ""}\n${r.stderr ?? ""}`.includes(runner.unsupportedBuildMarker);
    const failed = failure(r, "build");
    return {
      ok: false,
      buildMs: r.wallMs,
      ...failed,
      ...(unsupported ? { status: "unsupported", phase: "adapt", error: `${r.stderr ?? ""}`.trim().replace(/^UNSUPPORTED:\s*/, "") } : {}),
    };
  }
  let manifest = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (path.resolve(ROOT, manifest.artifactPath) !== path.resolve(outPath)) {
      return { ok: false, buildMs: r.wallMs, status: "build-failed", phase: "build", error: "build manifest artifact path does not match requested output" };
    }
    if (manifest.artifactBytes !== statSync(outPath).size) {
      return { ok: false, buildMs: r.wallMs, status: "build-failed", phase: "build", error: "build manifest artifact size does not match emitted file" };
    }
    if (runner.artifactKind === "wasm") {
      const host = manifest.runtimeDependencies?.find((dependency) => dependency.kind === "wasmtime-host");
      if (!host || path.resolve(ROOT, host.path) !== path.resolve(runner.hostExecutable) || host.bytes !== runner.hostBytes() || !host.version?.includes(toolchains.wasmtime.version)) {
        return { ok: false, buildMs: r.wallMs, status: "build-failed", phase: "build", error: "build manifest does not identify the pinned Wasmtime host and size" };
      }
    }
  }
  const bytes = statSync(outPath).size;
  return {
    ok: true,
    outPath,
    buildMs: r.wallMs,
    manifest,
    ...(runner.artifactKind === "wasm"
      ? { moduleBytes: bytes, hostBytes: runner.hostBytes(), hostExecutable: runner.hostExecutable }
      : { binBytes: bytes }),
  };
}

function resultLine(stdout) {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith("RESULT ")) return l.slice(7).trim();
  }
  return null;
}

mkdirSync(BUILD_DIR, { recursive: true });
mkdirSync(RESULT_DIR, { recursive: true });

const versions = Object.fromEntries(await Promise.all(active.map(async (n) => [n, await version(n)])));
const referenceVersion = versions.node ?? await version("node");
const toolchains = wasmToolchainMetadata();
const pinnedWasmtimeVersion = opts.runners.some((name) => RUNNERS[name].artifactKind === "wasm") && active.some((name) => RUNNERS[name].artifactKind === "wasm")
  ? wasmtimeVersion()
  : null;
const porfforDir = path.join(ROOT, "vendor", "porffor");
let porfforCommit = null;
if (existsSync(path.join(porfforDir, ".git"))) {
  const r = await timeRun(["git", "-C", porfforDir, "rev-parse", "HEAD"], { timeoutMs: 30000 });
  if (r.ok) porfforCommit = r.stdout.trim();
}
if (!porfforCommit && existsSync(path.join(porfforDir, ".porffor_commit"))) {
  porfforCommit = readFileSync(path.join(porfforDir, ".porffor_commit"), "utf8").trim();
}

const hermesDir = path.join(ROOT, "vendor", "hermes");
let hermesCommit = null;
if (existsSync(path.join(hermesDir, ".git"))) {
  const r = await timeRun(["git", "-C", hermesDir, "rev-parse", "HEAD"], { timeoutMs: 30000 });
  if (r.ok) hermesCommit = r.stdout.trim();
}
if (!hermesCommit && existsSync(path.join(hermesDir, "build", ".built_commit"))) {
  hermesCommit = readFileSync(path.join(hermesDir, "build", ".built_commit"), "utf8").trim();
} else if (!hermesCommit && existsSync(path.join(hermesDir, ".hermes_commit"))) {
  hermesCommit = readFileSync(path.join(hermesDir, ".hermes_commit"), "utf8").trim();
}

const quickjsDir = path.join(ROOT, "vendor", "quickjs");
const jzCommit = existsSync(path.join(ROOT, "vendor", "jz", ".jz_commit"))
  ? readFileSync(path.join(ROOT, "vendor", "jz", ".jz_commit"), "utf8").trim()
  : null;
const wabtCommit = existsSync(path.join(ROOT, "vendor", "wabt", ".wabt_commit"))
  ? readFileSync(path.join(ROOT, "vendor", "wabt", ".wabt_commit"), "utf8").trim()
  : null;
let quickjsCommit = null;
if (existsSync(path.join(quickjsDir, ".git"))) {
  const r = await timeRun(["git", "-C", quickjsDir, "rev-parse", "HEAD"], { timeoutMs: 30000 });
  if (r.ok) quickjsCommit = r.stdout.trim();
}
if (!quickjsCommit && existsSync(path.join(quickjsDir, "build", ".built_commit"))) {
  quickjsCommit = readFileSync(path.join(quickjsDir, "build", ".built_commit"), "utf8").trim();
} else if (!quickjsCommit && existsSync(path.join(quickjsDir, ".quickjs_commit"))) {
  quickjsCommit = readFileSync(path.join(quickjsDir, ".quickjs_commit"), "utf8").trim();
}

console.log("=".repeat(72));
for (const n of active) console.log(`  ${n.padEnd(17)} ${versions[n]}`);
if (porfforCommit) console.log(`  ${"porffor commit".padEnd(17)} ${porfforCommit}`);
if (hermesCommit) console.log(`  ${"shermes commit".padEnd(17)} ${hermesCommit}`);
if (quickjsCommit) console.log(`  ${"quickjs commit".padEnd(17)} ${quickjsCommit}`);
console.log(`  benches ${benches.length} · runs ${opts.runs} (warmup ${opts.warmup}) · rss runs ${opts.rssRuns}`);
console.log("=".repeat(72));

const overheadSamples = [];
for (let i = 0; i < 20; i++) overheadSamples.push((await timeRun(["/bin/true"], { timeoutMs: 5000 })).wallMs);
const spawnOverhead = stats(overheadSamples);
console.log(`spawn overhead (/bin/true): ${spawnOverhead.median.toFixed(2)} ms median\n`);

const results = {
  meta: {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? null,
    totalMemGb: +(totalmem() / 1024 ** 3).toFixed(1),
    ci: process.env.GITHUB_ACTIONS === "true",
    commit: process.env.GITHUB_SHA ?? null,
    versions,
    referenceVersion,
    toolchains,
    wasmtimeHostVersion: pinnedWasmtimeVersion,
    selectedRunners: opts.runners,
    unavailableRunners: Object.fromEntries(unavailable),
    porfforCommit,
    hermesCommit,
    quickjsCommit,
    jzCommit,
    wabtCommit,
    opts: { runs: opts.runs, warmup: opts.warmup, rssRuns: opts.rssRuns, timeout: opts.timeout, buildTimeout: opts.buildTimeout, memLimitMb: opts.memLimitMb },
    spawnOverheadMs: spawnOverhead,
  },
  benches: {},
};

const outPath = opts.out ?? path.join(RESULT_DIR, "latest.json");
mkdirSync(path.dirname(outPath), { recursive: true });
const flush = () => writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

for (const bench of benches) {
  const entry = { file: bench, sourceBytes: statSync(path.join(BENCH_DIR, bench)).size, runners: {} };
  results.benches[bench] = entry;
  console.log(`\n### ${bench}`);
  let reference = null;
  if (!active.includes("node")) {
    const r = await timeRun(RUNNERS.node.cmd(path.join(BENCH_DIR, bench)), { cwd: ROOT, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
    if (r.ok) reference = resultLine(r.stdout);
    entry.reference = { version: referenceVersion, output: reference };
  }

  for (const name of opts.runners) {
    const runner = RUNNERS[name];
    const rec = {
      mode: runner.mode,
      label: runner.label,
      version: versions[name] ?? null,
      artifactKind: runner.artifactKind ?? null,
      sourcePolicy: runner.sourcePolicy ?? null,
      sourceMode: null,
      toolchain: runner.artifactKind === "wasm" ? toolchains : null,
      status: "ok",
    };
    entry.runners[name] = rec;
    process.stdout.write(`  ${name.padEnd(17)} `);
    if (unavailable.has(name)) {
      Object.assign(rec, { status: "unavailable", phase: "setup", error: unavailable.get(name) });
      console.log(`UNAVAILABLE  ${rec.error}`);
      flush();
      continue;
    }
    const unsupported = runner.supports?.(bench);
    if (unsupported) {
      Object.assign(rec, { status: "unsupported", error: unsupported });
      console.log(`UNSUPPORTED  ${unsupported}`);
      flush();
      continue;
    }

    let argv;
    let cwd = BUILD_DIR;
    if (runner.mode === "compiled") {
      if (runner.artifactKind === "wasm") {
        const canonicalSource = path.join(BENCH_DIR, bench);
        rec.sourceMode = "original";
        rec.sourcePath = path.relative(ROOT, canonicalSource);
        rec.sourceSha256 = createHash("sha256").update(readFileSync(canonicalSource)).digest("hex");
      }
      const b = await build(name, runner, bench);
      rec.buildMs = b.buildMs;
      rec.binBytes = b.binBytes ?? null;
      rec.moduleBytes = b.moduleBytes ?? null;
      rec.hostBytes = b.hostBytes ?? null;
      rec.hostExecutable = b.hostExecutable ?? null;
      if (!b.ok) {
        if (b.phase === "adapt") rec.sourceMode = "adaptation rejected";
        Object.assign(rec, { status: b.status, phase: b.phase, error: b.error, signal: b.signal, exitCode: b.exitCode, peakKb: b.peakKb });
        console.log(`${rec.status.toUpperCase()}  ${(b.error ?? "").slice(0, 80)}`);
        flush();
        continue;
      }
      if (b.manifest) {
        rec.sourceMode = b.manifest.sourceMode;
        rec.artifactPath = b.manifest.artifactPath;
        rec.target = b.manifest.target ?? null;
        rec.wasmtimeFlags = b.manifest.wasmtimeFlags ?? [];
        rec.wasmtimeCache = b.manifest.wasmtimeCache ?? null;
        rec.runtime = b.manifest.runtime ?? null;
        rec.moduleSha256 = b.manifest.artifactSha256;
        rec.distributionFiles = b.manifest.distributionFiles ?? [];
        rec.runtimeDependencies = b.manifest.runtimeDependencies ?? [];
        rec.sourcePath = b.manifest.sourcePath;
        rec.sourceSha256 = b.manifest.sourceSha256;
        rec.generatedPath = b.manifest.generatedPath ?? null;
        rec.generatedSha256 = b.manifest.generatedSha256 ?? null;
        rec.adaptation = b.manifest.adaptation ?? null;
        rec.compileCommand = b.manifest.compileCommand ?? null;
        rec.optimization = b.manifest.optimization ?? null;
      } else {
        rec.sourceMode = runner.sourcePolicy === "original" ? "original" : null;
      }
      argv = runner.runArtifact ? runner.runArtifact(b.outPath) : [b.outPath];
      if (runner.artifactKind === "wasm") {
        cwd = ROOT;
        rec.runtimeCommand = argv;
      }
    } else {
      argv = runner.cmd(sourceFor(runner, bench));
      cwd = ROOT;
    }

    const check = await timeRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
    rec.output = resultLine(check.stdout);
    rec.checkMs = check.wallMs;
    rec.checkPeakRssKb = check.peakKb;
    if (!check.ok) {
      Object.assign(rec, failure(check, "check"));
      console.log(`${rec.status.toUpperCase()}  ${(rec.error ?? "").slice(0, 80)}`);
      flush();
      continue;
    }
    if (rec.output === null) {
      Object.assign(rec, { status: "run-failed", phase: "check", error: "missing RESULT line" });
      console.log(`RUN-FAILED  ${rec.error}`);
      flush();
      continue;
    }
    if (name === "node") {
      reference = rec.output;
      entry.reference = { version: referenceVersion, output: reference };
    }
    if (reference === null) {
      Object.assign(rec, { status: "reference-failed", error: "Node did not produce a valid RESULT line" });
      console.log(`REFERENCE-FAILED  ${rec.error}`);
      flush();
      continue;
    }
    rec.matchesReference = rec.output === reference;

    const accept = (r, phase) => {
      if (!r.ok) {
        Object.assign(rec, failure(r, phase));
        return false;
      }
      if (resultLine(r.stdout) !== rec.output) {
        Object.assign(rec, { status: "unstable", phase, error: "RESULT changed between runs" });
        return false;
      }
      return true;
    };
    for (let i = 0; i < opts.warmup; i++) {
      if (!accept(await timeRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb }), "warmup")) break;
    }
    const times = [];
    for (let i = 0; rec.status === "ok" && i < opts.runs; i++) {
      const r = await timeRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
      if (!accept(r, "timing")) break;
      times.push(r.wallMs);
    }
    rec.time = stats(times);

    const rss = [];
    for (let i = 0; rec.status === "ok" && i < opts.rssRuns; i++) {
      const r = await rssRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
      if (!accept(r, "rss")) break;
      rss.push(r.maxRssKb);
    }
    rec.maxRssKb = rss.length ? Math.max(...rss) : null;

    flush();
    const t = rec.time;
    console.log(
      (t ? `${t.median.toFixed(1)} ms` : "n/a").padStart(11) +
        ` ±${t ? t.stddev.toFixed(1) : "?"}` +
        `   rss ${rec.maxRssKb ? (rec.maxRssKb / 1024).toFixed(1) + " MB" : "n/a"}` +
        (rec.binBytes ? `   bin ${(rec.binBytes / 1024).toFixed(0)} KB   build ${(rec.buildMs / 1000).toFixed(2)} s` : "") +
        (rec.moduleBytes ? `   wasm ${(rec.moduleBytes / 1024).toFixed(1)} KB · host ${(rec.hostBytes / 1024 / 1024).toFixed(1)} MB   build ${(rec.buildMs / 1000).toFixed(2)} s` : "") +
        (rec.matchesReference === false ? "   OUTPUT MISMATCH" : ""),
    );
    if (rec.status !== "ok") console.log(`    ${rec.status.toUpperCase()} (${rec.phase}): ${rec.error}`);
  }
}

results.meta.finishedAt = new Date().toISOString();
flush();
console.log(`\nwrote ${outPath}`);
