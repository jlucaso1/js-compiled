import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { rssRun, timeRun } from "./exec.mjs";

const supported = ["linux", "darwin"].includes(process.platform);
const node = (source) => [process.execPath, "-e", source];
const wrapper = (source) => node(`
  console.log("PID " + process.pid);
  require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(source)}], {stdio: "inherit"});
`);

function assertStopped(stdout) {
  const pids = [...stdout.matchAll(/^PID (\d+)$/gm)].map((m) => Number(m[1]));
  assert.ok(pids.length >= 2, "exercise a wrapper and its descendant");
  for (const pid of pids) {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
    assert.ok(r.status !== 0 || /^\s*Z/.test(r.stdout), `process ${pid} still running: ${r.stdout}`);
  }
}

test("missing executable reports a spawn failure", async () => {
  const r = await timeRun(["/nonexistent/js-compiled-test-command"], { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.match(r.spawnError, /ENOENT/);
});

test("timeout kills the wrapper and descendant retaining its pipes", { skip: !supported }, async () => {
  const r = await timeRun(wrapper('console.log("PID " + process.pid); setInterval(() => {}, 1000)'), { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.ok(r.wallMs < 5000, `timeout left inherited pipes open: ${r.wallMs}`);
  assertStopped(r.stdout);
});

test("RSS watchdog charges and kills an allocating descendant", { skip: !supported }, async () => {
  const memLimitKb = 256 * 1024;
  const r = await timeRun(wrapper(`
    console.log("PID " + process.pid);
    const held = [];
    setInterval(() => held.push(Buffer.alloc(16 * 1024 * 1024, 1)), 50);
  `), { timeoutMs: 10000, memLimitKb });
  assert.equal(r.ok, false);
  assert.equal(r.memExceeded, true);
  assert.equal(r.timedOut, false);
  assert.ok(r.peakKb > memLimitKb);
  assertStopped(r.stdout);
});

test("RSS measurement reports KiB and preserves program output", { skip: !supported }, async () => {
  const r = await rssRun(node(`
    const held = Buffer.alloc(64 * 1024 * 1024, 1);
    setTimeout(() => console.log("RESULT " + held[held.length - 1]), 200);
  `), { timeoutMs: 5000, memLimitKb: 512 * 1024 });
  assert.equal(r.ok, true, r.stderr);
  assert.match(r.stdout, /RESULT 1/);
  assert.ok(r.maxRssKb >= 64 * 1024 && r.maxRssKb < 512 * 1024, `RSS units: ${r.maxRssKb}`);
});

test("RSS wrapper propagates timeout and kills its workload", { skip: !supported }, async () => {
  const r = await rssRun(wrapper('console.log("PID " + process.pid); setInterval(() => {}, 1000)'), { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assertStopped(r.stdout);
});
