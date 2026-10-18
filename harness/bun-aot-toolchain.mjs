import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
export const BUN_AOT = path.join(ROOT, "vendor", "bun-aot", "bun");
const PIN_KEYS = ["pr", "commit", "bunPrVersion", "binarySha256", "platform", "arch", "artifactUrl", "buildUrl"];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read Bun AOT provenance ${file}: ${error.message}`);
  }
}

// Verify the bytes before executing even --version. Never resolve this compiler
// from PATH or use stable Bun when the experimental artifact is unavailable.
export function verifyBunAotToolchain(root = ROOT) {
  const pin = readJson(path.join(root, "scripts", "bun-aot.json"));
  if (pin.pr !== 45631 || !/^[0-9a-f]{40}$/.test(pin.commit ?? "") ||
      !/^[0-9a-f]{64}$/.test(pin.binarySha256 ?? "") ||
      !/^\d+\.\d+\.\d+$/.test(pin.bunPrVersion ?? "") ||
      pin.platform !== "linux" || pin.arch !== "x64" ||
      !/^https:\/\//.test(pin.artifactUrl ?? "") || !/^https:\/\//.test(pin.buildUrl ?? "")) {
    throw new Error("Bun AOT requires a vetted PR #45631 commit, binary SHA-256, and artifact provenance in scripts/bun-aot.json");
  }
  if (process.platform !== pin.platform || process.arch !== pin.arch) {
    throw new Error(`pinned Bun AOT artifact supports ${pin.platform}/${pin.arch} only (got ${process.platform}/${process.arch})`);
  }
  const installed = readJson(path.join(root, "vendor", "bun-aot", "provenance.json"));
  for (const key of PIN_KEYS) {
    if (installed[key] !== pin[key]) throw new Error(`Bun AOT installed provenance ${key} differs from the pinned artifact`);
  }
  const executable = path.join(root, "vendor", "bun-aot", "bun");
  let binary;
  try {
    if (!statSync(executable).isFile()) throw new Error("not a regular file");
    binary = readFileSync(executable);
  } catch (error) {
    throw new Error(`pinned Bun AOT executable is unavailable: ${error.message}`);
  }
  const binarySha256 = createHash("sha256").update(binary).digest("hex");
  if (binarySha256 !== pin.binarySha256) throw new Error("Bun AOT executable SHA-256 differs from the pinned artifact; refusing to execute");

  const query = (flag) => {
    const result = spawnSync(executable, [flag], { encoding: "utf8", timeout: 10000 });
    if (result.error || result.status !== 0) {
      throw new Error(`cannot verify Bun AOT ${flag}: ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`}`);
    }
    const output = result.stdout.trim();
    if (!output) throw new Error(`Bun AOT ${flag} returned no output`);
    return output;
  };
  const revision = query("--revision");
  const commits = revision.match(/\b[0-9a-f]{7,40}\b/g) ?? [];
  if (commits.length !== 1 || !pin.commit.startsWith(commits[0])) {
    throw new Error(`Bun AOT revision does not match pinned commit ${pin.commit}: ${revision}`);
  }
  const version = query("--version");
  if (installed.revision !== revision || installed.version !== version) {
    throw new Error("Bun AOT installed version/revision provenance differs from the executable");
  }
  return {
    ...Object.fromEntries(PIN_KEYS.map((key) => [key, pin[key]])),
    version,
    revision,
    executable: path.relative(root, executable),
    binaryBytes: binary.length,
  };
}
