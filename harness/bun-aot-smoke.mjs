#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, RUNNERS } from "./runners.mjs";
import { verifyBunAotToolchain } from "./bun-aot-toolchain.mjs";

const benches = ["00-noop.ts", "01-hello.ts", "10-fib.ts", "40-classes.ts", "50-fs-io.ts"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const provenance = verifyBunAotToolchain();
const originals = Object.fromEntries(benches.map((bench) => [bench, readFileSync(path.join(ROOT, "benches", bench))]));
const run = (argv, options = {}) => {
  const result = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${argv[0]}: ${result.stderr}`);
  assert.equal(result.status, 0, `${argv[0]}: ${result.stderr}\n${result.stdout}`);
  return result;
};

const deployment = mkdtempSync(path.join(tmpdir(), "bun-aot-deployment-"));
try {
  const output = path.join(ROOT, "results", "bun-aot-smoke.json");
  const harness = run([process.execPath, path.join(ROOT, "harness", "run.mjs"),
    "--runners=node,bun-aot", `--benches=${benches.join(",")}`, "--quick", `--out=${output}`]);
  process.stdout.write(harness.stdout);
  const data = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(data.meta.bunAot, provenance);
  assert.deepEqual(Object.keys(data.benches), benches);
  for (const bench of benches) {
    assert.equal(data.benches[bench].runners.node.status, "ok", `${bench}: Node oracle failed`);
    const record = data.benches[bench].runners["bun-aot"];
    assert.equal(record.status, "ok", `${bench}: ${record.phase ?? ""} ${record.error ?? record.status}`);
    assert.equal(record.matchesReference, true, `${bench}: RESULT differs from Node`);
    assert.equal(record.version, provenance.revision);
    assert.equal(record.experimental, true);
    assert.equal(record.sourceMode, "original");
    assert.equal(record.sourcePolicy, "original");
    assert.equal(record.sourcePath, `benches/${bench}`);
    assert.equal(record.sourceSha256, sha256(originals[bench]));
    assert.deepEqual(record.compilerProvenance, provenance);
    assert.ok(record.time?.median > 0, `${bench}: missing timing`);
    assert.ok(record.maxRssKb > 0, `${bench}: missing measured peak RSS`);
    assert.ok(record.buildMs > 0, `${bench}: missing compile duration`);
    assert.ok(record.binBytes > 0, `${bench}: missing executable size`);
    const artifact = path.join(ROOT, record.artifactPath);
    assert.deepEqual(record.compileCommand, RUNNERS["bun-aot"].compile(path.join(ROOT, "benches", bench), artifact));
    const bytes = readFileSync(artifact);
    assert.equal(record.binBytes, bytes.length);
    assert.equal(record.artifactSha256, sha256(bytes));

    const executable = path.join(deployment, "benchmark");
    copyFileSync(artifact, executable);
    const env = { PATH: "", HOME: deployment, TMPDIR: deployment };
    const standalone = run([executable], { cwd: deployment, env });
    const oracle = run([process.execPath, path.join(ROOT, "benches", bench)], { cwd: deployment, env });
    assert.equal(standalone.stdout, oracle.stdout, `${bench}: copied executable output differs from Node`);
    assert.deepEqual(readdirSync(deployment), ["benchmark"], `${bench}: unexpected deployment dependency or leftover`);
    assert.deepEqual(readFileSync(path.join(ROOT, "benches", bench)), originals[bench], `${bench}: canonical source changed`);
    rmSync(executable);
    console.log(`${bench}: original input matches Node, RSS and compiler provenance recorded, copied executable runs with an empty PATH`);
  }
} finally {
  rmSync(deployment, { recursive: true, force: true });
}
