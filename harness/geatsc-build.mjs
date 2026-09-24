#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./runners.mjs";

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  console.error("usage: geatsc-build.mjs <source.ts> <output-binary>");
  process.exit(2);
}

const outDir = `${output}.geatsc`;
const compiler = path.join(ROOT, "node_modules", "@geastack", "compiler", "dist", "cli.js");
const cxx = process.env.CXX || "c++";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
try {
  if (run(process.execPath, [compiler, "compile", path.resolve(source), "--no-project", "--out-dir", outDir]) !== 0) {
    process.exitCode = 1;
  } else {
    const sources = readFileSync(path.join(outDir, "geatsc-sources.txt"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => path.resolve(outDir, file));
    if (sources.length === 0) throw new Error("geatsc emitted no C++ source files");

    const main = path.join(outDir, "geatsc-main.cpp");
    writeFileSync(main, "extern void __gea_top_level();\nint main() { __gea_top_level(); }\n");
    const args = [
      "-std=c++20",
      "-O2",
      "-ffp-contract=off",
      "-DGEA_CPP_SHARED_RUNTIME_BUILTINS",
      "-I",
      outDir,
      main,
      ...sources,
      path.join(outDir, "gea_runtime_builtins.cpp"),
      "-o",
      path.resolve(output),
    ];
    process.exitCode = run(cxx, args);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
