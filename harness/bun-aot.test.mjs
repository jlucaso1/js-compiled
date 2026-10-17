import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BUN_AOT, verifyBunAotToolchain } from "./bun-aot-toolchain.mjs";
import { CORE, ROOT, RUNNERS } from "./runners.mjs";

const supported = process.platform === "linux" && process.arch === "x64";
const commit = "123456789" + "a".repeat(31);
const revision = `1.4.4-canary.1+${commit.slice(0, 9)}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "bun-aot-test-"));
  try {
    for (const subdir of ["harness", "benches", "scripts", "vendor/bun-aot", "bin"]) mkdirSync(path.join(dir, subdir), { recursive: true });
    for (const file of ["run.mjs", "exec.mjs", "runners.mjs", "wasm-toolchain.mjs", "bun-aot-toolchain.mjs"]) {
      copyFileSync(path.join(ROOT, "harness", file), path.join(dir, "harness", file));
    }
    copyFileSync(path.join(ROOT, "package-lock.json"), path.join(dir, "package-lock.json"));
    const source = 'const value: number = 7; console.log("RESULT " + value);\n';
    writeFileSync(path.join(dir, "benches", "test.ts"), source);
    const binary = path.join(dir, "vendor", "bun-aot", "bun");
    const calls = path.join(dir, "calls.jsonl");
    writeFileSync(binary, `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (args.includes("--revision")) { console.log(process.env.FIXTURE_REVISION ?? ${JSON.stringify(revision)}); process.exit(0); }
if (args.includes("--version")) {
  if (process.env.FIXTURE_TAMPER_AFTER_SETUP && readFileSync(${JSON.stringify(calls)}, "utf8").split('"--version"').length === 3) {
    appendFileSync(import.meta.filename, "\\n// changed after setup\\n");
  }
  console.log(process.env.FIXTURE_VERSION ?? "1.4.4"); process.exit(0);
}
if (process.env.FIXTURE_NO_ARTIFACT) process.exit(0);
const out = args[args.indexOf("--outfile") + 1];
writeFileSync(out, ${JSON.stringify(`#!${process.execPath}\nconsole.log("RESULT " + (process.env.FIXTURE_RESULT ?? "7"));\n`)}, { mode: 0o755 });
if (process.env.FIXTURE_BUILD_FAIL) { console.error("unsupported AOT syntax"); process.exit(2); }
`, { mode: 0o755 });
    const pin = {
      pr: 45631, commit, bunPrVersion: "1.0.42", binarySha256: sha256(readFileSync(binary)),
      platform: "linux", arch: "x64",
      artifactUrl: "https://buildkite.com/example/artifact", buildUrl: "https://buildkite.com/example/build",
    };
    const installed = { ...pin, version: "1.4.4", revision };
    const writePin = () => writeFileSync(path.join(dir, "scripts", "bun-aot.json"), JSON.stringify(pin));
    const writeInstalled = () => writeFileSync(path.join(dir, "vendor", "bun-aot", "provenance.json"), JSON.stringify(installed));
    writePin();
    writeInstalled();
    const stableCalls = path.join(dir, "stable-bun-called");
    writeFileSync(path.join(dir, "bin", "bun"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(stableCalls)}, "called"); process.exit(99);\n`, { mode: 0o755 });
    const bench = (env = {}) => {
      const result = spawnSync(process.execPath, [path.join(dir, "harness", "run.mjs"), "--runners=bun-aot", "--quick", "--rss-runs=0", "--timeout=5", "--build-timeout=5"], {
        cwd: dir, encoding: "utf8", timeout: 30000,
        env: { ...process.env, PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`, ...env },
      });
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      return JSON.parse(readFileSync(path.join(dir, "results", "latest.json"), "utf8"));
    };
    run({ dir, binary, pin, installed, writePin, writeInstalled, calls, stableCalls, bench, source });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Bun AOT uses a separate experimental compiler with both AOT flags and original source", () => {
  const runner = RUNNERS["bun-aot"];
  assert.equal(runner.mode, "compiled");
  assert.equal(runner.tier, "extra");
  assert.equal(runner.experimental, true);
  assert.match(runner.label, /experimental.*45631/);
  assert.equal(runner.sourcePolicy, "original");
  assert.equal(runner.source, undefined);
  assert.equal(CORE.includes("bun-aot"), false);
  assert.deepEqual(runner.compile("input.ts", "out"), [BUN_AOT, "build", "--compile", "--aot", "--compile-trim-runtime", "--outfile", "out", "input.ts"]);
  assert.deepEqual(RUNNERS.bun.cmd("input.ts"), ["bun", "run", "input.ts"]);
  assert.deepEqual(RUNNERS["bun-compile"].compile("input.ts", "out"), ["bun", "build", "--compile", "--outfile", "out", "input.ts"]);
});

test("Bun AOT verifies pinned bytes, installed provenance and actual compiler revision", { skip: !supported }, () => {
  fixture(({ dir, pin, binary }) => {
    assert.deepEqual(verifyBunAotToolchain(dir), {
      ...pin, version: "1.4.4", revision,
      executable: "vendor/bun-aot/bun", binaryBytes: readFileSync(binary).length,
    });
  });
});

for (const field of ["commit", "binarySha256", "artifactUrl", "bunPrVersion", "platform", "arch", "buildUrl", "pr"]) {
  test(`Bun AOT refuses mismatched installed ${field} before executing the binary`, { skip: !supported }, () => {
    fixture(({ dir, installed, writeInstalled, calls }) => {
      installed[field] = "tampered";
      writeInstalled();
      assert.throws(() => verifyBunAotToolchain(dir), new RegExp(`provenance ${field} differs`));
      assert.equal(existsSync(calls), false);
    });
  });
}

test("Bun AOT refuses changed bytes before any version query", { skip: !supported }, () => {
  fixture(({ dir, binary, calls }) => {
    writeFileSync(binary, readFileSync(binary, "utf8") + "\n// tampered\n");
    assert.throws(() => verifyBunAotToolchain(dir), /SHA-256 differs.*refusing to execute/);
    assert.equal(existsSync(calls), false);
  });
});

test("Bun AOT refuses an unvetted pin before executing the binary", { skip: !supported }, () => {
  fixture(({ dir, pin, writePin, calls }) => {
    pin.binarySha256 = null;
    writePin();
    assert.throws(() => verifyBunAotToolchain(dir), /requires a vetted/);
    assert.equal(existsSync(calls), false);
  });
});

for (const [env, error] of [
  [{ FIXTURE_REVISION: "1.4.4+abcdef123" }, /revision does not match pinned commit/],
  [{ FIXTURE_VERSION: "1.4.5" }, /installed version\/revision provenance differs/],
]) {
  test(`Bun AOT records unavailable when actual compiler output fails verification: ${Object.keys(env)[0]}`, { skip: !supported }, () => {
    fixture(({ bench, stableCalls, calls }) => {
      const data = bench(env);
      const record = data.benches["test.ts"].runners["bun-aot"];
      assert.equal(record.status, "unavailable");
      assert.match(record.error, error);
      assert.equal(record.compilerProvenance, null);
      assert.equal(record.time, undefined);
      assert.equal(existsSync(stableCalls), false);
      assert.equal(readFileSync(calls, "utf8").includes('"build"'), false);
    });
  });
}

test("Bun AOT records unavailable instead of falling back to stable Bun", { skip: !supported }, () => {
  fixture(({ binary, bench, stableCalls, calls }) => {
    rmSync(binary);
    const data = bench();
    const record = data.benches["test.ts"].runners["bun-aot"];
    assert.equal(record.status, "unavailable");
    assert.equal(record.phase, "setup");
    assert.equal(record.version, null);
    assert.equal(data.meta.bunAot, null);
    assert.equal(existsSync(stableCalls), false);
    assert.equal(existsSync(calls), false);
  });
});

test("Bun AOT records exact canonical input, compile command and full verified provenance", { skip: !supported }, () => {
  fixture(({ dir, binary, bench, pin, source, stableCalls, calls }) => {
    const data = bench();
    const record = data.benches["test.ts"].runners["bun-aot"];
    assert.equal(record.status, "ok");
    assert.equal(record.matchesReference, true);
    assert.equal(record.experimental, true);
    assert.equal(record.version, revision);
    assert.equal(record.sourceMode, "original");
    assert.equal(record.sourcePath, "benches/test.ts");
    assert.equal(record.sourceSha256, sha256(source));
    assert.deepEqual(record.compilerProvenance, data.meta.bunAot);
    for (const [key, value] of Object.entries(pin)) assert.equal(record.compilerProvenance[key], value);
    const commands = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
    const compile = commands.find((args) => args[0] === "build");
    assert.deepEqual(record.compileCommand, [binary, ...compile]);
    assert.equal(compile.at(-1), path.join(dir, "benches", "test.ts"));
    assert.equal(record.artifactSha256, sha256(readFileSync(path.join(dir, record.artifactPath))));
    assert.ok(record.time.median > 0);
    assert.equal(record.maxRssKb, null);
    assert.ok(record.binBytes > 0);
    assert.ok(record.buildMs > 0);
    assert.equal(existsSync(stableCalls), false);
    assert.equal(readFileSync(path.join(dir, "benches", "test.ts"), "utf8"), source);
  });
});

test("Bun AOT build failures retain provenance and cannot run a partial executable", { skip: !supported }, () => {
  fixture(({ bench }) => {
    const record = bench({ FIXTURE_BUILD_FAIL: "1" }).benches["test.ts"].runners["bun-aot"];
    assert.equal(record.status, "build-failed");
    assert.equal(record.phase, "build");
    assert.equal(record.exitCode, 2);
    assert.match(record.error, /unsupported AOT syntax/);
    assert.equal(record.sourceMode, "original");
    assert.equal(record.compilerProvenance.commit, commit);
    assert.ok(record.compileCommand.includes("--aot"));
    assert.equal(record.output, undefined);
    assert.equal(record.time, undefined);
  });
});

test("Bun AOT output differences remain mismatches against the Node oracle", { skip: !supported }, () => {
  fixture(({ bench }) => {
    const data = bench({ FIXTURE_RESULT: "9" });
    const record = data.benches["test.ts"].runners["bun-aot"];
    assert.equal(record.output, "9");
    assert.equal(data.benches["test.ts"].reference.output, "7");
    assert.equal(record.matchesReference, false);
  });
});

test("Bun AOT rechecks compiler bytes before building and clears unattempted input claims", { skip: !supported }, () => {
  fixture(({ bench, calls }) => {
    const record = bench({ FIXTURE_TAMPER_AFTER_SETUP: "1" }).benches["test.ts"].runners["bun-aot"];
    assert.equal(record.status, "unavailable");
    assert.equal(record.phase, "setup");
    assert.match(record.error, /SHA-256 differs/);
    assert.equal(record.sourceMode, null);
    assert.equal(record.sourcePath, null);
    assert.equal(record.sourceSha256, null);
    assert.equal(record.compilerProvenance, null);
    assert.equal(record.output, undefined);
    assert.equal(readFileSync(calls, "utf8").includes('"build"'), false);
  });
});

test("Bun AOT rejects a successful compiler exit that emitted no executable", { skip: !supported }, () => {
  fixture(({ bench }) => {
    const record = bench({ FIXTURE_NO_ARTIFACT: "1" }).benches["test.ts"].runners["bun-aot"];
    assert.equal(record.status, "build-failed");
    assert.equal(record.phase, "build");
    assert.equal(record.exitCode, 0);
    assert.match(record.error, /without producing the requested artifact/);
    assert.equal(record.output, undefined);
  });
});


test("benchmark workflow gates AOT setup and verifies bundled bytes before version reporting", () => {
  const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "benchmark.yml"), "utf8").replaceAll("\r\n", "\n");
  const condition = "inputs.runners == '' || inputs.runners == 'all' || contains(format(',{0},', inputs.runners), ',bun-aot,')";
  for (const step of ["Install checksum-pinned experimental Bun AOT compiler", "Record verified experimental Bun AOT provenance"]) {
    assert.ok(workflow.includes(`- name: ${step}\n        if: ${condition}\n`), `${step} must only run when AOT is selected`);
  }
  assert.doesNotMatch(workflow, /^\s+vendor\/bun-aot\/bun\s/m, "never query the bundled executable before its checksum/provenance verifier");
  assert.match(workflow, /console\.log\(JSON\.stringify\(verifyBunAotToolchain\(\)/);
});
