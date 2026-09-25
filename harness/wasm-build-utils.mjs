export function optimizerSkipped(log) {
  return /\b(?:binaryen|wasm-opt)\b.{0,120}\b(?:not found|not available|not installed|unavailable|missing|skipping|skip optimization)\b|\b(?:optimization|optimisation)\b.{0,120}\b(?:skipped|not performed|unavailable)\b|\b(?:unoptimized|un-optimized)\b.{0,100}\b(?:output|binary|module)\b|\b(?:output|binary|module)\b.{0,100}\b(?:unoptimized|un-optimized)\b/i.test(log);
}

export function isPinnedBinaryen(text) {
  return /\b132\b/.test(text);
}

export function js2ArtifactName(sourcePath) {
  return `${sourcePath.split(/[\\/]/).pop().replace(/\.(?:ts|js)$/i, "")}.wasm`;
}
