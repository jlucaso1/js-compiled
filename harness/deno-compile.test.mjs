import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { timeRun } from "./exec.mjs";
import { ROOT, RUNNERS } from "./runners.mjs";

const integration = process.env.DENO_COMPILE_INTEGRATION === "1";
const engines = ["deno-compile", "deno-compile-quickjs"];
const fixtures = ["00-noop.ts", "50-fs-io.ts"];

for (const name of engines) {
  test(`${name} compiles the canonical source without npm resolution`, () => {
    const source = path.join(ROOT, "benches", "50-fs-io.ts");
    const output = path.join(ROOT, "build", "deno fixture");
    const command = RUNNERS[name].compile(source, output);
    assert.deepEqual(command.slice(0, 5), ["deno", "compile", "-A", "--no-check", "--no-npm"]);
    assert.deepEqual(command.slice(-3), ["-o", output, source]);
    assert.equal(command.includes("--engine"), name === "deno-compile-quickjs");
    if (name === "deno-compile-quickjs") assert.equal(command[command.indexOf("--engine") + 1], "quickjs");
  });

  test(`${name} excludes unrelated npm files and preserves standalone node:fs output`, { skip: !integration }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "js-compiled-deno-"));
    const project = path.join(dir, "project");
    const deployed = path.join(dir, "deployed");
    const sentinel = "DENO_UNUSED_COMPILER_DEPENDENCY_874c4f0b8f0342aa";
    try {
      const unused = path.join(project, "node_modules", "unused-compiler");
      mkdirSync(unused, { recursive: true });
      mkdirSync(deployed);
      writeFileSync(path.join(project, "package.json"), JSON.stringify({
        type: "module", dependencies: { "unused-compiler": "1.0.0" },
      }));
      writeFileSync(path.join(unused, "package.json"), JSON.stringify({ name: "unused-compiler", version: "1.0.0" }));
      writeFileSync(path.join(unused, "payload.bin"), sentinel.repeat(16384));

      const outputs = [];
      for (const fixture of fixtures) {
        const source = path.join(project, fixture);
        copyFileSync(path.join(ROOT, "benches", fixture), source);
        const reference = spawnSync(process.execPath, [source], { cwd: project, encoding: "utf8", timeout: 30000 });
        assert.equal(reference.status, 0, reference.error?.message || reference.stderr);
        const artifact = path.join(deployed, fixture.replace(/\.ts$/, process.platform === "win32" ? ".exe" : ""));
        const built = await timeRun(RUNNERS[name].compile(source, artifact), {
          cwd: project, timeoutMs: 120000, memLimitKb: 4096 * 1024,
        });
        assert.ok(built.ok, JSON.stringify(built));
        assert.equal(readFileSync(artifact).includes(Buffer.from(sentinel)), false, "unimported npm payload must not be embedded");
        outputs.push({ artifact, expected: reference.stdout.trim() });
      }

      // The emitted executables must work after their source and dependencies disappear.
      rmSync(project, { recursive: true, force: true });
      for (const { artifact, expected } of outputs) {
        const ran = spawnSync(artifact, [], { cwd: deployed, encoding: "utf8", timeout: 30000 });
        assert.equal(ran.status, 0, ran.error?.message || ran.stderr);
        assert.equal(ran.stdout.trim(), expected);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
