import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { WASMTIME_SHA256, WASMTIME_VERSION } from "./wasm-toolchain.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const supported = process.platform === "linux" && process.arch === "x64";

function fixture() {
  const build = path.join(ROOT, "build");
  mkdirSync(build, { recursive: true });
  return mkdtempSync(path.join(build, "wasm-build-test-"));
}

test("js2wasm manifest compile command reproduces the emitted module", { skip: !supported }, () => {
  const dir = fixture();
  try {
    for (const name of ["harness", "build", "vendor/wasmtime", "benches"]) {
      mkdirSync(path.join(dir, name), { recursive: true });
    }
    for (const file of ["js2wasm-build.mjs", "wasm-build-utils.mjs", "wasm-toolchain.mjs"]) {
      copyFileSync(path.join(ROOT, "harness", file), path.join(dir, "harness", file));
    }
    copyFileSync(path.join(ROOT, "package-lock.json"), path.join(dir, "package-lock.json"));
    symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
    writeFileSync(path.join(dir, "vendor/wasmtime/wasmtime"), `#!/bin/sh\necho 'wasmtime ${WASMTIME_VERSION}'\n`, { mode: 0o755 });
    writeFileSync(path.join(dir, "vendor/wasmtime/.archive_sha256"), WASMTIME_SHA256);
    const source = path.join(dir, "benches/fixture.ts");
    writeFileSync(source, 'console.log("RESULT 7");\n');
    const artifact = path.join(dir, "build/fixture.wasm");
    const env = { ...process.env, PATH: `${path.join(ROOT, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}` };
    const built = spawnSync(process.execPath, [path.join(dir, "harness/js2wasm-build.mjs"), source, artifact], {
      cwd: dir, env, encoding: "utf8", timeout: 120000,
    });
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const manifest = JSON.parse(readFileSync(`${artifact}.manifest.json`, "utf8"));
    const [command, ...args] = manifest.compileCommand;
    const replay = spawnSync(command, args, { cwd: dir, env, encoding: "utf8", timeout: 120000 });
    assert.equal(replay.status, 0, replay.stderr || replay.stdout);
    assert.deepEqual(readFileSync(path.join(`${artifact}.js2-output`, "fixture.wasm")), readFileSync(artifact));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Wasmtime setup uses local scratch and cleans up after download failure", { skip: !supported }, () => {
  const dir = fixture();
  try {
    mkdirSync(path.join(dir, "scripts"));
    mkdirSync(path.join(dir, "bin"));
    copyFileSync(path.join(ROOT, "scripts/setup-wasm.sh"), path.join(dir, "scripts/setup-wasm.sh"));
    writeFileSync(path.join(dir, "bin/curl"), `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv[process.argv.indexOf("-o") + 1];
fs.writeFileSync("download-path.json", JSON.stringify(path.resolve(output)));
fs.writeFileSync(output, "partial download");
process.exit(23);
`, { mode: 0o755 });
    const result = spawnSync("bash", ["scripts/setup-wasm.sh"], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    assert.equal(result.status, 23, result.stderr);
    const download = JSON.parse(readFileSync(path.join(dir, "download-path.json"), "utf8"));
    const cache = path.join(dir, "build/.cache");
    assert.equal(path.dirname(path.dirname(download)), cache);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
