#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./runners.mjs";

const output = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split("\n")[0] : "unknown";
};
const jzCommit = readFileSync(path.join(ROOT, "vendor", "jz", ".jz_commit"), "utf8").trim();
const wabtCommit = readFileSync(path.join(ROOT, "vendor", "wabt", ".wabt_commit"), "utf8").trim();
console.log(`jz ${jzCommit}; wasm2c ${output(path.join(ROOT, "vendor", "wabt", "build", "wasm2c"), ["--version"])} (${wabtCommit}); ${output("clang", ["--version"])}`);
