#!/usr/bin/env node
// Record both the pinned geatsc release and the native compiler used by its runner.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./runners.mjs";

const cxx = process.env.CXX || "c++";
const packagePath = path.join(ROOT, "node_modules", "@geastack", "compiler", "package.json");
const geatscVersion = JSON.parse(readFileSync(packagePath, "utf8")).version;
const result = spawnSync(cxx, ["--version"], { encoding: "utf8" });
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? result.stderr);
  process.exit(1);
}
const compilerVersion = `${result.stdout}${result.stderr}`.split(/\r?\n/).find(Boolean) ?? "unknown C++ compiler";
console.log(`geatsc ${geatscVersion}; ${cxx}: ${compilerVersion}`);
