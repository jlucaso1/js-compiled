import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GNU_TIME = "/usr/bin/time";

const base = (cwd, timeoutMs) => ({
  cwd,
  timeout: timeoutMs,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

// Wall clock via hrtime: GNU time only resolves to 10ms, useless for a binary
// that runs in 1ms.
export function timeRun(argv, { cwd, timeoutMs = 300000 } = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(argv[0], argv.slice(1), base(cwd, timeoutMs));
  const t1 = process.hrtime.bigint();
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  return {
    wallMs: Number(t1 - t0) / 1e6,
    exitCode: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    timedOut,
    ok: !timedOut && !r.error && r.status === 0,
  };
}

// Peak RSS of the process and its children, measured in a separate run.
export function rssRun(argv, { cwd, timeoutMs = 300000 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-rss-"));
  const outFile = path.join(dir, "time.txt");
  try {
    const r = spawnSync(GNU_TIME, ["-f", "%M", "-o", outFile, "--", ...argv], base(cwd, timeoutMs));
    let maxRssKb = null;
    try {
      const raw = readFileSync(outFile, "utf8").trim().split("\n").pop() ?? "";
      if (/^\d+$/.test(raw)) maxRssKb = Number(raw);
    } catch {}
    return { maxRssKb, ok: r.status === 0 && maxRssKb !== null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function stats(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { min: s[0], max: s[n - 1], mean, median, stddev: Math.sqrt(variance), runs: n };
}
