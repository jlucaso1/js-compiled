import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { ROOT, RUNNERS } from "./runners.mjs";
import { assertLinuxX64, WASMTIME, wasmtimeVersion } from "./wasm-toolchain.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT, encoding: "utf8", timeout: 300000, ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command}: ${result.stderr}`);
  return result;
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

assertLinuxX64();
const hostVersion = wasmtimeVersion();
mkdirSync(path.join(ROOT, "build"), { recursive: true });
const scratch = mkdtempSync(path.join(ROOT, "build/wasm-deployment-"));
try {
  const deployment = path.join(scratch, "deployment");
  mkdirSync(deployment);
  chmodSync(deployment, 0o755);
  copyFileSync(WASMTIME, path.join(deployment, "wasmtime"));
  const libraries = run("ldd", [WASMTIME]);
  succeeds(libraries);
  assert.doesNotMatch(libraries.stdout, /not found/);
  const libraryPaths = [...libraries.stdout.matchAll(/(?:=>\s+|^\s*)(\/\S+)\s+\(/gm)].map((match) => match[1]);
  assert.ok(libraryPaths.length > 0, "expected the pinned Linux host's OS libraries");
  for (const library of libraryPaths) {
    const destination = path.join(deployment, library);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(library, destination);
  }
  const isolated = (args) => run("sudo", [
    "-n", "--", "chroot", "--userspec=65534:65534", deployment, "/wasmtime", ...args,
  ], { env: { PATH: "/usr/bin:/bin" } });
  const version = isolated(["--version"]);
  succeeds(version);
  assert.equal(version.stdout.trim(), hostVersion);

  for (const bench of ["00-noop.ts", "01-hello.ts", "10-fib.ts"]) {
    const source = path.join(ROOT, "benches", bench);
    const original = readFileSync(source);
    const oracle = run(process.execPath, [source]);
    succeeds(oracle);
    for (const name of ["js2wasm", "assemblyscript"]) {
      const artifact = path.join(scratch, `${name}-${bench}.wasm`);
      const [compiler, ...compileArgs] = RUNNERS[name].compile(source, artifact);
      succeeds(run(compiler, compileArgs));
      const [, ...runtimeArgs] = RUNNERS[name].runArtifact(artifact);
      const hidden = isolated(runtimeArgs);
      assert.notEqual(hidden.status, 0, `${name}/${bench}: build-tree module was accessible`);
      assert.match(hidden.stderr, /No such file or directory/, `${name}/${bench}: expected a hidden module`);
      const deployed = path.join(deployment, "benchmark.wasm");
      copyFileSync(artifact, deployed);
      const result = isolated([...runtimeArgs.slice(0, -1), "/benchmark.wasm"]);
      assert.equal(result.status, oracle.status, `${name}/${bench}: ${result.stderr}`);
      assert.equal(result.stdout, oracle.stdout, `${name}/${bench}: deployed output differs from Node`);
      rmSync(deployed);
      assert.deepEqual(readFileSync(source), original, `${bench}: canonical source changed`);
      console.log(`${name}/${bench}: isolated module matches Node; build-tree access rejected`);
    }
  }
  console.log(`Deployment requires ${hostVersion} and its OS libraries; no JS/TS source, compiler, node_modules, or build-tree loader is deployed.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
