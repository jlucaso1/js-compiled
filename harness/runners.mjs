import { existsSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = (n) => path.join(ROOT, "node_modules", ".bin", n);
const PORFFOR = path.join(ROOT, "vendor", "porffor", "runtime", "index.js");

// mode "interpreted": cmd(file) -> argv
// mode "compiled":    compile(file, out) -> argv
// source "stripped-js": feed the runner the same program with type annotations removed
export const RUNNERS = {
  node: {
    label: "Node.js",
    tier: "core",
    mode: "interpreted",
    version: ["node", "--version"],
    cmd: (file) => ["node", file],
  },

  bun: {
    label: "Bun",
    tier: "core",
    mode: "interpreted",
    version: ["bun", "--version"],
    cmd: (file) => ["bun", "run", file],
  },

  scriptc: {
    label: "scriptc",
    tier: "core",
    mode: "compiled",
    version: [BIN("scriptc"), "--version"],
    compile: (file, out) => [BIN("scriptc"), "build", file, "-o", out, "--no-keep-c"],
  },

  porffor: {
    label: "Porffor",
    tier: "core",
    mode: "compiled",
    requires: PORFFOR,
    version: ["node", PORFFOR, "--version"],
    compile: (file, out) => ["node", PORFFOR, "native", "--module", "-t", file, "-o", out],
  },

  perry: {
    label: "Perry",
    tier: "core",
    mode: "compiled",
    version: [BIN("perry"), "--version"],
    compile: (file, out) => [BIN("perry"), "compile", file, "-o", out],
  },

  "scriptc-dynamic": {
    label: "scriptc --dynamic",
    tier: "extra",
    mode: "compiled",
    version: [BIN("scriptc"), "--version"],
    compile: (file, out) => [BIN("scriptc"), "build", file, "--dynamic", "-o", out, "--no-keep-c"],
  },

  // Same program with the (runtime-irrelevant) type annotations removed, to show
  // what Porffor's TypeScript front end is worth.
  "porffor-js": {
    label: "Porffor, types stripped",
    tier: "extra",
    mode: "compiled",
    source: "stripped-js",
    requires: PORFFOR,
    version: ["node", PORFFOR, "--version"],
    compile: (file, out) => ["node", PORFFOR, "native", "--module", file, "-o", out],
  },

  "bun-compile": {
    label: "bun build --compile",
    tier: "extra",
    mode: "compiled",
    version: ["bun", "--version"],
    compile: (file, out) => ["bun", "build", "--compile", "--outfile", out, file],
  },

  "deno-compile": {
    label: "deno compile",
    tier: "extra",
    mode: "compiled",
    version: ["deno", "--version"],
    compile: (file, out) => ["deno", "compile", "-A", "--no-check", "-o", out, file],
  },

  deno: {
    label: "Deno",
    tier: "extra",
    mode: "interpreted",
    version: ["deno", "--version"],
    cmd: (file) => ["deno", "run", "-A", "--no-check", file],
  },
};

export const CORE = Object.keys(RUNNERS).filter((k) => RUNNERS[k].tier === "core");

export function missingDependency(name) {
  const r = RUNNERS[name];
  return r.requires && !existsSync(r.requires) ? r.requires : null;
}
