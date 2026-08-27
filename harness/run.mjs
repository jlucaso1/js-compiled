#!/usr/bin/env node
// Runs every (bench, runner) pair and writes a JSON result file.
process.removeAllListeners("warning");
import { readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { RUNNERS, CORE, ROOT, missingDependency } from "./runners.mjs";
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
  for (const [k, v] of Object.entries(RUNNERS)) console.log(`  ${k.padEnd(17)} ${v.mode.padEnd(12)} ${v.tier}`);
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
for (const name of opts.runners) {
  const missing = missingDependency(name);
  if (missing) console.error(`skipping ${name}: missing ${missing} (run scripts/setup.sh)`);
  else active.push(name);
}

// Backstop for the RSS watchdog: children inherit oom_score_adj, so if a runner
// outruns the poll interval the kernel picks it, not the machine.
try {
  writeFileSync("/proc/self/oom_score_adj", "1000");
} catch {}

const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const firstLines = (t, n = 4) => clean(t).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n).join(" | ");

const limitKb = opts.memLimitMb * 1024;

async function version(name) {
  const r = await timeRun(RUNNERS[name].version, { timeoutMs: 60000 });
  return clean(r.stdout + r.stderr).trim().split("\n")[0]?.trim() || "unknown";
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
  const outPath = path.join(outDir, path.basename(bench).replace(/\.(ts|js)$/, ""));
  rmSync(outPath, { force: true });
  const r = await timeRun(runner.compile(sourceFor(runner, bench), outPath), {
    cwd: BUILD_DIR,
    timeoutMs: opts.buildTimeout * 1000,
    memLimitKb: limitKb,
  });
  if (!existsSync(outPath)) {
    return { ok: false, buildMs: r.wallMs, error: r.timedOut ? "build timeout" : firstLines(r.stderr || r.stdout) || `exit ${r.exitCode}` };
  }
  return { ok: true, outPath, buildMs: r.wallMs, binBytes: statSync(outPath).size };
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
const porfforDir = path.join(ROOT, "vendor", "porffor");
let porfforCommit = null;
if (existsSync(path.join(porfforDir, ".git"))) {
  const r = await timeRun(["git", "-C", porfforDir, "rev-parse", "HEAD"], { timeoutMs: 30000 });
  if (r.ok) porfforCommit = r.stdout.trim();
}

console.log("=".repeat(72));
for (const n of active) console.log(`  ${n.padEnd(17)} ${versions[n]}`);
if (porfforCommit) console.log(`  ${"porffor commit".padEnd(17)} ${porfforCommit}`);
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
    porfforCommit,
    opts: { runs: opts.runs, warmup: opts.warmup, rssRuns: opts.rssRuns, timeout: opts.timeout },
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

  for (const name of active) {
    const runner = RUNNERS[name];
    const rec = { mode: runner.mode, label: runner.label, version: versions[name], status: "ok" };
    entry.runners[name] = rec;
    process.stdout.write(`  ${name.padEnd(17)} `);

    let argv;
    let cwd = BUILD_DIR;
    if (runner.mode === "compiled") {
      const b = await build(name, runner, bench);
      rec.buildMs = b.buildMs;
      rec.binBytes = b.binBytes ?? null;
      if (!b.ok) {
        Object.assign(rec, { status: "build-failed", error: b.error });
        console.log(`BUILD FAILED  ${(b.error ?? "").slice(0, 80)}`);
        flush();
        continue;
      }
      argv = [b.outPath];
    } else {
      argv = runner.cmd(sourceFor(runner, bench));
      cwd = ROOT;
    }

    const check = await timeRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
    rec.output = resultLine(check.stdout);
    if (!check.ok) {
      Object.assign(rec, {
        status: check.timedOut ? "timeout" : check.memExceeded ? "out-of-memory" : "run-failed",
        exitCode: check.exitCode,
        error: check.timedOut
          ? `timeout > ${opts.timeout}s`
          : check.memExceeded
            ? `exceeded ${opts.memLimitMb} MB RSS (peaked at ${Math.round(check.peakKb / 1024)} MB)`
            : firstLines(check.stderr || check.stdout),
      });
      console.log(`${rec.status.toUpperCase()}  ${(rec.error ?? "").slice(0, 80)}`);
      flush();
      continue;
    }
    if (name === "node" || reference === null) reference = rec.output;
    rec.matchesReference = rec.output === reference;

    for (let i = 0; i < opts.warmup; i++) await timeRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
    const times = [];
    for (let i = 0; i < opts.runs; i++) {
      const r = await timeRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
      if (!r.ok) {
        Object.assign(rec, { status: "unstable", error: firstLines(r.stderr) });
        break;
      }
      times.push(r.wallMs);
    }
    rec.time = stats(times);

    const rss = [];
    for (let i = 0; i < opts.rssRuns; i++) {
      const r = await rssRun(argv, { cwd, timeoutMs: opts.timeout * 1000, memLimitKb: limitKb });
      if (r.ok) rss.push(r.maxRssKb);
    }
    rec.maxRssKb = rss.length ? Math.max(...rss) : null;

    flush();
    const t = rec.time;
    console.log(
      (t ? `${t.median.toFixed(1)} ms` : "n/a").padStart(11) +
        ` ±${t ? t.stddev.toFixed(1) : "?"}` +
        `   rss ${rec.maxRssKb ? (rec.maxRssKb / 1024).toFixed(1) + " MB" : "n/a"}` +
        (rec.binBytes ? `   bin ${(rec.binBytes / 1024).toFixed(0)} KB   build ${(rec.buildMs / 1000).toFixed(2)} s` : "") +
        (rec.matchesReference === false ? "   OUTPUT MISMATCH" : ""),
    );
  }
}

results.meta.finishedAt = new Date().toISOString();
flush();
console.log(`\nwrote ${outPath}`);
