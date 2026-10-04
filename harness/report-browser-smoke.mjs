#!/usr/bin/env node
// Exercises the emitted report in a real isolated Chrome session via AXI.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(process.env.REPORT_BROWSER_OUTPUT ?? "build/report-browser");
mkdirSync(output, { recursive: true });
const hash = "abcdef0123456789".repeat(4);
const integrity = "sha512-" + "AbCd0123+/".repeat(40) + "==";
const fullVersion = `assemblyscript@0.28.20 (npm integrity ${integrity}) + wasi-shim@0.1.0 + Wasmtime 49.0.2 (archive SHA-256 ${hash}) <literal & provenance>`;
const time = { min: 2, max: 2, mean: 2, median: 2, stddev: 0, runs: 2 };
const data = {
  meta: {
    startedAt: "2026-10-04T00:00:00Z", cpuModel: "test CPU", cpus: 2,
    totalMemGb: 8, platform: "linux", arch: "x64", commit: hash.slice(0, 40),
    porfforCommit: hash.slice(0, 40), hermesCommit: hash.slice(0, 40),
    opts: { runs: 2, warmup: 1 }, spawnOverheadMs: { median: 0.1 },
    wasmtimeHostVersion: "wasmtime 49.0.2",
  },
  benches: {
    "10-fib.ts": { reference: { output: "96631268" }, runners: {
      node: { version: "v26.10.0", mode: "interpreted", status: "ok", matchesReference: true, time, maxRssKb: 1000 },
      assemblyscript: {
        version: fullVersion, mode: "compiled", artifactKind: "wasm", status: "ok",
        matchesReference: true, sourceMode: "adapted", sourceSha256: hash,
        generatedSha256: hash, sourcePath: "benches/10-fib.ts",
        generatedPath: `build/${"long-path-segment/".repeat(12)}10-fib.ts`,
        adaptation: { version: "assemblyscript-result-v1" }, time,
        moduleBytes: 1000, hostBytes: 20000000, maxRssKb: 1000, buildMs: 10,
      },
    } },
  },
};
const input = path.join(output, "input.json");
writeFileSync(input, JSON.stringify(data));
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `js-compiled-report-smoke-${process.pid}` };
const axi = (...args) => execFileSync("chrome-devtools-axi", args, { env, encoding: "utf8", timeout: 120000 });
const evaluate = (fn) => JSON.parse(execFileSync("chrome-devtools-axi", ["run"], {
  env, encoding: "utf8", timeout: 120000,
  input: `console.log(JSON.stringify(await page.eval(${fn.toString()})));`,
}));
const measurements = [];
function measure() {
  return evaluate(() => ({
    viewport: innerWidth, page: document.documentElement.scrollWidth,
    cards: [...document.querySelectorAll("section")].map((card) => ({
      left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right,
      width: card.clientWidth, scroll: card.scrollWidth,
    })),
  }));
}
try {
  for (const [name, renderer] of [
    ...(process.env.BASELINE_REPORT ? [["before", process.env.BASELINE_REPORT]] : []),
    ["after", path.join(root, "harness", "report.mjs")],
  ]) {
    const html = path.join(output, `${name}.html`);
    execFileSync(process.execPath, [renderer, input, `--md=${path.join(output, `${name}.md`)}`, `--html=${html}`]);
    axi("open", pathToFileURL(html).href);
    for (const width of [1440, 768, 390, 320]) {
      axi("resize", String(width), "900");
      const closed = measure();
      measurements.push({ name, width, state: "closed", ...closed });
      axi("screenshot", path.join(output, `${name}-${width}.png`));
      if (name === "before") {
        assert.ok(closed.page > closed.viewport, "baseline must reproduce the long-version page overflow");
        continue;
      }
      assert.ok(closed.page <= closed.viewport, JSON.stringify(closed));
      for (const card of closed.cards) {
        assert.ok(card.left >= 0 && card.right <= width, JSON.stringify(card));
        assert.ok(card.scroll <= card.width, JSON.stringify(card));
      }
      const disclosures = evaluate(() => [...document.querySelectorAll("details")].map((detail) => ({
        open: detail.open, label: detail.querySelector("summary").textContent,
        full: detail.querySelector("pre").textContent,
      })));
      assert.ok(disclosures.length >= 5, "version, commit and input hash disclosures must exist");
      assert.ok(disclosures.every((detail) => !detail.open && detail.label.length <= 80));
      assert.ok(disclosures.some((detail) => detail.full === fullVersion));
      assert.ok(disclosures.some((detail) => detail.full === hash));
      evaluate(() => { document.querySelector(".versions tbody tr:nth-child(2) summary").focus(); return true; });
      axi("press", "Enter");
      assert.equal(evaluate(() => document.querySelector(".versions tbody tr:nth-child(2) details").open), true);
      axi("press", "Enter");
      assert.equal(evaluate(() => document.querySelector(".versions tbody tr:nth-child(2) details").open), false);
      evaluate(() => { document.querySelectorAll("details").forEach((detail) => { detail.open = true; }); return true; });
      const expanded = measure();
      measurements.push({ name, width, state: "expanded", ...expanded });
      assert.ok(expanded.page <= expanded.viewport, JSON.stringify(expanded));
      assert.ok(expanded.cards.every((card) => card.scroll <= card.width), JSON.stringify(expanded));
      axi("screenshot", path.join(output, `after-expanded-${width}.png`));
      evaluate(() => { document.querySelectorAll("details").forEach((detail) => { detail.open = false; }); return true; });
    }
  }
  console.log("Report browser smoke passed: full provenance, keyboard disclosure and responsive overflow.");
} finally {
  writeFileSync(path.join(output, "measurements.json"), JSON.stringify(measurements, null, 2));
  axi("stop");
}
