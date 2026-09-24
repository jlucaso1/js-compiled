#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertVendorClean(directory) {
  const result = spawnSync("git", ["-C", directory, "diff", "--quiet", "HEAD", "--"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 1) throw new Error(`tracked changes in pinned vendor checkout: ${directory}`);
  if (result.status !== 0) throw new Error(`could not inspect pinned vendor checkout: ${result.stderr.trim()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assertVendorClean(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
