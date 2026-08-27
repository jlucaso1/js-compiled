import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GNU_TIME = "/usr/bin/time";
const MAX_OUTPUT = 8 * 1024 * 1024;
const POLL_MS = 100;

function rssKb(pid) {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

// A runner may sit under a wrapper (GNU time), so charge it for the whole tree.
function treeRssKb(pid, depth = 0) {
  let total = rssKb(pid);
  if (depth > 3) return total;
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      for (const child of readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim().split(/\s+/)) {
        if (child) total += treeRssKb(Number(child), depth + 1);
      }
    }
  } catch {}
  return total;
}

function run(argv, { cwd, timeoutMs = 300000, memLimitKb = 0 } = {}) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let memExceeded = false;
    let peakKb = 0;

    const capture = (stream, append) => {
      stream.setEncoding("utf8");
      stream.on("data", (c) => append(c));
    };
    capture(child.stdout, (c) => { if (stdout.length < MAX_OUTPUT) stdout += c; });
    capture(child.stderr, (c) => { if (stderr.length < MAX_OUTPUT) stderr += c; });

    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const poll = child.pid
      ? setInterval(() => {
          const kb = treeRssKb(child.pid);
          if (kb > peakKb) peakKb = kb;
          if (memLimitKb && kb > memLimitKb) { memExceeded = true; child.kill("SIGKILL"); }
        }, POLL_MS)
      : null;

    const done = (code, signal, spawnError) => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      resolve({
        wallMs: Number(process.hrtime.bigint() - t0) / 1e6,
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
        memExceeded,
        peakKb,
        spawnError,
        ok: !timedOut && !memExceeded && !spawnError && code === 0,
      });
    };
    child.on("error", (e) => done(null, null, String(e.message)));
    child.on("close", (code, signal) => done(code, signal, null));
  });
}

export const timeRun = run;

// Peak RSS from GNU time, which samples the kernel counter rather than polling.
export async function rssRun(argv, opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-rss-"));
  const outFile = path.join(dir, "time.txt");
  try {
    const r = await run([GNU_TIME, "-f", "%M", "-o", outFile, "--", ...argv], opts);
    let maxRssKb = null;
    try {
      const raw = readFileSync(outFile, "utf8").trim().split("\n").pop() ?? "";
      if (/^\d+$/.test(raw)) maxRssKb = Number(raw);
    } catch {}
    return { maxRssKb, ok: r.ok && maxRssKb !== null, memExceeded: r.memExceeded };
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
