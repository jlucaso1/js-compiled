#!/usr/bin/env node
// Renders results/latest.json into results/REPORT.md and site/index.html.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./runners.mjs";

const args = process.argv.slice(2);
const inPath = args.find((a) => !a.startsWith("--")) ?? path.join(ROOT, "results", "latest.json");
const arg = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const mdOut = arg("md", path.join(ROOT, "results", "REPORT.md"));
const htmlOut = arg("html", path.join(ROOT, "site", "index.html"));

const data = JSON.parse(readFileSync(inPath, "utf8"));
const benches = Object.keys(data.benches);
const runners = [...new Set(benches.flatMap((b) => Object.keys(data.benches[b].runners)))];
const rec = (b, r) => data.benches[b].runners[r];
const shortName = (b) => b.replace(/\.(ts|js)$/, "");
const correct = (x) => x?.status === "ok" && x.matchesReference !== false;

const METRICS = [
  { key: "time", title: "Execution time", unit: "ms", note: "median wall clock, lower is better", get: (x) => (correct(x) ? x.time?.median : null), fmt: (v) => (v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")) },
  { key: "memory", title: "Peak memory", unit: "MB", note: "max RSS, lower is better", get: (x) => (correct(x) && x.maxRssKb ? x.maxRssKb / 1024 : null), fmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US")) },
  { key: "binary", title: "Native executable size", unit: "MB", note: "compiled native executables only; Wasm modules and hosts are listed separately", get: (x) => (correct(x) && x?.binBytes ? x.binBytes / 1024 / 1024 : null), fmt: (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) },
  { key: "module", title: "Wasm module size", unit: "MB", note: "correct Wasm modules only; excludes the Wasmtime host executable", get: (x) => (correct(x) && x?.moduleBytes ? x.moduleBytes / 1024 / 1024 : null), fmt: (v) => (v < 1 ? v.toFixed(3) : v.toFixed(1)) },
  { key: "host", title: "Wasm host executable size", unit: "MB", note: "on-disk pinned Wasmtime executable size; RSS separately includes its runtime process", get: (x) => (correct(x) && x?.hostBytes ? x.hostBytes / 1024 / 1024 : null), fmt: (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) },
  { key: "build", title: "Compile time", unit: "s", note: "correct runs only; lower is better", get: (x) => (correct(x) && x?.buildMs != null ? x.buildMs / 1000 : null), fmt: (v) => v.toFixed(2) },
];

const statusOf = (x) => {
  if (!x) return { code: "none", label: "-" };
  if (x.status === "ok") {
    if (x.matchesReference === false) return { code: "mismatch", label: "output differs" };
    return { code: "ok", label: x.artifactKind === "wasm" ? `ok · ${x.sourceMode ?? "original"}` : "ok" };
  }
  return { code: x.status, label: x.status.replace("-", " ") };
};

const columnsFor = (m) => {
  if (m.key === "build") return runners.filter((r) => benches.some((b) => rec(b, r)?.mode === "compiled"));
  if (m.key === "binary") return runners.filter((r) => benches.some((b) => rec(b, r)?.mode === "compiled" && rec(b, r)?.artifactKind !== "wasm"));
  if (m.key === "module" || m.key === "host") return runners.filter((r) => benches.some((b) => rec(b, r)?.artifactKind === "wasm"));
  return runners;
};

// ---------- markdown ----------
function mdTable(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const line = (r) => "| " + r.map((c, i) => String(c).padEnd(w[i])).join(" | ") + " |";
  return [line(rows[0]), "|" + w.map((x) => "-".repeat(x + 2)).join("|") + "|", ...rows.slice(1).map(line)].join("\n");
}

const md = [];
md.push("# Results\n");
md.push(`Generated ${data.meta.finishedAt ?? data.meta.startedAt}\n`);
md.push("## Environment\n");
md.push(`- ${data.meta.cpuModel} (${data.meta.cpus} threads), ${data.meta.totalMemGb} GB RAM, ${data.meta.platform}/${data.meta.arch}`);
if (data.meta.commit) md.push(`- Repository commit: \`${data.meta.commit}\``);
md.push(`- ${data.meta.opts.runs} timed runs per pair after ${data.meta.opts.warmup} warmup, median reported`);
md.push(`- Spawn overhead (\`/bin/true\`): ${data.meta.spawnOverheadMs.median.toFixed(2)} ms`);
if (runners.some((r) => benches.some((b) => rec(b, r)?.artifactKind === "wasm"))) {
  md.push("- Wasm timing and RSS measure the actual cold `wasmtime run` process (including module validation/host compilation); the `.wasm` module is not a self-contained executable.");
  md.push(`- Pinned Wasmtime: ${data.meta.wasmtimeHostVersion ?? `unavailable (expected ${data.meta.toolchains?.wasmtime?.version ?? "unknown"})`}; Wasm module and host executable sizes are reported separately.\n`);
} else md.push("");
md.push("### Versions\n");
md.push(mdTable([["runner", "version"], ...runners.map((r) => [r, benches.map((b) => rec(b, r)?.version).find(Boolean) ?? "-"])]));
if (data.meta.porfforCommit) md.push(`\nPorffor commit: \`${data.meta.porfforCommit}\``);
if (data.meta.hermesCommit) md.push(`\nStatic Hermes commit: \`${data.meta.hermesCommit}\``);
if (data.meta.quickjsCommit) md.push(`\nQuickJS-ng commit: \`${data.meta.quickjsCommit}\``);
if (data.meta.jzCommit) md.push(`\njz native commit: \`${data.meta.jzCommit}\``);
if (data.meta.wabtCommit) md.push(`\nWABT commit: \`${data.meta.wabtCommit}\``);

md.push("\n## Coverage\n");
md.push(mdTable([
  ["bench", ...runners],
  ...benches.map((b) => [shortName(b), ...runners.map((r) => statusOf(rec(b, r)).label)]),
  ["**passing**", ...runners.map((r) => `${benches.filter((b) => statusOf(rec(b, r)).code === "ok").length}/${benches.length}`)],
  ["**original-input passing (Wasm)**", ...runners.map((r) => benches.some((b) => rec(b, r)?.artifactKind === "wasm")
    ? `${benches.filter((b) => rec(b, r)?.artifactKind === "wasm" && rec(b, r)?.sourceMode === "original" && statusOf(rec(b, r)).code === "ok").length}/${benches.length}` : "-")],
  ["**adapted-input passing (Wasm)**", ...runners.map((r) => benches.some((b) => rec(b, r)?.artifactKind === "wasm")
    ? `${benches.filter((b) => rec(b, r)?.artifactKind === "wasm" && rec(b, r)?.sourceMode === "adapted" && statusOf(rec(b, r)).code === "ok").length}/${benches.length}` : "-")],
]));

const wasmInputs = benches.flatMap((b) => runners.filter((r) => rec(b, r)?.artifactKind === "wasm").map((r) => [
  shortName(b), r, rec(b, r)?.sourceMode ?? "not built", rec(b, r)?.sourcePath ?? "-",
  rec(b, r)?.generatedPath ?? "-", rec(b, r)?.adaptation?.version ?? "direct input",
  rec(b, r)?.sourceSha256 ?? "-", rec(b, r)?.generatedSha256 ?? "-",
]));
if (wasmInputs.length) {
  md.push("\n## Wasm input provenance\n");
  md.push("`original` means the canonical fixture was compiled directly. `adapted` means a bounded generated input was used; its source and generated hashes/rules are retained in the JSON result. Adapted coverage is not direct TypeScript coverage.\n");
  md.push(mdTable([["bench", "runner", "input", "source", "generated input", "adapter", "source SHA-256", "generated SHA-256"], ...wasmInputs]));
}

for (const m of METRICS) {
  const cols = columnsFor(m);
  md.push(`\n## ${m.title} (${m.unit})\n\n_${m.note}_\n`);
  md.push(mdTable([
    ["bench", ...cols],
    ...benches.map((b) => {
      const vals = cols.map((r) => m.get(rec(b, r)));
      const best = Math.min(...vals.filter((v) => v != null));
      return [shortName(b), ...vals.map((v) => (v == null ? "-" : v === best ? `**${m.fmt(v)}**` : m.fmt(v)))];
    }),
  ]));
}

if (runners.includes("node")) {
  const geo = Object.fromEntries(runners.map((r) => [r, []]));
  const rows = benches.map((b) => {
    const base = METRICS[0].get(rec(b, "node"));
    return [shortName(b), ...runners.map((r) => {
      const v = METRICS[0].get(rec(b, r));
      if (v == null || base == null) return "-";
      geo[r].push(base / v);
      return (base / v).toFixed(2) + "x";
    })];
  });
  md.push("\n## Speedup vs Node (higher is faster)\n");
  md.push(mdTable([["bench", ...runners], ...rows,
    ["**geometric mean**", ...runners.map((r) => (geo[r].length ? Math.exp(geo[r].reduce((a, x) => a + Math.log(x), 0) / geo[r].length).toFixed(2) + "x" : "-"))]]));
  md.push("\n> The geometric mean only covers the benches a runner could run, so low-coverage runners look better than they are.\n");
}

const failures = benches.flatMap((b) => runners.flatMap((r) => {
  const x = rec(b, r);
  if (!x) return [];
  if (x.status !== "ok") return [[shortName(b), r, x.status, (x.error ?? "").slice(0, 200)]];
  if (x.matchesReference === false) return [[shortName(b), r, "output differs", `expected ${data.benches[b].reference?.output ?? rec(b, "node")?.output}, got ${x.output}`]];
  return [];
}));
if (failures.length) {
  md.push("\n## Failures\n");
  md.push(mdTable([["bench", "runner", "status", "detail"], ...failures]));
}

mkdirSync(path.dirname(mdOut), { recursive: true });
writeFileSync(mdOut, md.join("\n") + "\n");

// ---------- html ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function metricSection(m) {
  const cols = columnsFor(m);
  const rows = benches.map((b) => {
    const vals = cols.map((r) => m.get(rec(b, r)));
    const present = vals.filter((v) => v != null);
    const max = Math.max(...present, 0);
    const best = present.length ? Math.min(...present) : null;
    const cells = vals.map((v, i) => {
      if (v == null) return `<td class="empty" title="${esc(statusOf(rec(b, cols[i])).label)}">&mdash;</td>`;
      const x = rec(b, cols[i]);
      const pct = max > 0 ? Math.max((v / max) * 100, 1.5) : 0;
      const tip = `${cols[i]} · ${shortName(b)}: ${m.fmt(v)} ${m.unit}` + (m.key === "time" && x.time ? ` (min ${m.fmt(x.time.min)}, sd ${x.time.stddev.toFixed(1)}, n=${x.time.runs})` : "");
      return `<td class="num${v === best ? " best" : ""}" title="${esc(tip)}"><span class="bar" style="width:${pct.toFixed(1)}%"></span><span class="v">${m.fmt(v)}</span></td>`;
    });
    return `<tr><th scope="row">${esc(shortName(b))}</th>${cells.join("")}</tr>`;
  });
  return `<section><h2>${esc(m.title)} <span class="unit">${esc(m.unit)}</span></h2>
<p class="note">${esc(m.note)}. Bar length is the value relative to the slowest/largest runner in that row; bold is the row winner.</p>
<div class="scroll"><table><thead><tr><th scope="col">bench</th>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${rows.join("")}</tbody></table></div></section>`;
}

const coverageSection = `<section><h2>Coverage</h2>
<p class="note">Whether the program compiled, ran, and produced the same <code>RESULT</code> line as Node.</p>
<div class="scroll"><table><thead><tr><th scope="col">bench</th>${runners.map((r) => `<th scope="col">${esc(r)}</th>`).join("")}</tr></thead><tbody>
${benches.map((b) => `<tr><th scope="row">${esc(shortName(b))}</th>${runners.map((r) => {
  const s = statusOf(rec(b, r));
  return `<td class="st st-${s.code}" title="${esc(rec(b, r)?.error ?? s.label)}">${esc(s.label)}</td>`;
}).join("")}</tr>`).join("")}
<tr class="total"><th scope="row">passing (of all fixtures)</th>${runners.map((r) => `<td>${benches.filter((b) => statusOf(rec(b, r)).code === "ok").length}/${benches.length}</td>`).join("")}</tr>
<tr class="total"><th scope="row">original-input passing (Wasm)</th>${runners.map((r) => `<td>${benches.some((b) => rec(b, r)?.artifactKind === "wasm") ? `${benches.filter((b) => rec(b, r)?.artifactKind === "wasm" && rec(b, r)?.sourceMode === "original" && statusOf(rec(b, r)).code === "ok").length}/${benches.length}` : "-"}</td>`).join("")}</tr>
<tr class="total"><th scope="row">adapted-input passing (Wasm)</th>${runners.map((r) => `<td>${benches.some((b) => rec(b, r)?.artifactKind === "wasm") ? `${benches.filter((b) => rec(b, r)?.artifactKind === "wasm" && rec(b, r)?.sourceMode === "adapted" && statusOf(rec(b, r)).code === "ok").length}/${benches.length}` : "-"}</td>`).join("")}</tr>
</tbody></table></div></section>`;

const wasmInputRows = benches.flatMap((b) => runners.filter((r) => rec(b, r)?.artifactKind === "wasm").map((r) => {
  const x = rec(b, r);
  return `<tr><th scope="row">${esc(shortName(b))}</th><td>${esc(r)}</td><td>${esc(x.sourceMode ?? "not built")}</td><td class="l"><code>${esc(x.sourcePath ?? "-")}</code></td><td class="l"><code>${esc(x.generatedPath ?? "-")}</code></td><td>${esc(x.adaptation?.version ?? "direct input")}</td><td class="l"><code>${esc(x.sourceSha256 ?? "-")}</code></td><td class="l"><code>${esc(x.generatedSha256 ?? "-")}</code></td></tr>`;
})).join("");
const wasmInputSection = wasmInputRows ? `<section><h2>Wasm/WASI input provenance</h2>
<p class="note"><code>original</code> means the canonical fixture was compiled directly. <code>adapted</code> means a bounded generated input was used; adapted coverage is not direct TypeScript coverage. Only Wasm runs with the matching source are eligible for metric rankings.</p>
<div class="scroll"><table><thead><tr><th>bench</th><th>runner</th><th>input</th><th>source</th><th>generated input</th><th>adapter</th><th>source SHA-256</th><th>generated SHA-256</th></tr></thead><tbody>${wasmInputRows}</tbody></table></div></section>` : "";

const versionRows = runners.map((r) => `<tr><th scope="row">${esc(r)}</th><td class="l">${esc(benches.map((b) => rec(b, r)?.version).find(Boolean) ?? "-")}</td></tr>`).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JavaScript/TypeScript compiler benchmark results</title>
<style>
:root{color-scheme:light;--plane:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--bar:#2a78d6;--ring:rgba(11,11,11,.10)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--plane:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--bar:#3987e5;--ring:rgba(255,255,255,.10)}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.25rem 4rem;background:var(--plane);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1400px;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 .35rem}
h2{font-size:1.1rem;margin:0 0 .3rem}
.unit{color:var(--muted);font-weight:400;font-size:.85rem}
.sub,.note{color:var(--ink-2);margin:0 0 1rem;font-size:.85rem}
section{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:1.1rem 1.2rem;margin:0 0 1.25rem}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:.83rem}
th,td{text-align:right;padding:.3rem .5rem;border-bottom:1px solid var(--grid);white-space:nowrap}
thead th{color:var(--muted);font-weight:500;font-size:.78rem;border-bottom:1px solid var(--grid)}
th[scope=row]{text-align:left;font-weight:500;color:var(--ink-2)}
td.num{position:relative;min-width:78px}
td.num .bar{position:absolute;right:.5rem;bottom:2px;height:4px;background:var(--bar);opacity:.45;border-radius:2px 0 0 2px}
td.num.best{font-weight:700}
td.num.best .bar{opacity:1}
td.num .v{position:relative}
td.empty{color:var(--muted)}
td.st{text-align:center;font-size:.75rem;color:var(--ink-2)}
td.st-ok{color:var(--ink)}
td.st-none{color:var(--muted)}
.l{text-align:left}
tr.total th,tr.total td{font-weight:700;border-bottom:none}
dl.env{display:grid;grid-template-columns:auto 1fr;gap:.15rem 1rem;margin:0;font-size:.85rem}
dl.env dt{color:var(--muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}
a{color:var(--bar)}
footer{color:var(--muted);font-size:.8rem;margin-top:2rem}
</style></head><body><main>
<h1>JavaScript/TypeScript benchmarks</h1>
<p class="sub">Runtimes and compilers measured on execution time, peak memory, artifact size, compile time and coverage. Wasm/WASI timings measure the cold Wasmtime host process, not a self-contained Wasm executable.</p>

<section><h2>Run</h2>
<dl class="env">
<dt>Finished</dt><dd>${esc(data.meta.finishedAt ?? data.meta.startedAt)}</dd>
<dt>Machine</dt><dd>${esc(data.meta.cpuModel ?? "unknown")} · ${data.meta.cpus} threads · ${data.meta.totalMemGb} GB · ${esc(data.meta.platform)}/${esc(data.meta.arch)}</dd>
${data.meta.commit ? `<dt>Commit</dt><dd><code>${esc(data.meta.commit)}</code></dd>` : ""}
<dt>Method</dt><dd>${data.meta.opts.runs} timed runs after ${data.meta.opts.warmup} warmup, median reported · spawn overhead ${data.meta.spawnOverheadMs.median.toFixed(2)} ms${data.meta.wasmtimeHostVersion ? ` · Wasmtime ${esc(data.meta.wasmtimeHostVersion)}` : ""}</dd>
${data.meta.shards ? `<dt>Sharding</dt><dd>${data.meta.shards.length} CI jobs, one per bench &mdash; runners within a bench share a machine, different benches may not</dd>` : ""}
</dl>
<table style="margin-top:1rem;max-width:520px"><thead><tr><th scope="col">runner</th><th scope="col" class="l">version</th></tr></thead><tbody>${versionRows}
${data.meta.porfforCommit ? `<tr><th scope="row">porffor commit</th><td class="l"><code>${esc(data.meta.porfforCommit.slice(0, 12))}</code></td></tr>` : ""}
</tbody></table></section>

${coverageSection}
${wasmInputSection}
${METRICS.map(metricSection).join("\n")}

<footer>Generated by <code>harness/report.mjs</code>. Raw data: <a href="latest.json">latest.json</a>.</footer>
</main></body></html>
`;

mkdirSync(path.dirname(htmlOut), { recursive: true });
writeFileSync(htmlOut, html);
console.log(`wrote ${mdOut} and ${htmlOut}`);
