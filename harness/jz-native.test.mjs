import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ROOT, RUNNERS } from "./runners.mjs";
import { adaptNumericResult } from "./jz-native-source.mjs";
import { assertVendorClean } from "../scripts/check-vendor-clean.mjs";

test("jz-native wiring names the actual standalone compilation stages", () => {
  const runner = RUNNERS["jz-native"];
  assert.equal(runner.mode, "compiled");
  assert.equal(runner.tier, "extra");
  assert.match(runner.label, /jz.*wasm2c.*clang -O3/);
  assert.equal(runner.supports("00-noop.ts"), null);
  assert.equal(runner.supports("10-fib.ts"), null);
  assert.match(runner.supports("01-hello.ts"), /single numeric RESULT/);
});

test("jz-native adapts only a single final numeric RESULT and rejects extra output", () => {
  const noop = readFileSync(path.join(ROOT, "benches", "00-noop.ts"), "utf8");
  const fib = readFileSync(path.join(ROOT, "benches", "10-fib.ts"), "utf8");
  const hello = readFileSync(path.join(ROOT, "benches", "01-hello.ts"), "utf8");
  assert.match(adaptNumericResult(noop), /export function benchResult\(\) \{ return \(0\); \}/);
  assert.match(adaptNumericResult(fib), /acc\); \}/);
  assert.throws(() => adaptNumericResult(hello), /unsupported output/);
});

test("pinned vendor check rejects staged and unstaged tracked changes but permits untracked build files", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jz-vendor-clean-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    writeFileSync(path.join(directory, "compiler.js"), "original\n");
    git("add", "compiler.js");
    git("commit", "-qm", "pinned source");
    writeFileSync(path.join(directory, "build-output"), "generated\n");
    assert.doesNotThrow(() => assertVendorClean(directory));

    writeFileSync(path.join(directory, "compiler.js"), "unstaged modification\n");
    assert.throws(() => assertVendorClean(directory), /tracked changes/);
    git("checkout", "--", "compiler.js");
    writeFileSync(path.join(directory, "compiler.js"), "staged modification\n");
    git("add", "compiler.js");
    assert.throws(() => assertVendorClean(directory), /tracked changes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("jz-native adapts typed functions and variables into executable JavaScript", async () => {
  const source = `function fib(n: number): number {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
  }
  let acc: number = 0;
  for (let i: number = 0; i < 6; i++) acc += fib(3 + i);
  console.log("RESULT " + acc);`;
  const adapted = adaptNumericResult(source);
  const module = await import(`data:text/javascript,${encodeURIComponent(adapted)}`);
  assert.equal(module.benchResult(), 52);
});

test("native setup populates fresh clones and protects existing vendor changes", () => {
  const directory = mkdtempSync(path.join(ROOT, ".jz-setup-test-"));
  const upstream = path.join(directory, "upstream");
  const bin = path.join(directory, "bin");
  const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const git = (...args) => execFileSync(realGit, args, { cwd: upstream, encoding: "utf8" });
  try {
    mkdirSync(upstream);
    mkdirSync(bin);
    mkdirSync(path.join(directory, "scripts"));
    for (const name of ["setup-jz-native.sh", "check-vendor-clean.mjs"]) {
      copyFileSync(path.join(ROOT, "scripts", name), path.join(directory, "scripts", name));
    }
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    writeFileSync(path.join(upstream, "compiler.js"), "original\n");
    git("add", "compiler.js");
    git("commit", "-qm", "pinned source");
    const revision = git("rev-parse", "HEAD").trim();
    writeFileSync(path.join(bin, "git"), `#!${process.execPath}
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2).map(arg =>
  arg.startsWith("https://github.com/") ? process.env.TEST_UPSTREAM :
  /^[0-9a-f]{40}$/.test(arg) ? process.env.TEST_REVISION : arg);
const result = spawnSync(process.env.TEST_GIT, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
    writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nmkdir -p vendor/jz/node_modules/watr\n", { mode: 0o755 });
    writeFileSync(path.join(bin, "cmake"), `#!/bin/sh
mkdir -p vendor/wabt/build
printf '#!/bin/sh\\nexit 0\\n' > vendor/wabt/build/wasm2c
chmod +x vendor/wabt/build/wasm2c
`, { mode: 0o755 });
    writeFileSync(path.join(bin, "clang"), "#!/bin/sh\necho test-clang\n", { mode: 0o755 });
    const setup = () => spawnSync("bash", ["scripts/setup-jz-native.sh"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TEST_GIT: realGit, TEST_UPSTREAM: upstream, TEST_REVISION: revision },
    });
    const fresh = setup();
    assert.equal(fresh.status, 0, fresh.stderr);
    for (const vendor of ["jz", "wabt"]) {
      assert.equal(readFileSync(path.join(directory, "vendor", vendor, "compiler.js"), "utf8"), "original\n");
    }
    const repeated = setup();
    assert.equal(repeated.status, 0, repeated.stderr);
    for (const vendor of ["jz", "wabt"]) {
      const source = path.join(directory, "vendor", vendor, "compiler.js");
      writeFileSync(source, "modified\n");
      const dirty = setup();
      assert.notEqual(dirty.status, 0);
      assert.match(dirty.stderr, /tracked changes in pinned vendor checkout/);
      assert.equal(readFileSync(source, "utf8"), "modified\n");
      writeFileSync(source, "original\n");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
