import { stripTypeScriptTypes } from "node:module";

const RESULT_LINE = /console\.log\(\s*(?:"RESULT\s*"\s*\+\s*([\s\S]*?)|"RESULT\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)")\s*\)\s*;?\s*$/i;

export function adaptNumericResult(source) {
  source = stripTypeScriptTypes(source, { mode: "strip" });
  const resultLine = RESULT_LINE.exec(source);
  if (!resultLine || (source.match(/console\.log\s*\(/g) ?? []).length !== 1) {
    throw new Error("unsupported output: expected exactly one final console.log(\"RESULT \" + numericExpression) or numeric literal");
  }
  const expression = resultLine[1] ?? resultLine[2];
  return source.slice(0, resultLine.index) + `export function benchResult() { return (${expression}); }\n`;
}
