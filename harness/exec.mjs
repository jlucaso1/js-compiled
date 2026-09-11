import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GNU_TIME = "/usr/bin/time";
const MAX_OUTPUT = 8 * 1024 * 1024;
const POLL_MS = 100;
const IS_MAC = process.platform === "darwin";
const PROCESS_GROUPS = process.platform !== "win32";

function rssKb(pid) {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

// A runner may sit under a wrapper (GNU time), so charge it for the whole tree.
function treeRssKb(pid, seen = new Set()) {
  if (seen.has(pid)) return 0;
  seen.add(pid);
  let total = rssKb(pid);
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      for (const child of readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim().split(/\s+/)) {
        if (child) total += treeRssKb(Number(child), seen);
      }
    }
  } catch {}
  return total;
}

// macOS has no /proc. One snapshot includes descendants of compiler/time wrappers.
function macTreeRssKb(pid) {
  const r = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8", timeout: 1000 });
  const rows = (r.stdout ?? "").trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const children = new Map();
  const rss = new Map();
  for (const [child, parent, kb] of rows) {
    rss.set(child, kb);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const pending = [pid];
  const seen = new Set();
  let total = 0;
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    total += rss.get(current) || 0;
    pending.push(...(children.get(current) ?? []));
  }
  return total;
}

function run(argv, { cwd, timeoutMs = 300000, memLimitKb = 0 } = {}) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: PROCESS_GROUPS, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let memExceeded = false;
    let peakKb = 0;
    let settled = false;

    // Killing only GNU time or the npm CLI wrapper leaves the workload running.
    const killTree = () => {
      if (PROCESS_GROUPS && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      } else {
        child.kill("SIGKILL");
      }
    };

    const capture = (stream, append) => {
      stream.setEncoding("utf8");
      stream.on("data", (c) => append(c));
    };
    capture(child.stdout, (c) => { if (stdout.length < MAX_OUTPUT) stdout += c; });
    capture(child.stderr, (c) => { if (stderr.length < MAX_OUTPUT) stderr += c; });

    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    const poll = child.pid
      ? setInterval(() => {
          const kb = IS_MAC ? macTreeRssKb(child.pid) : treeRssKb(child.pid);
          if (kb > peakKb) peakKb = kb;
          if (memLimitKb && kb > memLimitKb) { memExceeded = true; killTree(); }
        }, POLL_MS)
      : null;

    const done = (code, signal, spawnError) => {
      if (settled) return;
      settled = true;
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

// Peak RSS from the platform's time utility, using the kernel high-water mark.
export async function rssRun(argv, opts = {}) {
  if (IS_MAC) {
    const r = await run([GNU_TIME, "-l", ...argv], opts);
    const match = /^\s*(\d+)\s+maximum resident set size\s*$/m.exec(r.stderr);
    // BSD time reports bytes; GNU time reports KiB.
    const maxRssKb = match ? Number(match[1]) / 1024 : null;
    return { ...r, maxRssKb, ok: r.ok && maxRssKb !== null };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "bench-rss-"));
  const outFile = path.join(dir, "time.txt");
  try {
    const r = await run([GNU_TIME, "-f", "%M", "-o", outFile, "--", ...argv], opts);
    let maxRssKb = null;
    try {
      const raw = readFileSync(outFile, "utf8").trim().split("\n").pop() ?? "";
      if (/^\d+$/.test(raw)) maxRssKb = Number(raw);
    } catch {}
    return { ...r, maxRssKb, ok: r.ok && maxRssKb !== null };
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
